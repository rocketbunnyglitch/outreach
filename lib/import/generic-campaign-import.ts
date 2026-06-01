import "server-only";

/**
 * Halloween 2025 import — orchestrator.
 *
 * Reads data/halloween_2025.json (parsed in Phase 1) and writes
 * the equivalent records into our DB:
 *   - One "Halloween 2025" campaign (slug: halloween-2025)
 *   - One city_campaign per matched city
 *   - Up to 3 events per city_campaign (cluster 1 = Fri Oct 31,
 *     cluster 2 = Sat Nov 1, cluster 3 = Sun Nov 2). Clusters
 *     without any data are skipped.
 *   - venue_events for every confirmed venue with role +
 *     slot_position
 *   - cold_outreach_entries for warm leads (status='interested')
 *     and cold rows (status='not_contacted')
 *
 * Dry-run mode (the default) returns a preview report WITHOUT
 * writing anything. Phase 4 wires this into the /admin/halloween-import
 * page so the operator can review every match decision before
 * clicking "Apply".
 *
 * Idempotency: when not in dry-run mode and a "Halloween 2025"
 * campaign already exists, the importer:
 *   - Reuses the existing campaign + city_campaigns
 *   - Skips events that already exist for (city_campaign,
 *     eventDate)
 *   - Skips venue_events that already exist for (event_id,
 *     venue_id, role)
 *   - Skips cold_outreach_entries that already exist for
 *     (city_campaign_id, venue_id) — same dedupe rule as
 *     upsertColdOutreachEntry
 *
 * Source-of-truth rule (matches venue-resolver.ts): NEVER
 * overwrite operator data. Backfill (email/phone/etc) only
 * happens for fields currently NULL on the venue.
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  events,
  campaigns,
  cityCampaigns,
  coldOutreachEntries,
  crawlBrands,
  outreachBrands,
  venueEvents,
} from "@/db/schema";
import { db } from "@/lib/db";
import { matchCity } from "@/lib/import/city-matcher";
import { type ResolverOverrides, loadResolverOverrides } from "@/lib/import/resolver-overrides";
import {
  type ResolveDecision,
  type ResolveResult,
  resolveVenue,
} from "@/lib/import/venue-resolver";
import { logger } from "@/lib/logger";
import { and, eq, isNull } from "drizzle-orm";

/**
 * Per-campaign configuration consumed by runCampaignImport.
 *
 * Every campaign import (Halloween 2025, SPD 2026, NYE 2026, the
 * three legacy 2024/2025 campaigns) provides one of these. The
 * generic orchestrator handles everything else identically.
 */
export interface CampaignImportConfig {
  /** URL-safe slug stored on campaigns.slug. Must be unique. */
  slug: string;
  /** Human-readable name shown in the UI + stored on campaigns.name. */
  name: string;
  /** Maps to campaigns.holiday_type enum. */
  holidayType: "stpaddys" | "halloween" | "newyears" | "custom";
  /** First day of the campaign. ISO date string (YYYY-MM-DD). */
  startDate: string;
  /** Last day of the campaign. ISO date string. */
  endDate: string;
  /** Path to the parsed xlsx JSON, relative to repo root. */
  jsonPath: string;
  /** Path to the resolver overrides JSON, relative to repo root.
   *  Optional — campaigns without verify-pass corrections leave this
   *  unset or point at a non-existent file (loader returns EMPTY). */
  overridesPath?: string;
  /** Optional env var name that, when set, overrides jsonPath. Useful
   *  escape hatch for ops if the file isn't in the standalone bundle. */
  jsonPathEnvVar?: string;
  /** Write mode.
   *
   *  "active":  full pipeline — campaign + city_campaigns + events +
   *             venue_events + cold_outreach (interested + not_contacted).
   *             Used for currently-running campaigns where the operator
   *             will work the cold outreach queue.
   *
   *  "history": venues + venue_events for confirmed slots only. NO
   *             cold_outreach writes. Used for past campaigns where
   *             we want the historical record (which venues were
   *             confirmed in this campaign, for the city-venues
   *             "previously used in" badge) without polluting the
   *             outreach queue.
   *
   *  The default is "active" for backward compatibility with
   *  Halloween 2025. */
  mode?: "active" | "history";
  /** Cluster_num (from the parsed xlsx JSON) → event-row mapping.
   *  See CampaignClusterConfig docs above. Every cluster_num
   *  referenced by source rows must have an entry here, or the
   *  orchestrator will skip those rows (with a warning). */
  clusters: Record<number, CampaignClusterConfig>;
}

/**
 * The Halloween 2025 campaign config — kept here for the legacy
 * `runHalloween2025Import` shim. New callers should define their own
 * config and call runCampaignImport directly.
 */
