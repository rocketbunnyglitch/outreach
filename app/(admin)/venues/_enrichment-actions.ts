"use server";

/**
 * Server actions for on-demand venue contact enrichment (PHASE E5/E6).
 *
 * Distinct from `backfillVenueFromGoogle` in _actions.ts (which fills
 * address/phone/website from Google Places). These drive the contact-email +
 * social scraper (lib/enrichment-orchestrator).
 */

import { venueEnrichmentAttempts } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  type BulkEligibilityPreview,
  type EnrichVenueResult,
  enrichVenue,
  enrichVenuesBatch,
  previewBulkEnrichmentEligibility,
} from "@/lib/enrichment-orchestrator";
import { desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export interface EnrichmentHistoryRow {
  id: string;
  attemptedAtLabel: string;
  completedAtLabel: string | null;
  triggerSource: string;
  tierUsed: number | null;
  status: string;
  emailsFound: number;
  instagramFound: boolean;
  facebookFound: boolean;
  costEstimateUsd: string;
  durationMs: number | null;
  errorMessage: string | null;
}

const stampFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Toronto",
});

/**
 * Run the two-tier scrape for a single venue from the venue detail page.
 * forceRetry bypasses the skip logic (used by the "Re-try (force)" button).
 */
export async function triggerVenueEnrichment(
  venueId: string,
  forceRetry = false,
): Promise<EnrichVenueResult> {
  const { staff } = await requireStaff();
  const result = await enrichVenue(venueId, {
    triggeredByUserId: staff.id,
    triggerSource: forceRetry ? "manual_retrigger" : "venue_detail_button",
    forceRetry,
  });
  revalidatePath(`/venues/${venueId}`);
  return result;
}

/** Last 10 enrichment attempts for a venue, newest first, date-formatted
 *  server-side (pinned tz) so the client renders plain strings. */
export async function getEnrichmentHistory(venueId: string): Promise<EnrichmentHistoryRow[]> {
  await requireStaff();
  const rows = await db
    .select()
    .from(venueEnrichmentAttempts)
    .where(eq(venueEnrichmentAttempts.venueId, venueId))
    .orderBy(desc(venueEnrichmentAttempts.attemptedAt))
    .limit(10);

  return rows.map((r) => ({
    id: r.id,
    attemptedAtLabel: stampFmt.format(r.attemptedAt),
    completedAtLabel: r.completedAt ? stampFmt.format(r.completedAt) : null,
    triggerSource: r.triggerSource,
    tierUsed: r.tierUsed,
    status: r.status,
    emailsFound: r.emailsFound,
    instagramFound: r.instagramFound,
    facebookFound: r.facebookFound,
    costEstimateUsd: r.costEstimateUsd,
    durationMs: r.durationMs,
    errorMessage: r.errorMessage,
  }));
}

/**
 * Bulk-enrich the given venues (cold-outreach table). Skips ineligible venues
 * without burning a scrape; returns per-venue results for the summary UI.
 */
export async function triggerBulkEnrichment(venueIds: string[]): Promise<EnrichVenueResult[]> {
  const { staff } = await requireStaff();
  const results = await enrichVenuesBatch(venueIds, {
    triggeredByUserId: staff.id,
    triggerSource: "cold_outreach_bulk",
    forceRetry: false,
    maxConcurrent: 5,
  });
  return results;
}

/** Eligible-vs-skipped breakdown for the bulk preview modal. */
export async function previewBulkEnrichment(venueIds: string[]): Promise<BulkEligibilityPreview> {
  await requireStaff();
  return previewBulkEnrichmentEligibility(venueIds);
}
