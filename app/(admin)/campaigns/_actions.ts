"use server";

/**
 * Server actions for Campaign CRUD.
 *
 * Mirrors the brand actions pattern:
 *   1. requireStaff() → redirect to /login if no session
 *   2. Validate with Zod
 *   3. Server-side compatibility check: a Toronto-only CrawlBrand can't be
 *      paired with an international Campaign and vice versa
 *   4. Insert/update inside withAuditContext(staff.id, ...)
 *   5. Revalidate + redirect
 *
 * The two-FK brand structure (DECISIONS#010) is the most important thing
 * the form has to surface — every Campaign FK references BOTH an
 * OutreachBrand and a CrawlBrand. Mixing them up wrong = sending email
 * under the wrong brand identity.
 */

import { events, campaigns, cityCampaigns, crawlBrands, outreachBrands } from "@/db/schema";
import { hasMinimumRole, requireAdmin, requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  type CampaignCreateInput,
  type CampaignUpdateInput,
  campaignCreateSchema,
  campaignUpdateSchema,
} from "@/lib/validation/campaigns";
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { DatabaseError } from "pg";
import { z } from "zod";

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

function formToObject(form: FormData): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const key of new Set(form.keys())) {
    const values = form.getAll(key);
    const last = values[values.length - 1];
    if (typeof last !== "string") {
      obj[key] = last;
      continue;
    }
    if (last === "") obj[key] = undefined;
    else if (last === "_none") obj[key] = null;
    else if (last === "true" || last === "on") obj[key] = true;
    else if (last === "false" || last === "off") obj[key] = false;
    else obj[key] = last;
  }
  return obj;
}

function wrapDbError(err: unknown, action: string): ActionResult<never> {
  const dbErr = err as DatabaseError;
  logger.error({ err, action }, "campaign action failed");
  if (dbErr?.code === "23505") {
    return { ok: false, error: "A campaign with that slug already exists." };
  }
  if (dbErr?.code === "23503") {
    return { ok: false, error: "Referenced brand or country not found." };
  }
  return { ok: false, error: "Unexpected database error. See server logs." };
}

/**
 * Check that the chosen CrawlBrand's geography is consistent with the
 * holiday type. e.g. a Toronto-only StPaddysCrawl brand should not be
 * paired with a Halloween campaign — different brand families.
 *
 * For Phase 4 we keep this minimal: ensure the CrawlBrand's holidayType
 * matches the Campaign's holidayType. (Geography compatibility was a Phase
 * 2 helper aimed at city assignment; here we just match holidays.)
 */
async function validateCrawlBrandCompatibility(
  crawlBrandId: string,
  holidayType: "stpaddys" | "halloween" | "newyears" | "custom",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [row] = await db
    .select({ holidayType: crawlBrands.holidayType })
    .from(crawlBrands)
    .where(eq(crawlBrands.id, crawlBrandId))
    .limit(1);
  if (!row) {
    return { ok: false, error: "Crawl brand not found" };
  }
  if (row.holidayType !== holidayType && holidayType !== "custom") {
    return {
      ok: false,
      error: `Crawl brand is a ${row.holidayType} brand; this campaign is ${holidayType}. Mixing brand families is not allowed.`,
    };
  }
  return { ok: true };
}

export async function createCampaign(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string; slug: string }>> {
  const { staff } = await requireStaff();

  const parsed = campaignCreateSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const input: CampaignCreateInput = parsed.data;

  // Per DECISIONS.md #022 + #023 the form no longer prompts for brand
  // IDs, but the legacy NOT NULL columns are still in place. Auto-fill
  // with the first-available brand of each type so creation works
  // without a schema migration. The brand pair is functionally a no-op
  // — staff picks alias at send time per #022 and crawl_brand is being
  // dropped per #023.
  const fallbackBrands = await db
    .select({ outreachBrandId: outreachBrands.id })
    .from(outreachBrands)
    .limit(1);
  const fallbackCrawl = await db.select({ id: crawlBrands.id }).from(crawlBrands).limit(1);
  const resolvedOutreachBrandId = input.outreachBrandId ?? fallbackBrands[0]?.outreachBrandId;
  const resolvedCrawlBrandId = input.crawlBrandId ?? fallbackCrawl[0]?.id;
  if (!resolvedOutreachBrandId || !resolvedCrawlBrandId) {
    return {
      ok: false,
      error:
        "Cannot create campaign — no outreach or crawl brand exists in the database. Seed at least one brand of each type first.",
    };
  }

  // Only validate crawl-brand compatibility when the operator explicitly
  // picked one. Auto-filled brands are arbitrary and the validation is a
  // no-op safety net we'll fully remove with the crawl_brand schema drop.
  if (input.crawlBrandId) {
    const compat = await validateCrawlBrandCompatibility(input.crawlBrandId, input.holidayType);
    if (!compat.ok) {
      return {
        ok: false,
        error: compat.error,
        fieldErrors: { crawlBrandId: [compat.error] },
      };
    }
  }

  let createdId: string;
  try {
    const [row] = await withAuditContext(staff.id, async (tx) =>
      tx
        .insert(campaigns)
        .values({
          slug: input.slug,
          name: input.name,
          outreachBrandId: resolvedOutreachBrandId,
          crawlBrandId: resolvedCrawlBrandId,
          holidayType: input.holidayType,
          status: input.status ?? "planning",
          startDate: input.startDate,
          endDate: input.endDate,
          // publicSubdomain / revenueGoalCents / venueCountGoal removed
          // per session 11 decisions #024 + #025. The DB columns still
          // exist (drop migration pending) — Drizzle just doesn't write
          // to them.
          //
          // NEW outreach-team goals per #025 + migration 0026. Writeable
          // by all roles; the admin-only ticket-sales target is set
          // separately on /admin/goals.
          targetCitiesScheduled: input.targetCitiesScheduled ?? null,
          maxPriorityForScheduling: input.maxPriorityForScheduling ?? null,
          createdBy: staff.id,
          updatedBy: staff.id,
        })
        .returning({ id: campaigns.id, slug: campaigns.slug }),
    );
    if (!row) throw new Error("Insert returned no row");
    createdId = row.id;
  } catch (err) {
    return wrapDbError(err, "create campaign");
  }

  // Auto-select the new campaign as the operator's current scope.
  // Without this, the dashboard's empty state is misleading ("no
  // campaigns" when one was just created).
  try {
    const { setCurrentCampaignCookie } = await import("@/lib/current-campaign");
    await setCurrentCampaignCookie(createdId);
  } catch {
    // best-effort — non-fatal if cookie write fails
  }

  revalidatePath("/campaigns");
  revalidatePath("/");
  // redirect MUST be outside the try/catch — Next.js redirect throws
  // a special NEXT_REDIRECT error that the framework relies on. If
  // wrapDbError catches it, the user sees a generic "unexpected
  // error" even though the campaign was created successfully.
  redirect(`/campaigns/${createdId}`);
}