export const HALLOWEEN_2025_CONFIG: CampaignImportConfig = {
  slug: "halloween-2025",
  name: "Halloween 2025",
  holidayType: "halloween",
  startDate: "2025-10-31",
  endDate: "2025-11-02",
  jsonPath: "data/halloween_2025.json",
  overridesPath: "data/halloween_2025_resolver_overrides.json",
  jsonPathEnvVar: "HALLOWEEN_JSON_PATH",
  mode: "active",
  clusters: {
    1: { date: "2025-10-31", dayPart: "friday_night" },
    2: { date: "2025-11-01", dayPart: "saturday_night" },
    3: { date: "2025-11-02", dayPart: "sunday_night" },
  },
};

/**
 * Resolve the import JSON. Next.js standalone builds strip
 * non-code files unless declared in outputFileTracingIncludes,
 * so we look in a few likely locations + fall back to a path
 * the operator can set via env. Returns the first one that
 * exists; throws ENOENT only if all paths fail.
 *
 * Order:
 *   1. HALLOWEEN_JSON_PATH env (escape hatch for ops)
 *   2. <cwd>/data/halloween_2025.json (dev + standalone with
 *       outputFileTracingIncludes)
 *   3. <cwd>/../data/halloween_2025.json (standalone runs from
 *       .next/standalone/; the repo root is the parent of cwd
 *       when the operator deploys the standalone bundle next
 *       to a copy of the repo)
 *   4. <cwd>/.next/standalone/data/halloween_2025.json (dev
 *       after a production build)
 */
async function resolveJsonPath(config: CampaignImportConfig): Promise<string> {
  const candidates = [
    config.jsonPathEnvVar ? process.env[config.jsonPathEnvVar] : undefined,
    path.join(process.cwd(), config.jsonPath),
    path.join(process.cwd(), "..", config.jsonPath),
    path.join(process.cwd(), ".next", "standalone", config.jsonPath),
  ].filter((p): p is string => typeof p === "string" && p.length > 0);

  for (const c of candidates) {
    try {
      await fs.access(c);
      return c;
    } catch {
      // try next
    }
  }

  // Build a clear error message listing what we tried so the
  // operator can see exactly which paths failed.
  const tried = candidates.map((c) => `  - ${c}`).join("\n");
  const envHint = config.jsonPathEnvVar
    ? ` Or set the ${config.jsonPathEnvVar} env var to an absolute path.`
    : "";
  throw new Error(
    `${config.name} import JSON not found. Tried:
${tried}
Either deploy with ${config.jsonPath} included in the standalone bundle (see next.config.ts outputFileTracingIncludes or deploy.sh's cp -r data/ step).${envHint}`,
  );
}

// =========================================================================
// Cluster → event-row mapping
// =========================================================================
// Different campaigns lay out their crawls differently:
//
//   Halloween 2025: 3 nights × 1 crawl/night
//     Cluster 1 → Fri 10/31 (slot 1)
//     Cluster 2 → Sat 11/1  (slot 1)
//     Cluster 3 → Sun 11/2  (slot 1)
//
//   SPD 2026: 2 nights × multiple crawls/night
//     Cluster 1 → Fri 3/13 slot 1 (Friday Crawl 1)
//     Cluster 2 → Fri 3/13 slot 2 (Friday Crawl 2)
//     Cluster 3 → Sat 3/14 slot 1 (Saturday Crawl 1)
//     Cluster 4 → Sat 3/14 slot 2 (Saturday Crawl 2)
//     Cluster 5 → Sat 3/14 slot 3 (Saturday Crawl 3)
//
// The CampaignImportConfig.clusters field encodes the per-campaign
// mapping. ensureEvent reads it.

export interface CampaignClusterConfig {
  /** ISO date YYYY-MM-DD that this cluster runs on. */
  date: string;
  /** day_part pgEnum value. */
  dayPart:
    | "thursday_night"
    | "friday_night"
    | "saturday_day"
    | "saturday_night"
    | "sunday_day"
    | "sunday_night"
    | "other";
  /** events.slot_number — when multiple crawls fall on the same date,
   *  slot_number distinguishes them. Defaults to 1. The unique index
   *  is (city_campaign, date, slot_number). */
  slotNumber?: number;
  /** events.crawl_number — Halloween-style 1-indexed crawl ordering.
   *  Defaults to the cluster_num key. */
  crawlNumber?: number;
}

// =========================================================================
// Source JSON types — mirrors the parser output from Phase 1
// =========================================================================

interface SourceConfirmedVenue {
  cluster_num: number;
  date_label: string;
  slot_role: string;
  slot_position: number;
  venue_type_raw: string;
  venue_name: string;
  venue_email: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  proposed_hours: string | null;
  address: string | null;
  capacity: string | null;
  specials: string | null;
  notes: string | null;
  confirmation: string | null;
}

interface SourceWarmLead {
  status_note: string | null;
  venue_name: string;
  venue_email: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  proposed_hours: string | null;
  cluster: string | null;
  capacity: string | null;
  specials: string | null;
  notes: string | null;
}

interface SourceColdEntry {
  venue_name: string;
  status_raw: string | null;
  venue_email: string | null;
  cluster: string | null;
  phone: string | null;
  other_contact: string | null;
  hours: string | null;
  alt_email: string | null;
  notes: string | null;
}

