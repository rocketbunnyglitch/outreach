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
import { matchCity } from "@/lib/halloween-import/city-matcher";
import {
  type ResolveDecision,
  type ResolveResult,
  resolveVenue,
} from "@/lib/halloween-import/venue-resolver";
import { logger } from "@/lib/logger";
import { and, eq, isNull } from "drizzle-orm";

const CAMPAIGN_SLUG = "halloween-2025";
const CAMPAIGN_NAME = "Halloween 2025";
const JSON_PATH = "data/halloween_2025.json";

// Cluster N → event date mapping
const CLUSTER_DATES: Record<number, { date: string; dayPart: string }> = {
  1: { date: "2025-10-31", dayPart: "friday_night" },
  2: { date: "2025-11-01", dayPart: "saturday_night" },
  3: { date: "2025-11-02", dayPart: "sunday_night" },
};

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

export async function runHalloween2025Import(opts: ImportOpts): Promise<ImportReport> {
  const startedAt = new Date().toISOString();
  const dryRun = opts.dryRun ?? true;

  const report: ImportReport = {
    dryRun,
    startedAt,
    endedAt: "",
    citiesAttempted: 0,
    citiesMatched: 0,
    citiesSkipped: 0,
    campaignId: null,
    campaignSlug: CAMPAIGN_SLUG,
    countsByDecision: {
      exact: 0,
      trgm: 0,
      stub_new: 0,
      skipped: 0,
      city_skipped: 0,
    },
    countsByOrigin: { confirmed: 0, warm: 0, cold: 0 },
    decisions: [],
    warnings: [],
  };

  // ---------------- Read JSON ----------------
  let source: Record<string, SourceCity>;
  try {
    const raw = await fs.readFile(path.join(process.cwd(), JSON_PATH), "utf-8");
    source = JSON.parse(raw) as Record<string, SourceCity>;
  } catch (err) {
    logger.error({ err, path: JSON_PATH }, "halloween import: failed to read JSON");
    report.warnings.push(`Failed to read ${JSON_PATH}: ${(err as Error).message}`);
    report.endedAt = new Date().toISOString();
    return report;
  }

  // ---------------- Ensure campaign row exists ----------------
  // In dry-run we still resolve / would-create the campaign so
  // the report has a stable campaignId for downstream callers.
  const campaignId = await ensureCampaign({ dryRun });
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

    // Ensure (or would-create) the city_campaign for this city
    const cityCampaignId = campaignId
      ? await ensureCityCampaign({
          cityId: cityResult.cityId,
          campaignId,
          dryRun,
          staffId: opts.staffId,
        })
      : null;

    // Process the three source buckets
    await processConfirmedVenues({
      body,
      cityResult,
      cityCampaignId,
      campaignId,
      sheetName,
      dryRun,
      report,
    });
    await processWarmLeads({
      body,
      cityResult,
      cityCampaignId,
      sheetName,
      dryRun,
      report,
    });
    await processColdOutreach({
      body,
      cityResult,
      cityCampaignId,
      sheetName,
      dryRun,
      report,
    });
  }

  report.endedAt = new Date().toISOString();
  logger.info(
    {
      dryRun,
      cities: report.citiesAttempted,
      matched: report.citiesMatched,
      counts: report.countsByDecision,
      decisions: report.decisions.length,
    },
    "halloween import: complete",
  );
  return report;
}

// =========================================================================
// Helpers — campaign + city_campaign + event ensure
// =========================================================================

async function ensureCampaign(opts: { dryRun: boolean }): Promise<string | null> {
  const existing = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(eq(campaigns.slug, CAMPAIGN_SLUG))
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
      "halloween import: cannot create campaign — missing outreach_brands or crawl_brands rows",
    );
  }

  const [row] = await db
    .insert(campaigns)
    .values({
      slug: CAMPAIGN_SLUG,
      name: CAMPAIGN_NAME,
      outreachBrandId: obrand.id,
      crawlBrandId: cbrand.id,
      holidayType: "halloween",
      status: "planning",
      startDate: "2025-10-31",
      endDate: "2025-11-02",
    })
    .returning({ id: campaigns.id });
  if (!row) throw new Error("halloween import: insert campaigns returned no row");
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
  if (!row) throw new Error("halloween import: insert city_campaigns returned no row");
  return row.id;
}