export async function updateCampaign(
  id: string,
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();

  const parsed = campaignUpdateSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const input: CampaignUpdateInput = parsed.data;

  const patch: Partial<typeof campaigns.$inferInsert> = {
    updatedBy: staff.id,
  };
  if (input.name !== undefined) patch.name = input.name;
  if (input.holidayType !== undefined) patch.holidayType = input.holidayType;
  if (input.status !== undefined) {
    patch.status = input.status;
    // Status changes drive archive presence — keep archived_at in
    // sync so the campaign switcher + non-admin home page (both
    // gated on archived_at IS NULL) reflect the change immediately.
    //
    // status → 'archived'      ⇒ stamp archived_at
    // status → anything else   ⇒ clear archived_at (restore from
    //                            archive without needing the
    //                            explicit unarchiveCampaign action)
    //
    // Operator: "archived campaigns should not show on the dropdown
    // campaign at the top nor on the non-admin home page" — both
    // already filter isNull(archivedAt), so this autosync is what
    // wires the inline status toggle to the visibility rule.
    if (input.status === "archived") {
      patch.archivedAt = new Date();
    } else {
      patch.archivedAt = null;
    }
  }
  if (input.startDate !== undefined) patch.startDate = input.startDate;
  if (input.endDate !== undefined) patch.endDate = input.endDate;
  // publicSubdomain / revenueGoalCents / venueCountGoal removed from
  // the form per session 11 decisions #024 + #025; columns remain in
  // DB until a follow-up migration drops them.
  //
  // NEW outreach-team goals (#025 + migration 0026). All roles can
  // edit these — they're operational, not financial.
  if (input.targetCitiesScheduled !== undefined) {
    patch.targetCitiesScheduled = input.targetCitiesScheduled;
  }
  if (input.maxPriorityForScheduling !== undefined) {
    patch.maxPriorityForScheduling = input.maxPriorityForScheduling;
  }

  try {
    await withAuditContext(staff.id, async (tx) =>
      tx.update(campaigns).set(patch).where(eq(campaigns.id, id)),
    );
    revalidatePath(`/campaigns/${id}`);
    revalidatePath("/campaigns");
    revalidatePath("/admin/archived-campaigns");
    return { ok: true, data: { id } };
  } catch (err) {
    return wrapDbError(err, "update campaign");
  }
}

/** Shared archive writes (FULL_AUDIT P024): archiving a campaign must also
 *  CLOSE its working set — 8,780 cold entries from three past campaigns sat
 *  "active" forever because this cascade didn't exist, leaking into every
 *  unscoped aggregate. Entries archive with the campaign, atomically. */
async function archiveCampaignWrites(
  tx: Parameters<Parameters<typeof withAuditContext>[1]>[0],
  id: string,
  staffId: string,
): Promise<void> {
  await tx
    .update(campaigns)
    .set({ status: "archived", archivedAt: new Date(), updatedBy: staffId })
    .where(eq(campaigns.id, id));
  await tx.execute(sql`
    UPDATE cold_outreach_entries e
    SET archived_at = NOW(), updated_at = NOW()
    FROM city_campaigns cc
    WHERE cc.id = e.city_campaign_id
      AND cc.campaign_id = ${id}::uuid
      AND e.archived_at IS NULL
  `);
  // Events too (P036: 679 past-campaign events sat active forever) — the
  // campaign's crawls close with the campaign.
  await tx.execute(sql`
    UPDATE events e
    SET archived_at = NOW(), updated_at = NOW()
    FROM city_campaigns cc
    WHERE cc.id = e.city_campaign_id
      AND cc.campaign_id = ${id}::uuid
      AND e.archived_at IS NULL
  `);
  // And their pending deliverables close as N/A (P048: 395 dead pending
  // rows sat in the queues after the import-history archival) — a closed
  // campaign has no outstanding deliverable work by definition.
  await tx.execute(sql`
    UPDATE crawl_deliverables d
    SET status = 'n_a', updated_at = NOW()
    FROM venue_events ve, events e, city_campaigns cc
    WHERE ve.id = d.venue_event_id AND e.id = ve.event_id
      AND cc.id = e.city_campaign_id AND cc.campaign_id = ${id}::uuid
      AND d.status = 'pending'
  `);
}

export async function archiveCampaign(id: string): Promise<void> {
  const { staff } = await requireStaff();
  await withAuditContext(staff.id, async (tx) => archiveCampaignWrites(tx, id, staff.id));
  revalidatePath("/campaigns");
  revalidatePath("/admin/archived-campaigns");
  revalidatePath(`/campaigns/${id}`);
  redirect("/campaigns");
}