interface SourceCity {
  sheet_name: string;
  city_label: string;
  confirmed_venues: SourceConfirmedVenue[];
  warm_leads: SourceWarmLead[];
  cold_outreach: SourceColdEntry[];
}

// =========================================================================
// Result types — what the dry-run + real run return
// =========================================================================

export interface ImportDecisionRow {
  sourceCity: string;
  sourceVenueName: string;
  /** Where in the source it came from */
  origin: "confirmed" | "warm" | "cold";
  /** Cluster + slot for confirmed venues; null otherwise */
  clusterNum: number | null;
  slotRole: string | null;
  slotPosition: number | null;
  /** City match decision */
  cityMatch:
    | { ok: true; cityId: string; cityName: string; decision: string }
    | { ok: false; reason: "no_match" | "ambiguous" };
  /** Venue match decision (only set when cityMatch.ok) */
  venueDecision?: ResolveDecision;
  venueId?: string | null;
  venueSimilarity?: number | null;
  fieldBackfills?: ResolveResult["fieldBackfills"];
  /** Whether we wrote (or would write) a cold_outreach_entries row */
  wouldAddToColdOutreach: boolean;
  /** Whether we wrote (or would write) a venue_events row */
  wouldAddVenueEvent: boolean;
}

export interface ImportReport {
  dryRun: boolean;
  startedAt: string;
  endedAt: string;
  citiesAttempted: number;
  citiesMatched: number;
  citiesSkipped: number;
  campaignId: string | null;
  campaignSlug: string;
  countsByDecision: Record<ResolveDecision | "city_skipped", number>;
  countsByOrigin: { confirmed: number; warm: number; cold: number };
  decisions: ImportDecisionRow[];
  /** Optional warnings / errors collected during the run */
  warnings: string[];
}

interface ImportOpts {
  /** When true, no writes happen. Default true — operator must
   *  explicitly pass false to commit. */
  dryRun?: boolean;
  /** Limit how many cities to process. Useful for incremental
   *  test runs ("first 5 cities only"). Null = all. */
  cityLimit?: number | null;
  /** When true, ONLY this sheet_name is processed. Used by the
   *  admin UI to re-run a single city. */
  onlySheetName?: string | null;
  /** Staff id for audit logging. */
  staffId: string;
}

// =========================================================================
// Public entry — runImport
// =========================================================================

