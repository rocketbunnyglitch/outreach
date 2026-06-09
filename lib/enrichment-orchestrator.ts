import "server-only";

/**
 * Enrichment orchestrator.
 *
 * Decides eligibility (skip logic), runs Tier 1 then Tier 2 ONLY when Tier 1
 * found no emails, logs every attempt to venue_enrichment_attempts, and writes
 * scraped contacts back onto the venue (in the scraped_* columns, kept
 * separate from operator-entered email/instagram_handle).
 *
 * Pure decision + concurrency helpers live in lib/enrichment-eligibility.ts
 * (unit-tested). This module is the server-only glue to the db + scrapers.
 *
 * See PHASE E4 of the venue contact-enrichment build.
 */

import { venueEnrichmentAttempts, venues } from "@/db/schema";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { desc, eq, inArray } from "drizzle-orm";
import { type ScrapedContact, type Tier1Result, scrapeContactTier1 } from "./contact-scraper-tier1";
import { scrapeContactTier2 } from "./contact-scraper-tier2";
import {
  type EnrichmentEligibility,
  type VenueEligibilityInput,
  decideEligibility,
  domainOf,
  mapWithConcurrency,
} from "./enrichment-eligibility";

export type { EnrichmentEligibility } from "./enrichment-eligibility";

export interface EnrichVenueResult {
  venue_id: string;
  attempted: boolean;
  skipped: boolean;
  skipped_reason?: string;
  tier_used?: 1 | 2;
  status?: string;
  emails_found?: number;
  has_socials?: boolean;
  cost_usd?: number;
  duration_ms?: number;
  attempt_id?: string;
}

export interface BatchOptions {
  triggeredByUserId: string;
  triggerSource: "cold_outreach_bulk" | "manual_retrigger";
  forceRetry?: boolean;
  maxConcurrent?: number;
}

export interface BulkEligibilityPreview {
  eligible: number;
  skipped_has_email: number;
  skipped_no_website: number;
  skipped_already_attempted: number;
}

const DEFAULT_MAX_CONCURRENT = 5;
const PER_DOMAIN_COOLDOWN_MS = 60_000;
const MAX_BATCH_JITTER_MS = 2_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface VenueRow {
  id: string;
  websiteUrl: string | null;
  email: string | null;
  alternateEmails: string[];
}

async function loadVenue(venueId: string): Promise<VenueRow | null> {
  const rows = await db
    .select({
      id: venues.id,
      websiteUrl: venues.websiteUrl,
      email: venues.email,
      alternateEmails: venues.alternateEmails,
    })
    .from(venues)
    .where(eq(venues.id, venueId))
    .limit(1);
  return rows[0] ?? null;
}

async function latestAttempt(venueId: string): Promise<{ at: string; status: string } | null> {
  const rows = await db
    .select({ at: venueEnrichmentAttempts.attemptedAt, status: venueEnrichmentAttempts.status })
    .from(venueEnrichmentAttempts)
    .where(eq(venueEnrichmentAttempts.venueId, venueId))
    .orderBy(desc(venueEnrichmentAttempts.attemptedAt))
    .limit(1);
  const r = rows[0];
  return r ? { at: r.at.toISOString(), status: r.status } : null;
}

function eligibilityInput(
  v: VenueRow,
  last: { at: string; status: string } | null,
): VenueEligibilityInput {
  return {
    email: v.email,
    alternateEmails: v.alternateEmails ?? [],
    websiteUrl: v.websiteUrl,
    lastAttempt: last,
  };
}

/**
 * Eligibility for a single venue: has_email -> no_website -> already_attempted.
 */
export async function checkEnrichmentEligibility(venueId: string): Promise<EnrichmentEligibility> {
  const venue = await loadVenue(venueId);
  if (!venue) return { eligible: false, reason: "no_website" };
  const last = await latestAttempt(venueId);
  return decideEligibility(eligibilityInput(venue, last));
}

function sortByConfidence(emails: ScrapedContact[]): ScrapedContact[] {
  return [...emails].sort((a, b) => b.confidence - a.confidence);
}

/**
 * Run the two-tier scrape for a venue with a known website. Tier 2 runs only
 * when Tier 1 is reachable but yields no emails. Returns the merged data +
 * which tier was used + the final venue status.
 */