/**
 * Same as archiveCampaign but returns a result instead of redirecting.
 * Used by the per-row archive button on /campaigns (caller already
 * there — no need to redirect to same page).
 */
export async function archiveCampaignNoRedirect(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const { staff } = await requireStaff();
  try {
    await withAuditContext(staff.id, async (tx) => archiveCampaignWrites(tx, id, staff.id));
    revalidatePath("/campaigns");
    revalidatePath("/admin/archived-campaigns");
    revalidatePath(`/campaigns/${id}`);
    return { ok: true };
  } catch (err) {
    console.error("[archiveCampaignNoRedirect] failed", { err, campaignId: id, by: staff.id });
    return { ok: false, error: "Couldn't archive campaign." };
  }
}

/**
 * Restore a previously-archived campaign. Clears archived_at and
 * resets status to 'planning' (operator can then transition forward
 * via the campaign detail page).
 *
 * Admin-only — restoring a campaign affects every city_campaign +
 * event + venue_event under it, and the campaign switcher will
 * surface it again.
 */
export async function unarchiveCampaign(id: string): Promise<{ ok: boolean; error?: string }> {
  const { staff } = await requireStaff();
  if (!hasMinimumRole(staff, "admin")) {
    return { ok: false, error: "Admin role required to restore archived campaigns." };
  }
  try {
    await withAuditContext(staff.id, async (tx) =>
      tx
        .update(campaigns)
        .set({ status: "planning", archivedAt: null, updatedBy: staff.id })
        .where(eq(campaigns.id, id)),
    );
    revalidatePath("/campaigns");
    revalidatePath("/admin/archived-campaigns");
    revalidatePath(`/campaigns/${id}`);
    return { ok: true };
  } catch (err) {
    console.error("[unarchiveCampaign] failed", { err, campaignId: id, by: staff.id });
    return { ok: false, error: "Couldn't restore campaign." };
  }
}

/**
 * deleteCampaignWithConfirmation — admin-only, confirmation-gated cascade
 * archive of a campaign and everything underneath.
 *
 * "Delete" is implemented as archive (archived_at = NOW()) on all
 * descendant rows, never DELETE — soft-delete is a hard rule across the
 * engine (CLAUDE.md §6).
 *
 * Cascade order — must match FK reference order to avoid resurrecting
 * archived rows:
 *   1. events under each city_campaign
 *   2. cold_outreach_entries under each city_campaign
 *   3. city_campaigns themselves
 *   4. the campaign
 *
 * Confirmation: caller must pass `confirmName` equal to the campaign's
 * literal name (case-sensitive). Stops accidental clicks and forces the
 * operator to look at what they're about to remove.
 *
 * Permissions: admin role only. Returns 'forbidden' for non-admin so
 * the UI can surface why the operation didn't go through.
 */
export async function deleteCampaignWithConfirmation(
  campaignId: string,
  confirmName: string,
): Promise<{ ok: boolean; error?: string }> {
  const { staff } = await requireStaff();
  if (!hasMinimumRole(staff, "admin")) {
    return { ok: false, error: "Only admins can delete a campaign." };
  }

  const campaign = await db
    .select({ id: campaigns.id, name: campaigns.name })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1)
    .then((r) => r[0]);
  if (!campaign) return { ok: false, error: "Campaign not found." };
  if (campaign.name !== confirmName) {
    return {
      ok: false,
      error: `Confirmation didn't match. Type "${campaign.name}" exactly to delete.`,
    };
  }

  try {
    await withAuditContext(staff.id, async (tx) => {
      // 1. Archive every event in every city_campaign under this campaign
      await tx.execute(sql`
        UPDATE events
        SET archived_at = NOW(), updated_by = ${staff.id}, updated_at = NOW()
        FROM city_campaigns cc
        WHERE events.city_campaign_id = cc.id
          AND cc.campaign_id = ${campaignId}
          AND events.archived_at IS NULL
      `);
      // 2. Archive cold_outreach_entries under those city_campaigns
      await tx.execute(sql`
        UPDATE cold_outreach_entries
        SET archived_at = NOW(), updated_by = ${staff.id}, updated_at = NOW()
        FROM city_campaigns cc
        WHERE cold_outreach_entries.city_campaign_id = cc.id
          AND cc.campaign_id = ${campaignId}
          AND cold_outreach_entries.archived_at IS NULL
      `);
      // 3. Archive city_campaigns themselves
      await tx.execute(sql`
        UPDATE city_campaigns
        SET archived_at = NOW(), updated_by = ${staff.id}, updated_at = NOW()
        WHERE campaign_id = ${campaignId}
          AND archived_at IS NULL
      `);
      // 4. Archive the campaign
      await tx
        .update(campaigns)
        .set({ status: "archived", archivedAt: new Date(), updatedBy: staff.id })
        .where(eq(campaigns.id, campaignId));
    });
  } catch (err) {
    return wrapDbError(err, "delete campaign with cascade");
  }

  revalidatePath("/campaigns");
  return { ok: true };
}

/**
 * addCrawlToCityCampaign — creates a new event (a "crawl") under a city
 * campaign. The schema already supports the venue mix via the
 * required_* columns, so this action just exposes them.
 *
 * Defaults match the most common shape:
 *   - 4 total venues (1 wristband + 2 middles + 1 final)
 *   - alternate shape: 5 total with 3 middles (set via the `extendedMiddle` flag)
 *   - status: planned
 *
 * The operator can later override per-venue hours via the venue_events
 * table's agreed_hours_text — we don't set timing here; that lives on
 * the event's startsAt/endsAt as the tentative wrapper.
 */