export async function runCampaignImport(
  config: CampaignImportConfig,
  opts: ImportOpts,
): Promise<ImportReport> {
  const startedAt = new Date().toISOString();
  const dryRun = opts.dryRun ?? true;
  const mode = config.mode ?? "active";

  const report: ImportReport = {
    dryRun,
    startedAt,
    endedAt: "",
    citiesAttempted: 0,
    citiesMatched: 0,
    citiesSkipped: 0,
    campaignId: null,
    campaignSlug: config.slug,
    countsByDecision: {
      exact: 0,
      trgm: 0,
      stub_new: 0,
      skipped: 0,
      override: 0,
      city_skipped: 0,
    },
    countsByOrigin: { confirmed: 0, warm: 0, cold: 0 },
    decisions: [],
    warnings: [],
  };

  // ---------------- Read JSON ----------------
  let source: Record<string, SourceCity>;
  try {
    const resolvedPath = await resolveJsonPath(config);
    const raw = await fs.readFile(resolvedPath, "utf-8");
    source = JSON.parse(raw) as Record<string, SourceCity>;
    logger.info({ resolvedPath, slug: config.slug }, "campaign import: JSON loaded");
  } catch (err) {
    logger.error({ err, slug: config.slug }, "campaign import: failed to read JSON");
    report.warnings.push((err as Error).message);
    report.endedAt = new Date().toISOString();
    return report;
  }

  // ---------------- Load resolver overrides ----------------
  // Per-campaign override map redirects source rows (city, venueName)
  // to the correct venue ID, protecting verify-pass relinks/splits
  // from being undone by trgm fuzzy-matching. Safe to call
  // unconditionally — degrades to EMPTY when the path is unset or
  // the file is missing (e.g. fresh campaigns that haven't had a
  // verify pass yet).
  const overrides = config.overridesPath
    ? await loadResolverOverrides(config.overridesPath)
    : await loadResolverOverrides("");
  if (overrides.size > 0) {
    report.warnings.push(
      `resolver overrides loaded: ${overrides.size} (city, venue) → venueId mappings active`,
    );
  }

  // ---------------- Ensure campaign row exists ----------------
  // In dry-run we still resolve / would-create the campaign so
  // the report has a stable campaignId for downstream callers.
  // Wrap in try/catch so a campaign-level failure (missing
  // outreach_brands/crawl_brands, DB issue, etc.) becomes a
  // warning instead of killing the entire run. On apply, the
  // city loop will then see campaignId=null and skip the writes
  // that require it — which is the right behavior because we
  // can't create city_campaigns without a campaign.
  let campaignId: string | null = null;
  try {
    campaignId = await ensureCampaign({ config, dryRun });
  } catch (campErr) {
    const msg = (campErr as Error)?.message ?? String(campErr);
    logger.error({ err: campErr, slug: config.slug }, "campaign import: ensureCampaign failed");
    report.warnings.push(
      `Campaign create/lookup failed: ${msg}. Most likely cause: no outreach_brands or crawl_brands rows in the database. Create one of each in the admin UI, then re-run.`,
    );
  }
  report.campaignId = campaignId;

  // ---------------- Per-city loop ----------------
  let processed = 0;
  for (const [sheetName, body] of Object.entries(source)) {
    if (opts.onlySheetName && sheetName !== opts.onlySheetName) continue;
    if (opts.cityLimit && processed >= opts.cityLimit) break;
    processed++;
    report.citiesAttempted++;

    const cityResult = await matchCity(sheetName);
    if (!cityResult) {
      report.citiesSkipped++;
      report.countsByDecision.city_skipped++;
      report.decisions.push({
        sourceCity: sheetName,
        sourceVenueName: "(city not matched)",
        origin: "confirmed",
        clusterNum: null,
        slotRole: null,
        slotPosition: null,
        cityMatch: { ok: false, reason: "no_match" },
        wouldAddToColdOutreach: false,
        wouldAddVenueEvent: false,
      });
      continue;
    }
    report.citiesMatched++;

    // Per-city try/catch — when something inside one city's
    // processing throws, log + warn + move on to the next city
    // rather than killing the whole import. Without this, a
    // single bad venue (long name, constraint violation, etc.)
    // would silently skip every city alphabetically after it.
    try {
      // Ensure (or would-create) the city_campaign for this city
      const cityCampaignId = campaignId
        ? await ensureCityCampaign({
            cityId: cityResult.cityId,
            campaignId,
            dryRun,
            staffId: opts.staffId,
          })
        : null;

      // Process the three source buckets — each is internally
      // try/catched per-row so one bad row doesn't kill the rest
      // of a city's data.
      await processConfirmedVenues({
        body,
        cityResult,
        cityCampaignId,
        campaignId,
        sheetName,
        dryRun,
        report,
        overrides,
        config,
        mode,
      });
      await processWarmLeads({
        body,
        cityResult,
        cityCampaignId,
        sheetName,
        dryRun,
        report,
        overrides,
        mode,
      });
      await processColdOutreach({
        body,
        cityResult,
        cityCampaignId,
        sheetName,
        dryRun,
        report,
        overrides,
        mode,
      });
    } catch (cityErr) {
      const msg = (cityErr as Error).message ?? String(cityErr);
      logger.error(
        { err: cityErr, sheetName, cityId: cityResult.cityId, slug: config.slug },
        "campaign import: city loop failed",
      );
      report.warnings.push(`[${sheetName}] city loop failed: ${msg}`);
      // Continue to next city — don't bail.
    }
  }

  report.endedAt = new Date().toISOString();
  logger.info(
    {
      slug: config.slug,
      dryRun,
      cities: report.citiesAttempted,
      matched: report.citiesMatched,
      counts: report.countsByDecision,
      decisions: report.decisions.length,
    },
    "campaign import: complete",
  );
  return report;
}

// =========================================================================
// Helpers — campaign + city_campaign + event ensure
// =========================================================================

async function ensureCampaign(opts: {
  config: CampaignImportConfig;
  dryRun: boolean;
}): Promise<string | null> {
  const existing = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(eq(campaigns.slug, opts.config.slug))
    .limit(1)
    .then((r) => r[0]);
  if (existing) return existing.id;

  if (opts.dryRun) {
    // Dry-run: no id available, but we surface "would create" via
    // the report (count of decisions with no campaignId).
    return null;
  }

  // Find brand pair for the campaign. Picks the first active of
  // each — operator can re-parent if needed.
  const obrand = await db
    .select({ id: outreachBrands.id })
    .from(outreachBrands)
    .limit(1)
    .then((r) => r[0]);
  const cbrand = await db
    .select({ id: crawlBrands.id })
    .from(crawlBrands)
    .limit(1)
    .then((r) => r[0]);

  if (!obrand || !cbrand) {
    throw new Error(
      `${opts.config.name} import: cannot create campaign — missing outreach_brands or crawl_brands rows`,
    );
  }

  const [row] = await db
    .insert(campaigns)
    .values({
      slug: opts.config.slug,
      name: opts.config.name,
      outreachBrandId: obrand.id,
      crawlBrandId: cbrand.id,
      holidayType: opts.config.holidayType,
      status: "planning",
      startDate: opts.config.startDate,
      endDate: opts.config.endDate,
    })
    .returning({ id: campaigns.id });
  if (!row) throw new Error(`${opts.config.name} import: insert campaigns returned no row`);
  return row.id;
}