async function runScrape(websiteUrl: string): Promise<{
  tierUsed: 1 | 2;
  emails: ScrapedContact[];
  instagram: string | null;
  facebook: string | null;
  status: string;
  cost: number;
  durationMs: number;
  pagesFetched: string[];
  pagesFailed: string[];
  notes: string | null;
}> {
  const tier1: Tier1Result = await scrapeContactTier1(websiteUrl);

  // Tier 1 produced emails, or the site is unreachable -> no point in Tier 2.
  if (tier1.status === "unreachable") {
    return {
      tierUsed: 1,
      emails: [],
      instagram: tier1.instagram,
      facebook: tier1.facebook,
      status: "unreachable",
      cost: 0,
      durationMs: tier1.duration_ms,
      pagesFetched: tier1.pages_fetched,
      pagesFailed: tier1.pages_failed,
      notes: null,
    };
  }

  if (tier1.emails.length > 0) {
    return {
      tierUsed: 1,
      emails: sortByConfidence(tier1.emails),
      instagram: tier1.instagram,
      facebook: tier1.facebook,
      status: tier1.status === "success" ? "tier1_success" : "tier1_partial",
      cost: 0,
      durationMs: tier1.duration_ms,
      pagesFetched: tier1.pages_fetched,
      pagesFailed: tier1.pages_failed,
      notes: null,
    };
  }

  // Tier 1 reachable but no emails -> semantic fallback.
  const tier2 = await scrapeContactTier2(websiteUrl, tier1);
  return {
    tierUsed: 2,
    emails: sortByConfidence(tier2.emails),
    instagram: tier1.instagram ?? tier2.instagram,
    facebook: tier1.facebook ?? tier2.facebook,
    status: tier2.emails.length > 0 ? "tier2_success" : "tier2_failed",
    cost: tier2.cost_estimate_usd,
    durationMs: tier1.duration_ms + tier2.duration_ms,
    pagesFetched: tier1.pages_fetched,
    pagesFailed: tier1.pages_failed,
    notes: tier2.notes,
  };
}

/**
 * Enrich a single venue. Honors skip logic unless forceRetry. Always records
 * exactly one venue_enrichment_attempts row when it proceeds.
 */
export async function enrichVenue(
  venueId: string,
  options: { triggeredByUserId: string; triggerSource: string; forceRetry?: boolean },
): Promise<EnrichVenueResult> {
  const venue = await loadVenue(venueId);
  if (!venue) {
    return { venue_id: venueId, attempted: false, skipped: true, skipped_reason: "not_found" };
  }

  if (!options.forceRetry) {
    const last = await latestAttempt(venueId);
    const elig = decideEligibility(eligibilityInput(venue, last));
    if (!elig.eligible) {
      return {
        venue_id: venueId,
        attempted: false,
        skipped: true,
        skipped_reason: elig.reason,
      };
    }
  }

  // Open the attempt row up front so even a crash leaves a trace.
  const inserted = await db
    .insert(venueEnrichmentAttempts)
    .values({
      venueId,
      triggeredByUserId: options.triggeredByUserId,
      triggerSource: options.triggerSource,
      status: "in_progress",
    })
    .returning({ id: venueEnrichmentAttempts.id });
  const attemptId = inserted[0]?.id;

  try {
    const websiteUrl = venue.websiteUrl ?? "";
    const scrape = await runScrape(websiteUrl);

    await db
      .update(venueEnrichmentAttempts)
      .set({
        completedAt: new Date(),
        tierUsed: scrape.tierUsed,
        status: scrape.status,
        emailsFound: scrape.emails.length,
        instagramFound: Boolean(scrape.instagram),
        facebookFound: Boolean(scrape.facebook),
        pagesFetched: scrape.pagesFetched,
        pagesFailed: scrape.pagesFailed,
        costEstimateUsd: scrape.cost.toFixed(6),
        durationMs: scrape.durationMs,
        notes: scrape.notes,
      })
      .where(eq(venueEnrichmentAttempts.id, attemptId ?? ""));

    // Promote scraped emails onto the venue's ACTIONABLE contact fields so the
    // operator can just hit "Email this venue" -- but only when the venue has
    // no human-entered email yet, so a scrape never overwrites a verified
    // contact (the scraped_* columns keep the full provenance regardless).
    // Best (highest-confidence) email -> email; the rest -> alternate_emails.
    const hadContactEmail =
      (venue.email?.trim().length ?? 0) > 0 || (venue.alternateEmails?.length ?? 0) > 0;
    const promote = !hadContactEmail && scrape.emails.length > 0;
    const promotedPrimary = promote ? (scrape.emails[0]?.email ?? null) : null;

    const venuePatch: Partial<typeof venues.$inferInsert> = {
      scrapedEmails: scrape.emails,
      scrapedInstagram: scrape.instagram,
      scrapedFacebook: scrape.facebook,
      lastEnrichmentAttemptAt: new Date(),
      lastEnrichmentStatus: scrape.status,
    };
    if (promote && promotedPrimary) {
      venuePatch.email = promotedPrimary;
      venuePatch.alternateEmails = scrape.emails.slice(1).map((e) => e.email);
      venuePatch.updatedBy = options.triggeredByUserId;
    }

    await db.update(venues).set(venuePatch).where(eq(venues.id, venueId));

    // Validate the newly promoted address in the background (same pattern as
    // setVenueEmailFromSearch) so the ZeroBounce pill populates. Best-effort.
    if (promotedPrimary) {
      try {
        const { validateEmailInBackground } = await import("@/lib/zerobounce");
        validateEmailInBackground(promotedPrimary, options.triggeredByUserId);
      } catch (err) {
        logger.warn(
          { venueId, err: String(err) },
          "zerobounce validation skipped after enrichment",
        );
      }
    }

    return {
      venue_id: venueId,
      attempted: true,
      skipped: false,
      tier_used: scrape.tierUsed,
      status: scrape.status,
      emails_found: scrape.emails.length,
      has_socials: Boolean(scrape.instagram || scrape.facebook),
      cost_usd: scrape.cost,
      duration_ms: scrape.durationMs,
      attempt_id: attemptId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ venueId, err: message }, "enrichVenue failed");
    await db
      .update(venueEnrichmentAttempts)
      .set({
        completedAt: new Date(),
        status: "unreachable",
        errorMessage: message.slice(0, 500),
      })
      .where(eq(venueEnrichmentAttempts.id, attemptId ?? ""));
    await db
      .update(venues)
      .set({ lastEnrichmentAttemptAt: new Date(), lastEnrichmentStatus: "unreachable" })
      .where(eq(venues.id, venueId));
    return {
      venue_id: venueId,
      attempted: true,
      skipped: false,
      status: "unreachable",
      emails_found: 0,
      has_socials: false,
      attempt_id: attemptId,
    };
  }
}

