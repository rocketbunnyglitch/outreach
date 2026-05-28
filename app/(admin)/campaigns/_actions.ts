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
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  type CampaignCreateInput,
  type CampaignUpdateInput,
  campaignCreateSchema,
  campaignUpdateSchema,
} from "@/lib/validation/campaigns";
import { and, eq, sql } from "drizzle-orm";
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
  if (input.status !== undefined) patch.status = input.status;
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
    return { ok: true, data: { id } };
  } catch (err) {
    return wrapDbError(err, "update campaign");
  }
}

export async function archiveCampaign(id: string): Promise<void> {
  const { staff } = await requireStaff();
  await withAuditContext(staff.id, async (tx) =>
    tx
      .update(campaigns)
      .set({ status: "archived", archivedAt: new Date(), updatedBy: staff.id })
      .where(eq(campaigns.id, id)),
  );
  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${id}`);
  redirect("/campaigns");
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
  if (staff.role !== "admin") {
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
}): Promise<ActionResult<{ added: number; skipped: number; total: number }>> {
  const { staff } = await requireStaff();

  // Pull every cityCampaign in this campaign. We don't filter by status
  // here — even 'cancelled' cityCampaigns can receive a new crawl;
  // operator may be re-activating them. The cityCampaigns table has no
  // archived_at column (CLAUDE.md §12.1) so no archive filter applies.
  const ccRows = await db
    .select({ id: cityCampaigns.id })
    .from(cityCampaigns)
    .where(eq(cityCampaigns.campaignId, input.campaignId));

  if (ccRows.length === 0) {
    return {
      ok: false,
      error: "This campaign has no cities yet. Add cities first, then bulk-add crawls.",
    };
  }

  // Schema validation on date — same regex as addCrawlSchema. The action
  // accepts a plain string from the form rather than a parsed Date so
  // PG can do its own date coercion on the column.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.eventDate)) {
    return { ok: false, error: "Date must be in YYYY-MM-DD format." };
  }

  const isExtended = input.extendedMiddle === true;
  const totalRequired = isExtended ? 5 : 4;
  const middlesRequired = isExtended ? 3 : 2;

  // Build the values list. slotNumber=1 across the board — operators
  // wanting a 2nd same-day crawl in a specific city use the per-city
  // addCrawlToCityCampaign instead.
  const rows = ccRows.map((cc) => ({
    cityCampaignId: cc.id,
    eventDate: input.eventDate,
    slotNumber: 1,
    dayPart: input.dayPart ?? null,
    requiredVenueCountTotal: totalRequired,
    requiredWristbandCount: 1,
    requiredFinalCount: 1,
    requiredMiddleCount: middlesRequired,
    createdBy: staff.id,
    updatedBy: staff.id,
  }));

  try {
    const inserted = await withAuditContext(staff.id, async (tx) =>
      tx
        .insert(events)
        .values(rows)
        // The unique index on (city_campaign_id, event_date, slot_number)
        // does the dedup. Cities with an existing slot-1 crawl on this
        // date are silently skipped — they appear in `skipped`.
        .onConflictDoNothing()
        .returning({ id: events.id }),
    );

    revalidatePath(`/campaigns/${input.campaignId}`);
    return {
      ok: true,
      data: {
        added: inserted.length,
        skipped: rows.length - inserted.length,
        total: rows.length,
      },
    };
  } catch (err) {
    return wrapDbError(err, "bulk add crawls");
  }
}