export async function addCrawlToCityCampaign(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ eventId: string }>> {
  const { staff } = await requireStaff();
  const parsed = addCrawlSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const input = parsed.data;

  // Resolve next slot_number on the same date
  const existing = await db
    .select({ slot: events.slotNumber })
    .from(events)
    .where(
      and(eq(events.cityCampaignId, input.cityCampaignId), eq(events.eventDate, input.eventDate)),
    );
  const maxSlot = existing.reduce((m, r) => Math.max(m, r.slot), 0);
  const nextSlot = maxSlot + 1;

  // Resolve the human-facing crawl number. If the operator supplied
  // one, use it. Otherwise auto-assign the next number for this
  // (city_campaign, day_part) — "1, 2, 3 within a daypart". Falls
  // back to nextSlot when no daypart (can't bucket by daypart then).
  let crawlNumber = input.crawlNumber ?? null;
  if (crawlNumber == null) {
    if (input.dayPart) {
      const sameDaypart = await db
        .select({ n: events.crawlNumber })
        .from(events)
        .where(
          and(eq(events.cityCampaignId, input.cityCampaignId), eq(events.dayPart, input.dayPart)),
        );
      const maxCrawl = sameDaypart.reduce((m, r) => Math.max(m, r.n ?? 0), 0);
      crawlNumber = maxCrawl + 1;
    } else {
      crawlNumber = nextSlot;
    }
  }

  // Compute the venue mix from the shape choice
  const isExtended = input.extendedMiddle === true;
  const totalRequired = isExtended ? 5 : 4;
  const middlesRequired = isExtended ? 3 : 2;

  let startsAt: Date | null = null;
  let endsAt: Date | null = null;
  if (input.tentativeStart) startsAt = new Date(input.tentativeStart);
  if (input.tentativeEnd) endsAt = new Date(input.tentativeEnd);

  try {
    const [row] = await withAuditContext(staff.id, async (tx) =>
      tx
        .insert(events)
        .values({
          cityCampaignId: input.cityCampaignId,
          eventDate: input.eventDate,
          slotNumber: nextSlot,
          crawlNumber,
          dayPart: input.dayPart ?? null,
          startsAt,
          endsAt,
          routeLabel: input.routeLabel ?? null,
          requiredVenueCountTotal: totalRequired,
          requiredWristbandCount: 1,
          requiredFinalCount: 1,
          requiredMiddleCount: middlesRequired,
          createdBy: staff.id,
          updatedBy: staff.id,
        })
        .returning({ id: events.id }),
    );
    if (!row) return { ok: false, error: "Insert returned no row." };

    revalidatePath(`/city-campaigns/${input.cityCampaignId}`);
    return { ok: true, data: { eventId: row.id } };
  } catch (err) {
    return wrapDbError(err, "add crawl");
  }
}

const addCrawlSchema = z.object({
  cityCampaignId: z
    .string()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
  dayPart: z
    .enum([
      "thursday_night",
      "friday_night",
      "saturday_day",
      "saturday_night",
      "sunday_day",
      "sunday_night",
      "other",
    ])
    .optional(),
  /** "9:00 PM" → ISO timestamp tentative starts_at, mirrored to UTC. */
  tentativeStart: z.string().optional(),
  tentativeEnd: z.string().optional(),
  routeLabel: z.string().max(120).optional(),
  /**
   * Human-facing crawl number ("Crawl 1/2/3" within a daypart).
   * Optional: when omitted, the action auto-assigns the next number
   * for this (city_campaign, day_part). Operators flagged (session
   * 12) that they want to set this on creation.
   */
  crawlNumber: z.coerce.number().int().min(1).max(99).optional(),
  /** 3 middles instead of 2; total = 5 venues. */
  extendedMiddle: z
    .union([
      z.boolean(),
      z.literal("on").transform(() => true),
      z.literal("off").transform(() => false),
    ])
    .optional(),
});

// =========================================================================
// Bulk add crawls (operator session 11 — sibling of #026 bulk-add-cities)
// =========================================================================

/**
 * Create one event/crawl per cityCampaign in this campaign, all on
 * the same date. Skips cities that already have an event on that
 * date+slot (the events_city_campaign_date_slot_unique index does the
 * dedup at insert time via ON CONFLICT DO NOTHING).
 *
 * Operator quote (session 11):
 *   "I should also be able to mass add crawls for all cities for a
 *    campaign so I should be able to choose add crawls for all cities."
 *
 * Semantics for v1:
 *   - One crawl per city per call (slotNumber=1). Cities that already
 *     have a slot-1 crawl on the date are silently skipped.
 *   - extendedMiddle flag controls 4-venue vs 5-venue shape (matches
 *     the per-city addCrawlToCityCampaign).
 *   - No tentative start/end times on bulk — operators set those
 *     per-crawl after. Day-part is enough for the schedule view to
 *     bucket them.
 *
 * Returns { added, skipped } so the operator sees what happened. The
 * action lives here (campaigns/_actions.ts) instead of events/_actions
 * because the operation is scoped to a campaign, not a single event.
 */