async function ensureCityCampaign(opts: {
  cityId: string;
  campaignId: string;
  dryRun: boolean;
  staffId: string;
}): Promise<string | null> {
  const existing = await db
    .select({ id: cityCampaigns.id })
    .from(cityCampaigns)
    .where(
      and(eq(cityCampaigns.cityId, opts.cityId), eq(cityCampaigns.campaignId, opts.campaignId)),
    )
    .limit(1)
    .then((r) => r[0]);
  if (existing) return existing.id;

  if (opts.dryRun) return null;

  const [row] = await db
    .insert(cityCampaigns)
    .values({
      cityId: opts.cityId,
      campaignId: opts.campaignId,
      status: "planning",
    })
    .returning({ id: cityCampaigns.id });
  if (!row) throw new Error("campaign import: insert city_campaigns returned no row");
  return row.id;
}

async function ensureEvent(opts: {
  cityCampaignId: string;
  clusterNum: number;
  config: CampaignImportConfig;
  dryRun: boolean;
}): Promise<string | null> {
  const meta = opts.config.clusters[opts.clusterNum];
  if (!meta) return null;

  const slotNumber = meta.slotNumber ?? 1;
  const crawlNumber = meta.crawlNumber ?? opts.clusterNum;

  // Lookup uses the (city_campaign, date, slot_number) unique index.
  // Without slot_number, multi-crawl-per-date campaigns (e.g. SPD 2026
  // with Friday Crawl 1 + Friday Crawl 2 both on the same Friday) would
  // collide — the second cluster would find the first cluster's event
  // and reuse it.
  const existing = await db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.cityCampaignId, opts.cityCampaignId),
        eq(events.eventDate, meta.date),
        eq(events.slotNumber, slotNumber),
      ),
    )
    .limit(1)
    .then((r) => r[0]);
  if (existing) return existing.id;

  if (opts.dryRun) return null;

  // dayPart is a pgEnum — Drizzle accepts the string value
  const [row] = await db
    .insert(events)
    .values({
      cityCampaignId: opts.cityCampaignId,
      eventDate: meta.date,
      slotNumber,
      // biome-ignore lint/suspicious/noExplicitAny: dayPart enum value
      dayPart: meta.dayPart as any,
      crawlNumber,
      status: "planned",
    })
    .returning({ id: events.id });
  if (!row) throw new Error(`${opts.config.name} import: insert events returned no row`);
  return row.id;
}

// =========================================================================
// Per-bucket processors
// =========================================================================

async function processConfirmedVenues(args: {
  body: SourceCity;
  cityResult: NonNullable<Awaited<ReturnType<typeof matchCity>>>;
  cityCampaignId: string | null;
  campaignId: string | null;
  sheetName: string;
  dryRun: boolean;
  report: ImportReport;
  overrides: ResolverOverrides;
  config: CampaignImportConfig;
  mode: "active" | "history";
}): Promise<void> {
  for (const v of args.body.confirmed_venues) {
    args.report.countsByOrigin.confirmed++;

    // Per-row try/catch — a single bad venue (long name, NULL
    // violation, invalid enum, etc.) should not kill the rest
    // of this city's data. Log + warn + move on.
    try {
      const resolved = await resolveVenue({
        name: v.venue_name,
        cityId: args.cityResult.cityId,
        sourceCity: args.sheetName,
        overrides: args.overrides,
        source: {
          email: v.venue_email ?? null,
          phoneRaw: v.contact_phone ?? null,
          address: v.address ?? null,
          capacity: parseCapacity(v.capacity),
          contactName: v.contact_name ?? null,
        },
        dryRun: args.dryRun,
      });
      bumpDecision(args.report, resolved.decision);

      // Skip when name was empty or unresolvable
      if (resolved.decision === "skipped") {
        args.report.decisions.push(
          buildDecisionRow({
            sheetName: args.sheetName,
            cityResult: args.cityResult,
            v: {
              name: v.venue_name,
              cluster: v.cluster_num,
              role: v.slot_role,
              pos: v.slot_position,
            },
            origin: "confirmed",
            resolved,
            wouldVE: false,
            wouldCO: false,
          }),
        );
        continue;
      }

      // Ensure the event for the cluster + write venue_event
      let wouldVE = false;
      if (args.cityCampaignId && resolved.venueId) {
        const eventId = await ensureEvent({
          cityCampaignId: args.cityCampaignId,
          clusterNum: v.cluster_num,
          config: args.config,
          dryRun: args.dryRun,
        });
        if (eventId) {
          wouldVE = await maybeInsertVenueEvent({
            eventId,
            venueId: resolved.venueId,
            role: mapSlotRole(v.slot_role),
            slotPosition: v.slot_position,
            // Per-event fields from the xlsx row. These are the
            // bar-side contact for this specific slot + the agreed
            // hours + drink specials. Different from the venue's
            // primary email/phone (which go on the venues table).
            nightOfContactName: v.contact_name ?? null,
            nightOfContactPhoneRaw: v.contact_phone ?? null,
            agreedHoursText: v.proposed_hours ?? null,
            drinkSpecials: v.specials ?? null,
            dryRun: args.dryRun,
            warnings: args.report.warnings,
            warningContext: `${args.sheetName} :: "${v.venue_name}"`,
          });
        } else if (args.dryRun) {
          // dry-run path: would-create the event AND would-add a venue_event
          wouldVE = true;
        }
      } else if (args.dryRun) {
        wouldVE = true;
      }

      args.report.decisions.push(
        buildDecisionRow({
          sheetName: args.sheetName,
          cityResult: args.cityResult,
          v: {
            name: v.venue_name,
            cluster: v.cluster_num,
            role: v.slot_role,
            pos: v.slot_position,
          },
          origin: "confirmed",
          resolved,
          wouldVE,
          wouldCO: false,
        }),
      );
    } catch (rowErr) {
      logger.error(
        { err: rowErr, sheetName: args.sheetName, venueName: v.venue_name },
        "campaign import: confirmed-venue row failed",
      );
      args.report.warnings.push(
        `[${args.sheetName}] confirmed venue "${v.venue_name}" failed: ${
          (rowErr as Error).message ?? String(rowErr)
        }`,
      );
      // Continue to next row.
    }
  }
}