/**
 * Enrich many venues. Skips ineligible ones (unless forceRetry) without
 * burning a scrape, runs the rest with a concurrency cap + per-domain 60s
 * cooldown + small jitter so we stay a polite crawler.
 */
export async function enrichVenuesBatch(
  venueIds: string[],
  options: BatchOptions,
): Promise<EnrichVenueResult[]> {
  if (venueIds.length === 0) return [];
  const limit = Math.max(1, options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT);

  // Pre-load website hosts to drive the per-domain cooldown.
  const rows = await db
    .select({ id: venues.id, websiteUrl: venues.websiteUrl })
    .from(venues)
    .where(inArray(venues.id, venueIds));
  const domainById = new Map<string, string | null>(
    rows.map((r) => [r.id, domainOf(r.websiteUrl)]),
  );
  const lastScrapeByDomain = new Map<string, number>();

  return mapWithConcurrency(venueIds, limit, async (venueId, index) => {
    // Small staggered jitter so we don't fire all `limit` requests in lockstep.
    await sleep((index % limit) * (MAX_BATCH_JITTER_MS / limit));

    const domain = domainById.get(venueId) ?? null;
    if (domain) {
      const last = lastScrapeByDomain.get(domain);
      if (last !== undefined) {
        const wait = PER_DOMAIN_COOLDOWN_MS - (Date.now() - last);
        if (wait > 0) await sleep(wait);
      }
      lastScrapeByDomain.set(domain, Date.now());
    }

    try {
      return await enrichVenue(venueId, {
        triggeredByUserId: options.triggeredByUserId,
        triggerSource: options.triggerSource,
        forceRetry: options.forceRetry,
      });
    } catch (err) {
      // enrichVenue never throws, but belt-and-suspenders so one bad venue
      // can't abort the whole batch.
      logger.warn({ venueId, err: String(err) }, "batch item threw unexpectedly");
      return {
        venue_id: venueId,
        attempted: false,
        skipped: false,
        status: "unreachable",
      } satisfies EnrichVenueResult;
    }
  });
}

/**
 * Count how a set of venues splits across eligible vs each skip reason — used
 * by the cold-table bulk preview modal. One query for venues + one for their
 * latest attempts.
 */
export async function previewBulkEnrichmentEligibility(
  venueIds: string[],
): Promise<BulkEligibilityPreview> {
  const preview: BulkEligibilityPreview = {
    eligible: 0,
    skipped_has_email: 0,
    skipped_no_website: 0,
    skipped_already_attempted: 0,
  };
  if (venueIds.length === 0) return preview;

  const rows = await db
    .select({
      id: venues.id,
      websiteUrl: venues.websiteUrl,
      email: venues.email,
      alternateEmails: venues.alternateEmails,
    })
    .from(venues)
    .where(inArray(venues.id, venueIds));

  // Latest attempt per venue (any prior row blocks eligibility).
  const attemptRows = await db
    .select({ venueId: venueEnrichmentAttempts.venueId })
    .from(venueEnrichmentAttempts)
    .where(inArray(venueEnrichmentAttempts.venueId, venueIds));
  const attempted = new Set(attemptRows.map((a) => a.venueId));

  for (const v of rows) {
    const elig = decideEligibility({
      email: v.email,
      alternateEmails: v.alternateEmails ?? [],
      websiteUrl: v.websiteUrl,
      lastAttempt: attempted.has(v.id) ? { at: "", status: "" } : null,
    });
    if (elig.eligible) preview.eligible++;
    else if (elig.reason === "has_email") preview.skipped_has_email++;
    else if (elig.reason === "no_website") preview.skipped_no_website++;
    else preview.skipped_already_attempted++;
  }
  return preview;
}