export async function addCrawlToAllCities(input: {
  campaignId: string;
  eventDate: string; // yyyy-MM-dd
  dayPart?:
    | "thursday_night"
    | "friday_night"
    | "saturday_day"
    | "saturday_night"
    | "sunday_day"
    | "sunday_night"
    | "other";
  extendedMiddle?: boolean;
  /** Crawl number for the row (e.g. "2" for the second crawl on that
   *  date in the city). Defaults to 1. Doubles as the slot number so
   *  the (cityCampaignId, eventDate, slotNumber) unique index dedups
   *  correctly when operators schedule multiple same-day crawls. */
  crawlNumber?: number;
  /** Range form of crawlNumber. When supplied, the action expands the
   *  range into multiple events per city (e.g. [1, 2, 3] = three
   *  events per city, one at each slot). Overrides crawlNumber if set.
   *  Useful for "add 3 Saturday-night crawls to every P1-3 city." */
  crawlNumbers?: number[];
  /** When set, restrict the bulk-add to just these cityCampaign IDs
   *  ("add crawl to selected cities" flow). When omitted, every city
   *  in the campaign receives the crawl ("add crawl to all" flow). */
  cityCampaignIds?: string[];
  /** When set, restrict the bulk-add to cities whose priority lands
   *  inside this inclusive range. Lets operators say "P1-P3 get 3
   *  crawls" then "P4-P5 get 1 crawl" in two clicks. Defaults to
   *  no priority filter — every city receives. */
  priorityMin?: number;
  priorityMax?: number;
}): Promise<ActionResult<{ added: number; updated: number; total: number }>> {
  const { staff } = await requireStaff();

  // Normalize crawl numbers: prefer the array form when provided, fall
  // back to the single crawlNumber field for back-compat. Validate
  // every entry is 1-9 (matches the slot-number domain).
  const slots = (() => {
    const arr =
      input.crawlNumbers && input.crawlNumbers.length > 0
        ? [...new Set(input.crawlNumbers)].sort((a, b) => a - b)
        : [input.crawlNumber ?? 1];
    return arr;
  })();
  for (const slot of slots) {
    if (!Number.isInteger(slot) || slot < 1 || slot > 9) {
      return { ok: false, error: "Crawl number must be a whole number between 1 and 9." };
    }
  }

  // Schema validation on date — same regex as addCrawlSchema. The action
  // accepts a plain string from the form rather than a parsed Date so
  // PG can do its own date coercion on the column.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.eventDate)) {
    return { ok: false, error: "Date must be in YYYY-MM-DD format." };
  }

  // Priority bounds normalization. Default range covers everything
  // (1..99) when not supplied. Reject inverted ranges.
  const priMin = input.priorityMin ?? 1;
  const priMax = input.priorityMax ?? 99;
  if (priMin > priMax) {
    return { ok: false, error: "Priority min must be <= max." };
  }

  // Pull every cityCampaign in this campaign — optionally filtered to a
  // selected subset OR a priority window. We don't filter by status
  // (even 'cancelled' rows can receive a new crawl; operator may be
  // re-activating them). The cityCampaigns table has no archived_at
  // column (CLAUDE.md §12.1) so no archive filter applies.
  const conditions = [eq(cityCampaigns.campaignId, input.campaignId)];
  if (input.cityCampaignIds && input.cityCampaignIds.length > 0) {
    conditions.push(inArray(cityCampaigns.id, input.cityCampaignIds));
  }
  // Priority filter: include rows whose priority is within the inclusive
  // range. NULL priorities (cities with no priority set) are excluded
  // from priority-bucketed calls — operators should assign a priority
  // before bucket-filtering them. When the range is the full default
  // (1..99 with neither min nor max provided), the filter is skipped
  // entirely so NULL-priority rows are included as before.
  const priorityFilterActive = input.priorityMin !== undefined || input.priorityMax !== undefined;
  if (priorityFilterActive) {
    conditions.push(sql`${cityCampaigns.priority} BETWEEN ${priMin} AND ${priMax}`);
  }

  const ccRows = await db
    .select({ id: cityCampaigns.id })
    .from(cityCampaigns)
    .where(and(...conditions));

  if (ccRows.length === 0) {
    return {
      ok: false,
      error: input.cityCampaignIds
        ? "None of the selected cities are still in this campaign."
        : priorityFilterActive
          ? `No cities in priority ${priMin}-${priMax}. Set city priorities first.`
          : "This campaign has no cities yet. Add cities first, then bulk-add crawls.",
    };
  }

  const isExtended = input.extendedMiddle === true;
  const totalRequired = isExtended ? 5 : 4;
  const middlesRequired = isExtended ? 3 : 2;

  // Build the values list. For each city, emit one row per slot in the
  // requested set. slotNumber + crawlNumber are both set to the slot
  // value — the unique index uses slotNumber for dedup.
  const rows = ccRows.flatMap((cc) =>
    slots.map((slot) => ({
      cityCampaignId: cc.id,
      eventDate: input.eventDate,
      slotNumber: slot,
      crawlNumber: slot,
      dayPart: input.dayPart ?? null,
      requiredVenueCountTotal: totalRequired,
      requiredWristbandCount: 1,
      requiredFinalCount: 1,
      requiredMiddleCount: middlesRequired,
      createdBy: staff.id,
      updatedBy: staff.id,
    })),
  );

  // Key helper so the pre-fetch lookup matches the row generation.
  const rowKey = (cityCampaignId: string, slotNumber: number): string =>
    `${cityCampaignId}::${slotNumber}`;

  try {
    const result = await withAuditContext(staff.id, async (tx) => {
      // Pre-fetch existing rows that would conflict on the unique
      // (city_campaign_id, event_date, slot_number) index. This lets
      // us split INSERTs from UPDATEs and report distinct counts.
      //
      // Previously this used onConflictDoNothing which silently kept
      // the existing row's day_part + venue mix. That caused the
      // operator-reported bug: bulk-adding crawls 1-3 with Saturday
      // Night to a city that already had a slot-1 crawl with a
      // different day_part (or null) would keep the OLD slot 1 with
      // the OLD day_part, while inserting slots 2-3 fresh. Result:
      // crawl 1 appeared on a separate row in the dashboard grid
      // and its city-sheet header showed no Saturday prefix.
      const existing = await tx
        .select({
          id: events.id,
          cityCampaignId: events.cityCampaignId,
          slotNumber: events.slotNumber,
        })
        .from(events)
        .where(
          and(
            inArray(
              events.cityCampaignId,
              ccRows.map((c) => c.id),
            ),
            eq(events.eventDate, input.eventDate),
            inArray(events.slotNumber, slots),
          ),
        );
      const existingById = new Map<string, string>();
      for (const e of existing) {
        existingById.set(rowKey(e.cityCampaignId, e.slotNumber), e.id);
      }

      // Split rows: new ones get INSERTed, existing get UPDATEd so
      // their day_part + venue mix counts align to the new bulk-add
      // intent. operator-set fields (status, crawlFormat, crawlName,
      // notes, ticketSalesCount, eventbrite linkage, startsAt/endsAt,
      // routeLabel, middleVenueGroupId) are NOT touched on update —
      // a bulk-add is "make this slot match these scheduling
      // parameters," not "blow away everything about this crawl."
      const toInsert = rows.filter(
        (r) => !existingById.has(rowKey(r.cityCampaignId, r.slotNumber)),
      );
      const toUpdate = rows.filter((r) => existingById.has(rowKey(r.cityCampaignId, r.slotNumber)));

      let addedCount = 0;
      if (toInsert.length > 0) {
        const ins = await tx.insert(events).values(toInsert).returning({ id: events.id });
        addedCount = ins.length;
      }

      let updatedCount = 0;
      for (const r of toUpdate) {
        const id = existingById.get(rowKey(r.cityCampaignId, r.slotNumber));
        if (!id) continue;
        await tx
          .update(events)
          .set({
            dayPart: r.dayPart,
            crawlNumber: r.crawlNumber,
            requiredVenueCountTotal: r.requiredVenueCountTotal,
            requiredWristbandCount: r.requiredWristbandCount,
            requiredFinalCount: r.requiredFinalCount,
            requiredMiddleCount: r.requiredMiddleCount,
            updatedAt: new Date(),
            updatedBy: staff.id,
          })
          .where(eq(events.id, id));
        updatedCount++;
      }

      return { added: addedCount, updated: updatedCount };
    });

    revalidatePath(`/campaigns/${input.campaignId}`);
    return {
      ok: true,
      data: {
        added: result.added,
        updated: result.updated,
        total: rows.length,
      },
    };
  } catch (err) {
    return wrapDbError(err, "bulk add crawls");
  }
}