async function ensureEvent(opts: {
  cityCampaignId: string;
  clusterNum: number;
  dryRun: boolean;
}): Promise<string | null> {
  const meta = CLUSTER_DATES[opts.clusterNum];
  if (!meta) return null;

  const existing = await db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.cityCampaignId, opts.cityCampaignId), eq(events.eventDate, meta.date)))
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
      // biome-ignore lint/suspicious/noExplicitAny: dayPart enum value
      dayPart: meta.dayPart as any,
      crawlNumber: opts.clusterNum,
      status: "planned",
    })
    .returning({ id: events.id });
  if (!row) throw new Error("halloween import: insert events returned no row");
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
}): Promise<void> {
  for (const v of args.body.confirmed_venues) {
    args.report.countsByOrigin.confirmed++;

    const resolved = await resolveVenue({
      name: v.venue_name,
      cityId: args.cityResult.cityId,
      source: {
        email: v.venue_email ?? null,
        phoneRaw: v.contact_phone ?? null,
        address: v.address ?? null,
        capacity: parseCapacity(v.capacity),
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
        dryRun: args.dryRun,
      });
      if (eventId) {
        wouldVE = await maybeInsertVenueEvent({
          eventId,
          venueId: resolved.venueId,
          role: mapSlotRole(v.slot_role),
          slotPosition: v.slot_position,
          dryRun: args.dryRun,
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
        v: { name: v.venue_name, cluster: v.cluster_num, role: v.slot_role, pos: v.slot_position },
        origin: "confirmed",
        resolved,
        wouldVE,
        wouldCO: false,
      }),
    );
  }
}

async function processWarmLeads(args: {
  body: SourceCity;
  cityResult: NonNullable<Awaited<ReturnType<typeof matchCity>>>;
  cityCampaignId: string | null;
  sheetName: string;
  dryRun: boolean;
  report: ImportReport;
}): Promise<void> {
  for (const v of args.body.warm_leads) {
    args.report.countsByOrigin.warm++;

    const resolved = await resolveVenue({
      name: v.venue_name,
      cityId: args.cityResult.cityId,
      source: {
        email: v.venue_email ?? null,
        phoneRaw: v.contact_phone ?? null,
        capacity: parseCapacity(v.capacity),
      },
      dryRun: args.dryRun,
    });
    bumpDecision(args.report, resolved.decision);

    const wouldCO = await maybeInsertColdOutreach({
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
  }
}

async function processColdOutreach(args: {
  body: SourceCity;
  cityResult: NonNullable<Awaited<ReturnType<typeof matchCity>>>;
  cityCampaignId: string | null;
  sheetName: string;
  dryRun: boolean;
  report: ImportReport;
}): Promise<void> {
  for (const v of args.body.cold_outreach) {
    args.report.countsByOrigin.cold++;

    const resolved = await resolveVenue({
      name: v.venue_name,
      cityId: args.cityResult.cityId,
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
  dryRun: boolean;
}): Promise<boolean> {
  // Dedupe rule: don't insert two venue_events for the same
  // (event, venue, role) tuple. The unique index in the schema
  // (event, role, slot_position) doesn't include venue, so the
  // app-level dedupe is "same venue can't take two roles in the
  // same event" — pragmatic for an import.
  const existing = await db
    .select({ id: venueEvents.id })
    .from(venueEvents)
    .where(
      and(
        eq(venueEvents.eventId, opts.eventId),
        eq(venueEvents.venueId, opts.venueId),
        // biome-ignore lint/suspicious/noExplicitAny: enum value
        eq(venueEvents.role, opts.role as any),
      ),
    )
    .limit(1)
    .then((r) => r[0]);
  if (existing) return false;

  if (opts.dryRun) return true;

  await db.insert(venueEvents).values({
    eventId: opts.eventId,
    venueId: opts.venueId,
    // biome-ignore lint/suspicious/noExplicitAny: enum value
    role: opts.role as any,
    slotPosition: opts.slotPosition,
    status: "confirmed",
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