async function processWarmLeads(args: {
  body: SourceCity;
  cityResult: NonNullable<Awaited<ReturnType<typeof matchCity>>>;
  cityCampaignId: string | null;
  sheetName: string;
  dryRun: boolean;
  report: ImportReport;
  overrides: ResolverOverrides;
  mode: "active" | "history";
}): Promise<void> {
  for (const v of args.body.warm_leads) {
    args.report.countsByOrigin.warm++;
    try {
      const resolved = await resolveVenue({
        name: v.venue_name,
        cityId: args.cityResult.cityId,
        sourceCity: args.sheetName,
        overrides: args.overrides,
        source: {
          email: v.venue_email ?? null,
          phoneRaw: v.contact_phone ?? null,
          capacity: parseCapacity(v.capacity),
          contactName: v.contact_name ?? null,
        },
        dryRun: args.dryRun,
      });
      bumpDecision(args.report, resolved.decision);

      // In history mode we still resolve venues (creates + backfills),
      // but skip the cold_outreach row write. Past-campaign warm
      // leads shouldn't pollute the current outreach queue.
      const wouldCO =
        args.mode === "history"
          ? false
          : await maybeInsertColdOutreach({
              cityCampaignId: args.cityCampaignId,
              venueId: resolved.venueId,
              status: "interested",
              dryRun: args.dryRun,
            });

      args.report.decisions.push(
        buildDecisionRow({
          sheetName: args.sheetName,
          cityResult: args.cityResult,
          v: { name: v.venue_name, cluster: null, role: null, pos: null },
          origin: "warm",
          resolved,
          wouldVE: false,
          wouldCO,
        }),
      );
    } catch (rowErr) {
      logger.error(
        { err: rowErr, sheetName: args.sheetName, venueName: v.venue_name },
        "campaign import: warm-lead row failed",
      );
      args.report.warnings.push(
        `[${args.sheetName}] warm lead "${v.venue_name}" failed: ${
          (rowErr as Error).message ?? String(rowErr)
        }`,
      );
    }
  }
}

async function processColdOutreach(args: {
  body: SourceCity;
  cityResult: NonNullable<Awaited<ReturnType<typeof matchCity>>>;
  cityCampaignId: string | null;
  sheetName: string;
  dryRun: boolean;
  report: ImportReport;
  overrides: ResolverOverrides;
  mode: "active" | "history";
}): Promise<void> {
  // History mode skips cold outreach entirely — we don't want past
  // campaigns surfacing as todo-list cold rows in the current UI.
  // (The venues from the cold section in legacy xlsx files are still
  // useful as venue records — but those get resolved/created by the
  // confirmed + warm processors when the same venue appears there.)
  if (args.mode === "history") return;

  for (const v of args.body.cold_outreach) {
    args.report.countsByOrigin.cold++;
    try {
      const resolved = await resolveVenue({
        name: v.venue_name,
        cityId: args.cityResult.cityId,
        sourceCity: args.sheetName,
        overrides: args.overrides,
        source: {
          email: v.venue_email ?? v.alt_email ?? null,
          phoneRaw: v.phone ?? v.other_contact ?? null,
        },
        dryRun: args.dryRun,
      });
      bumpDecision(args.report, resolved.decision);

      const wouldCO = await maybeInsertColdOutreach({
        cityCampaignId: args.cityCampaignId,
        venueId: resolved.venueId,
        status: "not_contacted",
        dryRun: args.dryRun,
      });

      args.report.decisions.push(
        buildDecisionRow({
          sheetName: args.sheetName,
          cityResult: args.cityResult,
          v: { name: v.venue_name, cluster: null, role: null, pos: null },
          origin: "cold",
          resolved,
          wouldVE: false,
          wouldCO,
        }),
      );
    } catch (rowErr) {
      logger.error(
        { err: rowErr, sheetName: args.sheetName, venueName: v.venue_name },
        "campaign import: cold-outreach row failed",
      );
      args.report.warnings.push(
        `[${args.sheetName}] cold "${v.venue_name}" failed: ${
          (rowErr as Error).message ?? String(rowErr)
        }`,
      );
    }
  }
}