// =========================================================================
// Smart weekend bulk-add — multiple passes in one shot
// =========================================================================

/**
 * Run multiple bulk-add passes against a campaign in a single
 * operator action. The natural use case is an entire weekend:
 *
 *   pass 1 — Thursday Night · Oct 30 · slot 1 · all cities
 *   pass 2 — Friday Night · Oct 31 · slot 1 · all cities
 *   pass 3 — Saturday Night · Nov 1 · slot 1 · all cities
 *   pass 4 — Saturday Day · Nov 1 · slot 1 · all cities
 *   pass 5 — Friday Night · Oct 31 · slots 2-4 · priority 1-4
 *   pass 6 — Saturday Night · Nov 1 · slots 2-4 · priority 1-4
 *
 * Each pass is independent: passes can hit different day-parts,
 * different dates, different slot ranges, different priority
 * windows, and different city subsets. The "smart" part is that
 * the operator composes the entire weekend in one form instead of
 * clicking through the single-pass bulk-add six times.
 *
 * Implementation: delegates each pass to addCrawlToAllCities so
 * the validation, filtering, and the insert/update split logic
 * (commit d9a7f69 — pre-fetch + split) stay in one place. Result
 * counts aggregate across passes; per-pass errors are surfaced so
 * a single bad pass doesn't fail the whole operation. Successful
 * passes commit independently — partial completion is possible
 * but the operator gets full per-pass visibility to re-run any
 * failures.
 *
 * revalidatePath is a no-op for the same path after the first call
 * inside a single Server Action, so the N pass invocations all
 * piggyback on each other's revalidation.
 */
export async function bulkAddWeekend(input: {
  campaignId: string;
  passes: Array<{
    eventDate: string;
    dayPart?:
      | "thursday_night"
      | "friday_night"
      | "saturday_day"
      | "saturday_night"
      | "sunday_day"
      | "sunday_night"
      | "other";
    crawlNumbers: number[];
    extendedMiddle?: boolean;
    priorityMin?: number;
    priorityMax?: number;
    cityCampaignIds?: string[];
  }>;
}): Promise<
  ActionResult<{
    totalAdded: number;
    totalUpdated: number;
    totalRows: number;
    passResults: Array<{
      passIndex: number;
      label: string;
      added: number;
      updated: number;
      total: number;
      error?: string;
    }>;
  }>
> {
  await requireStaff();

  if (input.passes.length === 0) {
    return { ok: false, error: "Add at least one pass to schedule." };
  }
  if (input.passes.length > 12) {
    return { ok: false, error: "Too many passes — limit 12 per weekend bulk-add." };
  }

  const passResults: Array<{
    passIndex: number;
    label: string;
    added: number;
    updated: number;
    total: number;
    error?: string;
  }> = [];

  for (let i = 0; i < input.passes.length; i++) {
    const p = input.passes[i];
    if (!p) continue;
    const label = buildPassLabel(p);
    const res = await addCrawlToAllCities({
      campaignId: input.campaignId,
      eventDate: p.eventDate,
      dayPart: p.dayPart,
      extendedMiddle: p.extendedMiddle,
      crawlNumbers: p.crawlNumbers,
      priorityMin: p.priorityMin,
      priorityMax: p.priorityMax,
      cityCampaignIds: p.cityCampaignIds,
    });
    if (res.ok) {
      passResults.push({
        passIndex: i,
        label,
        added: res.data.added,
        updated: res.data.updated,
        total: res.data.total,
      });
    } else {
      passResults.push({
        passIndex: i,
        label,
        added: 0,
        updated: 0,
        total: 0,
        error: res.error,
      });
    }
  }

  const totalAdded = passResults.reduce((s, r) => s + r.added, 0);
  const totalUpdated = passResults.reduce((s, r) => s + r.updated, 0);
  const totalRows = passResults.reduce((s, r) => s + r.total, 0);

  // If literally every pass failed, treat as error so the UI can
  // surface a banner. If even one succeeded the result is "ok"
  // with per-pass breakdown shown to the operator.
  const anyOk = passResults.some((r) => !r.error);
  if (!anyOk) {
    return {
      ok: false,
      error: passResults[0]?.error ?? "Every pass failed.",
    };
  }

  return {
    ok: true,
    data: { totalAdded, totalUpdated, totalRows, passResults },
  };
}

/** Human-readable summary of a single pass — used in the response
 *  so the UI can render a per-pass breakdown without recomputing. */
function buildPassLabel(p: {
  eventDate: string;
  dayPart?: string;
  crawlNumbers: number[];
  priorityMin?: number;
  priorityMax?: number;
  cityCampaignIds?: string[];
}): string {
  const dayLabel = p.dayPart
    ? p.dayPart
        .split("_")
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(" ")
    : "No day part";
  const slots =
    p.crawlNumbers.length === 1
      ? `slot ${p.crawlNumbers[0]}`
      : `slots ${Math.min(...p.crawlNumbers)}-${Math.max(...p.crawlNumbers)}`;
  let scope = "all cities";
  if (p.cityCampaignIds && p.cityCampaignIds.length > 0) {
    scope = `${p.cityCampaignIds.length} selected`;
  } else if (p.priorityMin !== undefined || p.priorityMax !== undefined) {
    const lo = p.priorityMin ?? 1;
    const hi = p.priorityMax ?? 99;
    scope = lo === hi ? `priority ${lo}` : `priority ${lo}-${hi}`;
  }
  return `${dayLabel} · ${p.eventDate} · ${slots} · ${scope}`;
}

// =========================================================================
// Bulk delete city_campaigns (admin only — hard delete)
// =========================================================================

/**
 * Permanently remove the given city_campaign rows from this campaign.
 * Admin-only. Cascades to events (events.cityCampaignId is FK with
 * onDelete: 'cascade'), so all crawls scheduled for those cities under
 * this campaign go away too. Cities themselves (db/schema/geography.ts)
 * are unaffected — only their per-campaign assignment is removed.
 *
 * Use the single-row removeCityCampaign for one row; this is the
 * "select N rows + delete" shape from the campaign detail page.
 */
export async function removeCityCampaignsBulk(input: {
  campaignId: string;
  cityCampaignIds: string[];
}): Promise<ActionResult<{ removed: number }>> {
  const { staff } = await requireAdmin();

  if (input.cityCampaignIds.length === 0) {
    return { ok: false, error: "Select at least one city to delete." };
  }
  if (input.cityCampaignIds.length > 500) {
    return { ok: false, error: "Too many selected — limit to 500 cities per delete." };
  }

  try {
    const deleted = await withAuditContext(staff.id, async (tx) =>
      tx
        .delete(cityCampaigns)
        .where(
          and(
            eq(cityCampaigns.campaignId, input.campaignId),
            inArray(cityCampaigns.id, input.cityCampaignIds),
          ),
        )
        .returning({ id: cityCampaigns.id }),
    );
    revalidatePath(`/campaigns/${input.campaignId}`);
    return { ok: true, data: { removed: deleted.length } };
  } catch (err) {
    return wrapDbError(err, "bulk delete cities");
  }
}

// =========================================================================
// Danger-zone bulk deletes — admin only, confirmation-gated
// =========================================================================

/**
 * Hard-delete EVERY city_campaign row in this campaign. Cascades to
 * events + cold_outreach_entries via FK ON DELETE CASCADE.
 *
 * Admin-only. The confirmText must match the campaign name exactly
 * (the same friction model as deleteCampaignWithConfirmation). The
 * campaign itself is preserved — only its city sheet roster + every
 * crawl is wiped. The campaign can then be re-populated from scratch
 * via bulk-add-cities, CSV import, or the cold-outreach worksheet.
 *
 * Use case: operator wants to reset a campaign's roster without
 * deleting the campaign itself (e.g. wrong cities imported, want to
 * start over with a different set).
 */
export async function deleteAllCitiesFromCampaign(input: {
  campaignId: string;
  confirmCampaignName: string;
}): Promise<ActionResult<{ cityCampaignsDeleted: number; eventsDeleted: number }>> {
  const { staff } = await requireAdmin();

  // Load the campaign to verify confirmation text against actual name.
  const campaign = await db
    .select({ id: campaigns.id, name: campaigns.name })
    .from(campaigns)
    .where(eq(campaigns.id, input.campaignId))
    .limit(1)
    .then((r) => r[0]);
  if (!campaign) return { ok: false, error: "Campaign not found." };

  if (input.confirmCampaignName.trim() !== campaign.name) {
    return {
      ok: false,
      error: `Confirmation didn't match. Type "${campaign.name}" exactly to wipe the city roster.`,
    };
  }

  try {
    const result = await withAuditContext(staff.id, async (tx) => {
      // Count events that will cascade-delete so we can report it
      // back to the operator (the cascade itself is implicit via FK).
      const evCount = await tx
        .select({ n: sql<number>`COUNT(*)::int` })
        .from(events)
        .innerJoin(cityCampaigns, eq(cityCampaigns.id, events.cityCampaignId))
        .where(eq(cityCampaigns.campaignId, input.campaignId));
      const eventsToDelete = evCount[0]?.n ?? 0;

      const deleted = await tx
        .delete(cityCampaigns)
        .where(eq(cityCampaigns.campaignId, input.campaignId))
        .returning({ id: cityCampaigns.id });

      return {
        cityCampaignsDeleted: deleted.length,
        eventsDeleted: eventsToDelete,
      };
    });

    revalidatePath(`/campaigns/${input.campaignId}`);
    revalidatePath("/campaigns");
    return { ok: true, data: result };
  } catch (err) {
    return wrapDbError(err, "delete all cities from campaign");
  }
}