// =========================================================================
// Write helpers — return true when a row was (or would be) inserted
// =========================================================================

async function maybeInsertVenueEvent(opts: {
  eventId: string;
  venueId: string;
  role: string;
  slotPosition: number | null;
  /** Bar-side contact for THIS event slot — different from
   *  venues.phoneE164 (which is the main venue line). The xlsx
   *  provides this per-row. */
  nightOfContactName?: string | null;
  nightOfContactPhoneRaw?: string | null;
  /** Free-text hours like "7:30-10:30" — agreed-on slot for this
   *  particular event. */
  agreedHoursText?: string | null;
  /** Specials the venue is offering for this event. */
  drinkSpecials?: string | null;
  dryRun: boolean;
  /** Optional warning-collector. When a slot conflict is detected
   *  (i.e. (event, role, position) is already occupied by a
   *  DIFFERENT venue), append a human-readable message here
   *  instead of throwing. The orchestrator's per-row try/catch
   *  already handles other failures; this collector exists so
   *  slot conflicts surface as informational warnings rather
   *  than red error rows. */
  warnings?: string[];
  /** Sheet name for the warning message context. */
  warningContext?: string;
}): Promise<boolean> {
  // ----------------------------------------------------------------
  // Pre-check 1 — (event, venue) collision
  //
  // The DB unique index `venue_events_venue_event_unique` is on
  // (venue_id, event_id) WITHOUT role. So a venue trying to fill
  // TWO roles in the same event would pass a (event, venue, role)
  // check but fail the DB. We widen the pre-check to (event, venue)
  // and treat any match as "already represented — backfill onto it
  // regardless of role."
  // ----------------------------------------------------------------
  const existing = await db
    .select({
      id: venueEvents.id,
      role: venueEvents.role,
      slotPosition: venueEvents.slotPosition,
      nightOfContactName: venueEvents.nightOfContactName,
      nightOfContactPhoneE164: venueEvents.nightOfContactPhoneE164,
      agreedHoursText: venueEvents.agreedHoursText,
      drinkSpecials: venueEvents.drinkSpecials,
    })
    .from(venueEvents)
    .where(and(eq(venueEvents.eventId, opts.eventId), eq(venueEvents.venueId, opts.venueId)))
    .limit(1)
    .then((r) => r[0]);

  // Helper to normalize the source phone to E.164 format. Same
  // pattern as venue-resolver — lenient with operator typos.
  const normalizePhone = (raw: string | null | undefined): string | null => {
    if (!raw) return null;
    const trimmed = String(raw).trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("+")) return trimmed;
    const digits = trimmed.replace(/[^\d]/g, "");
    if (!digits) return null;
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
    return digits;
  };

  if (existing) {
    // Backfill — populate ONLY currently-NULL fields. Never
    // overwrite operator edits.
    const updates: Record<string, unknown> = {};
    if (!existing.nightOfContactName && opts.nightOfContactName) {
      updates.nightOfContactName = opts.nightOfContactName.trim();
    }
    if (!existing.nightOfContactPhoneE164 && opts.nightOfContactPhoneRaw) {
      const e164 = normalizePhone(opts.nightOfContactPhoneRaw);
      if (e164) updates.nightOfContactPhoneE164 = e164;
    }
    if (!existing.agreedHoursText && opts.agreedHoursText) {
      updates.agreedHoursText = opts.agreedHoursText.trim();
    }
    if (!existing.drinkSpecials && opts.drinkSpecials) {
      updates.drinkSpecials = opts.drinkSpecials.trim();
    }
    if (!opts.dryRun && Object.keys(updates).length > 0) {
      await db.update(venueEvents).set(updates).where(eq(venueEvents.id, existing.id));
    }
    return false;
  }

  // ----------------------------------------------------------------
  // Pre-check 2 — (event, role, slot_position) collision
  //
  // The DB has a partial unique index `venue_events_event_role_position_unique`
  // ON (event_id, role, slot_position) WHERE slot_position IS NOT NULL.
  // This blocks two DIFFERENT venues from filling the same role+position
  // slot in the same event.
  //
  // Causes during import:
  //   - Multiple xlsx rows in the same cluster with the same role+position
  //     (operator typo in the source sheet)
  //   - Override map redirects two source rows to different venues, but
  //     they originally pointed at the same role+position slot
  //   - The same venue legitimately appears twice in the xlsx (e.g. listed
  //     as wristband AND middle 1 by accident — caught by Pre-check 1)
  //
  // Resolution: skip the insert + record an informational warning. The
  // operator can resolve the source-data conflict + re-run. The first
  // claimant of the slot keeps it.
  // ----------------------------------------------------------------
  if (opts.slotPosition != null) {
    const slotTaken = await db
      .select({
        id: venueEvents.id,
        venueId: venueEvents.venueId,
      })
      .from(venueEvents)
      .where(
        and(
          eq(venueEvents.eventId, opts.eventId),
          // biome-ignore lint/suspicious/noExplicitAny: enum value
          eq(venueEvents.role, opts.role as any),
          eq(venueEvents.slotPosition, opts.slotPosition),
        ),
      )
      .limit(1)
      .then((r) => r[0]);

    if (slotTaken) {
      // Don't crash — record a warning + skip. Different venue is
      // already in that slot; the operator can decide what to do.
      if (opts.warnings && opts.warningContext) {
        opts.warnings.push(
          `[${opts.warningContext}] slot already filled: role=${opts.role} position=${opts.slotPosition} ` +
            `is held by venueId=${slotTaken.venueId}; skipped trying to add venueId=${opts.venueId}`,
        );
      }
      return false;
    }
  }

  if (opts.dryRun) return true;

  await db.insert(venueEvents).values({
    eventId: opts.eventId,
    venueId: opts.venueId,
    // biome-ignore lint/suspicious/noExplicitAny: enum value
    role: opts.role as any,
    slotPosition: opts.slotPosition,
    status: "confirmed",
    nightOfContactName: opts.nightOfContactName?.trim() || null,
    nightOfContactPhoneE164: normalizePhone(opts.nightOfContactPhoneRaw),
    agreedHoursText: opts.agreedHoursText?.trim() || null,
    drinkSpecials: opts.drinkSpecials?.trim() || null,
  });
  return true;
}