/**
 * Hard-delete EVERY event (crawl) in this campaign on a specific
 * date. Use case: operator added wrong-day crawls (e.g. picked Oct
 * 31 thinking it was Saturday but it's actually Friday) and wants to
 * nuke the whole date without per-city click-through.
 *
 * Scope: events rows ONLY. The city_campaign rows themselves are
 * untouched — every city stays on the campaign, they just lose
 * their crawl(s) for that date. Wristband / cold-outreach rows hang
 * off events.id via FK ON DELETE CASCADE so they go away too.
 *
 * Admin-only. Date must be a valid YYYY-MM-DD and must already have
 * at least one event scheduled (the action surfaces an error
 * otherwise so the operator can't accidentally pick a date with
 * nothing to do).
 */
export async function deleteCrawlsOnDate(input: {
  campaignId: string;
  eventDate: string;
}): Promise<ActionResult<{ deleted: number }>> {
  const { staff } = await requireAdmin();

  // Cheap guard on the input shape — the action accepts what the
  // <input type="date"> emits.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.eventDate)) {
    return { ok: false, error: "eventDate must be YYYY-MM-DD." };
  }

  try {
    const deleted = await withAuditContext(staff.id, async (tx) => {
      // Find every event in this campaign on this date, scoped by
      // joining through city_campaigns. We don't have a campaign_id
      // on events directly (events live under city_campaigns), so
      // the IN-subquery is the cheapest filter.
      const eventIds = await tx
        .select({ id: events.id })
        .from(events)
        .innerJoin(cityCampaigns, eq(cityCampaigns.id, events.cityCampaignId))
        .where(
          and(
            eq(cityCampaigns.campaignId, input.campaignId),
            eq(events.eventDate, input.eventDate),
          ),
        );
      if (eventIds.length === 0) return [];

      return tx
        .delete(events)
        .where(
          inArray(
            events.id,
            eventIds.map((r) => r.id),
          ),
        )
        .returning({ id: events.id });
    });

    if (deleted.length === 0) {
      return { ok: false, error: `No crawls scheduled on ${input.eventDate} for this campaign.` };
    }

    revalidatePath(`/campaigns/${input.campaignId}`);
    return { ok: true, data: { deleted: deleted.length } };
  } catch (err) {
    return wrapDbError(err, "delete crawls on date");
  }
}

// =========================================================================
// Bulk add: all remaining unassigned cities at next priority
// =========================================================================

/**
 * Pull every city in the DB that's NOT already assigned to this
 * campaign and add them all at MAX(existing priority) + 1. Lets
 * operators clean-sweep the remainder after they've manually
 * prioritized the top tier.
 *
 * Example: campaign has P1-5 manually set. Calling this adds every
 * unassigned city at P6. A second call would add any newly-created
 * cities at P7, and so on.
 *
 * Returns the count of cities added + the priority bucket they
 * landed in.
 */
export async function addRemainingCitiesAtNextPriority(input: {
  campaignId: string;
}): Promise<ActionResult<{ added: number; priority: number; skipped: number }>> {
  const { staff } = await requireStaff();
  if (!hasMinimumRole(staff, "admin")) {
    return { ok: false, error: "Only admins can bulk-add the remaining cities." };
  }

  // Figure out the next priority bucket. MAX over existing rows in
  // this campaign + 1; falls back to 1 when the campaign has no
  // cities yet.
  const maxRow = await db
    .select({ maxP: sql<number | null>`MAX(${cityCampaigns.priority})` })
    .from(cityCampaigns)
    .where(eq(cityCampaigns.campaignId, input.campaignId));
  const nextPriority = (maxRow[0]?.maxP ?? 0) + 1;

  // All not-yet-archived cities that don't already have a row in
  // this campaign.
  const remaining = await db.execute<{ id: string }>(sql`
    SELECT c.id::text
    FROM cities c
    WHERE c.archived_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM city_campaigns cc
        WHERE cc.campaign_id = ${input.campaignId}
          AND cc.city_id = c.id
      )
  `);
  const rows = Array.isArray(remaining)
    ? (remaining as { id: string }[])
    : ((remaining as { rows: { id: string }[] }).rows ?? []);

  if (rows.length === 0) {
    return {
      ok: true,
      data: { added: 0, priority: nextPriority, skipped: 0 },
    };
  }

  try {
    const inserted = await withAuditContext(staff.id, async (tx) =>
      tx
        .insert(cityCampaigns)
        .values(
          rows.map((r) => ({
            cityId: r.id,
            campaignId: input.campaignId,
            priority: nextPriority,
            createdBy: staff.id,
            updatedBy: staff.id,
          })),
        )
        // Defensive: unique index on (campaign_id, city_id) handles any
        // race condition where a city gets added between the
        // NOT EXISTS check and the insert.
        .onConflictDoNothing()
        .returning({ id: cityCampaigns.id }),
    );
    revalidatePath(`/campaigns/${input.campaignId}`);
    return {
      ok: true,
      data: {
        added: inserted.length,
        priority: nextPriority,
        skipped: rows.length - inserted.length,
      },
    };
  } catch (err) {
    return wrapDbError(err, "add remaining cities at next priority");
  }
}