async function maybeInsertColdOutreach(opts: {
  cityCampaignId: string | null;
  venueId: string | null;
  status: "interested" | "not_contacted";
  dryRun: boolean;
}): Promise<boolean> {
  if (!opts.cityCampaignId || !opts.venueId) {
    // Either we don't have the row yet (dry-run before campaign
    // exists) or venue was skipped. Caller still wants a "would
    // create" signal — report yes when both source values are
    // present-modulo-dry-run.
    return opts.dryRun;
  }

  // Existing-row dedupe — same rule as upsertColdOutreachEntry
  const existing = await db
    .select({ id: coldOutreachEntries.id })
    .from(coldOutreachEntries)
    .where(
      and(
        eq(coldOutreachEntries.cityCampaignId, opts.cityCampaignId),
        eq(coldOutreachEntries.venueId, opts.venueId),
        isNull(coldOutreachEntries.archivedAt),
      ),
    )
    .limit(1)
    .then((r) => r[0]);
  if (existing) return false;

  if (opts.dryRun) return true;

  await db.insert(coldOutreachEntries).values({
    cityCampaignId: opts.cityCampaignId,
    venueId: opts.venueId,
    status: opts.status,
  });
  return true;
}

// =========================================================================
// Utilities
// =========================================================================

function bumpDecision(report: ImportReport, d: ResolveDecision): void {
  report.countsByDecision[d] = (report.countsByDecision[d] ?? 0) + 1;
}

function buildDecisionRow(args: {
  sheetName: string;
  cityResult: NonNullable<Awaited<ReturnType<typeof matchCity>>>;
  v: { name: string; cluster: number | null; role: string | null; pos: number | null };
  origin: "confirmed" | "warm" | "cold";
  resolved: ResolveResult;
  wouldVE: boolean;
  wouldCO: boolean;
}): ImportDecisionRow {
  return {
    sourceCity: args.sheetName,
    sourceVenueName: args.v.name,
    origin: args.origin,
    clusterNum: args.v.cluster,
    slotRole: args.v.role,
    slotPosition: args.v.pos,
    cityMatch: {
      ok: true,
      cityId: args.cityResult.cityId,
      cityName: args.cityResult.cityName,
      decision: args.cityResult.decision,
    },
    venueDecision: args.resolved.decision,
    venueId: args.resolved.venueId,
    venueSimilarity: args.resolved.similarity,
    fieldBackfills: args.resolved.fieldBackfills,
    wouldAddVenueEvent: args.wouldVE,
    wouldAddToColdOutreach: args.wouldCO,
  };
}

/**
 * Map the parser's slot_role to the venueRole enum value.
 *   wristband        → 'wristband'
 *   alt_wristband    → 'wristband' (we don't model "alt" wristbands
 *                       separately — there's only one wristband
 *                       per event in the schema)
 *   middle           → 'middle'
 *   final            → 'final'
 *   alt_final        → 'alt_final'
 */
function mapSlotRole(s: string): string {
  switch (s) {
    case "wristband":
    case "alt_wristband":
      return "wristband";
    case "middle":
      return "middle";
    case "final":
      return "final";
    case "alt_final":
      return "alt_final";
    default:
      return "middle";
  }
}

function parseCapacity(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const n = Number(String(raw).replace(/[^\d]/g, ""));
  if (!Number.isFinite(n) || n <= 0 || n > 50000) return null;
  return Math.round(n);
}
