"use server";

/**
 * CityCampaign actions — manage which cities participate in which campaigns,
 * with priority and per-city sales goals.
 */

import { cityCampaigns } from "@/db/schema";
import { hasMinimumRole, requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import { type ActionResult, formToObject } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import {
  type CityCampaignCreateInput,
  type CityCampaignUpdateInput,
  cityCampaignCreateSchema,
  cityCampaignUpdateSchema,
} from "@/lib/validation/city-campaigns";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { DatabaseError } from "pg";

function wrapDbError(err: unknown, action: string): ActionResult<never> {
  const dbErr = err as DatabaseError;
  logger.error({ err, action }, "city-campaign action failed");
  if (dbErr?.code === "23505") {
    return {
      ok: false,
      error: "That city is already in this campaign.",
    };
  }
  if (dbErr?.code === "23503") {
    return { ok: false, error: "Referenced city, campaign, or staff not found." };
  }
  return { ok: false, error: "Unexpected database error. See server logs." };
}

export async function addCityToCampaign(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = cityCampaignCreateSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const input: CityCampaignCreateInput = parsed.data;

  // Role gate (#025 server-side defense). The UI hides the dollar
  // field from non-admins, but a malicious or curious operator could
  // still POST the form with a salesGoalCents value. Silently drop it
  // here rather than 403 — preserves the rest of the payload (city,
  // priority, target counts) so the create still works as expected.
  const isAdmin = hasMinimumRole(staff, "admin");
  if (!isAdmin && input.salesGoalCents !== undefined) {
    logger.info(
      { staffId: staff.id, role: staff.role },
      "non-admin sent salesGoalCents on city-campaign create — dropping",
    );
    input.salesGoalCents = undefined;
  }

  try {
    const [row] = await withAuditContext(staff.id, async (tx) =>
      tx
        .insert(cityCampaigns)
        .values({
          cityId: input.cityId,
          campaignId: input.campaignId,
          priority: input.priority,
          targetVenueCount: input.targetVenueCount,
          targetWristbandCount: input.targetWristbandCount,
          targetFinalCount: input.targetFinalCount,
          targetMiddleCount: input.targetMiddleCount,
          salesGoalCents:
            input.salesGoalCents !== undefined ? BigInt(input.salesGoalCents) : undefined,
          leadStaffId: input.leadStaffId ?? null,
          status: input.status ?? "planning",
          createdBy: staff.id,
          updatedBy: staff.id,
        })
        .returning({ id: cityCampaigns.id }),
    );
    if (!row) throw new Error("insert returned no row");
    revalidatePath(`/campaigns/${input.campaignId}`);
    return { ok: true, data: { id: row.id } };
  } catch (err) {
    return wrapDbError(err, "add city to campaign");
  }
}

export async function updateCityCampaign(
  id: string,
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = cityCampaignUpdateSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const input: CityCampaignUpdateInput = parsed.data;

  // Role gate (#025 server-side defense). Mirror of the create gate
  // above — silently drop salesGoalCents writes from non-admins so
  // the rest of the patch still applies. Logged so engineers can
  // see if a non-admin form is somehow surfacing the field.
  const isAdmin = hasMinimumRole(staff, "admin");
  if (!isAdmin && input.salesGoalCents !== undefined) {
    logger.info(
      { staffId: staff.id, role: staff.role, cityCampaignId: id },
      "non-admin sent salesGoalCents on city-campaign update — dropping",
    );
    input.salesGoalCents = undefined;
  }

  const patch: Partial<typeof cityCampaigns.$inferInsert> = {
    updatedBy: staff.id,
  };
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.targetVenueCount !== undefined) patch.targetVenueCount = input.targetVenueCount;
  if (input.targetWristbandCount !== undefined)
    patch.targetWristbandCount = input.targetWristbandCount;
  if (input.targetFinalCount !== undefined) patch.targetFinalCount = input.targetFinalCount;
  if (input.targetMiddleCount !== undefined) patch.targetMiddleCount = input.targetMiddleCount;
  if (input.salesGoalCents !== undefined) patch.salesGoalCents = BigInt(input.salesGoalCents);
  if (input.leadStaffId !== undefined) patch.leadStaffId = input.leadStaffId;
  if (input.status !== undefined) patch.status = input.status;

  try {
    await withAuditContext(staff.id, async (tx) =>
      tx.update(cityCampaigns).set(patch).where(eq(cityCampaigns.id, id)),
    );
    revalidatePath(`/city-campaigns/${id}`);
    return { ok: true, data: { id } };
  } catch (err) {
    return wrapDbError(err, "update city campaign");
  }
}

export async function removeCityCampaign(id: string): Promise<void> {
  const { staff } = await requireStaff();
  const result = await db
    .select({ campaignId: cityCampaigns.campaignId })
    .from(cityCampaigns)
    .where(eq(cityCampaigns.id, id))
    .limit(1);
  const cc = result[0];

  await withAuditContext(staff.id, async (tx) =>
    tx.delete(cityCampaigns).where(eq(cityCampaigns.id, id)),
  );
  if (cc?.campaignId) revalidatePath(`/campaigns/${cc.campaignId}`);
  redirect(cc?.campaignId ? `/campaigns/${cc.campaignId}` : "/campaigns");
}

// =========================================================================
// Bulk-add cities (operator session 11 decision #026)
// =========================================================================

/**
 * Add EVERY non-archived city in the master list to this campaign,
 * skipping cities that are already in it. Per-row inserts run inside
 * one transaction so partial failures (e.g. a unique-index conflict
 * for a single city) don't leave the campaign half-imported.
 *
 * Operator quote (session 11):
 *   "I should also be able to mass add crawls for all cities for a
 *    campaign so i should be able to choose add crawls for all
 *    cities. Or for specific priority number cities."
 *
 * This action handles the "all cities" half. The priority-tier filter
 * isn't built yet — when it lands it'll be a thin variant of this
 * with a WHERE clause.
 */
export async function addAllCitiesToCampaign(
  campaignId: string,
): Promise<ActionResult<{ added: number; skipped: number }>> {
  const { staff } = await requireStaff();

  // Cities already in this campaign — we'll skip these. NOTE: cityCampaigns
  // has no archived_at column (CLAUDE.md §12.1); status enum + the unique
  // index on (city_id, campaign_id) are the source of truth. We filter by
  // campaignId alone and let ON CONFLICT DO NOTHING handle the dedup on
  // insert.
  const { cities } = await import("@/db/schema");
  const { isNull } = await import("drizzle-orm");

  try {
    const existing = await db
      .select({ cityId: cityCampaigns.cityId })
      .from(cityCampaigns)
      .where(eq(cityCampaigns.campaignId, campaignId));
    const existingSet = new Set(existing.map((r) => r.cityId));

    // Master city list — `cities.archivedAt` IS a real column, so this
    // filter stays.
    const allCities = await db
      .select({ id: cities.id })
      .from(cities)
      .where(isNull(cities.archivedAt));

    const toInsert = allCities.filter((c) => !existingSet.has(c.id));
    if (toInsert.length === 0) {
      return { ok: true, data: { added: 0, skipped: existing.length } };
    }

    await withAuditContext(staff.id, async (tx) => {
      await tx
        .insert(cityCampaigns)
        .values(
          toInsert.map((c) => ({
            cityId: c.id,
            campaignId,
            // Decision #026: when bulk-adding a city, no per-row inputs
            // required — operator picks the city, nothing else. Priority
            // defaults to 5 (mid-range; operator can adjust later).
            priority: 5,
            createdBy: staff.id,
            updatedBy: staff.id,
          })),
        )
        // ON CONFLICT DO NOTHING handles the race where two operators
        // bulk-add at once. The unique index on (city_id, campaign_id)
        // owns the dedupe.
        .onConflictDoNothing();
    });

    revalidatePath(`/campaigns/${campaignId}`);
    return { ok: true, data: { added: toInsert.length, skipped: existing.length } };
  } catch (err) {
    return wrapDbError(err, "add all cities to campaign");
  }
}

/**
 * Preview a CSV bulk-import. Does NOT commit — returns the match
 * classification per row so the UI can show:
 *   - the auto-acceptable matches (commit immediately on next call)
 *   - the ambiguous rows (operator picks per-row from candidates)
 *   - the not-found rows (skipped + reported)
 *
 * The operator then calls commitBulkCityImport with the resolved
 * picks. Two-call flow keeps the review interaction stateless on the
 * server side — no draft table, no expiring tokens.
 */
export async function previewCsvCityImport(
  campaignId: string,
  csvText: string,
): Promise<
  ActionResult<{
    rows: Array<{
      rawInput: string;
      confidence: "high" | "ambiguous" | "not_found";
      candidates: Array<{ id: string; name: string; region: string | null }>;
      priority: number | null;
      eventDate: string | null;
      crawlNumber: number | null;
      matchedOn?: string;
    }>;
    alreadyInCampaign: number;
    totalCities: number;
  }>
> {
  await requireStaff();
  if (!csvText.trim()) {
    return { ok: false, error: "Paste at least one city name to import." };
  }

  // Pull all non-archived cities plus the set already in this campaign
  // so we can flag them in the preview. Per CLAUDE.md §12.1, cityCampaigns
  // has no archivedAt — filter by campaignId alone.
  const { cities } = await import("@/db/schema");
  const { isNull } = await import("drizzle-orm");
  const { matchCity, parseBulkCityCsv } = await import("@/lib/city-name-match");

  const masterCities = await db
    .select({ id: cities.id, name: cities.name, region: cities.region })
    .from(cities)
    .where(isNull(cities.archivedAt));

  const existing = await db
    .select({ cityId: cityCampaigns.cityId })
    .from(cityCampaigns)
    .where(eq(cityCampaigns.campaignId, campaignId));
  // existing.length feeds the preview's "N already in campaign" hint
  // shown above the row list. The dedup itself happens at commit time
  // via the city_campaigns_city_campaign_unique index.

  const parsedRows = parseBulkCityCsv(csvText);
  const rows = parsedRows.map((row) => {
    const m = matchCity(row.line, masterCities);
    return {
      rawInput: m.rawInput,
      confidence: m.confidence,
      candidates: m.candidates.map((c) => ({ id: c.id, name: c.name, region: c.region })),
      priority: row.priority,
      eventDate: row.eventDate,
      crawlNumber: row.crawlNumber,
      matchedOn: m.matchedOn,
    };
  });

  return {
    ok: true,
    data: {
      rows,
      alreadyInCampaign: existing.length,
      totalCities: masterCities.length,
    },
  };
}

/**
 * Commit a resolved bulk import. The UI passes the operator-confirmed
 * city IDs (with optional per-row priority overrides). When a pick also
 * carries an event date + crawl number, we schedule a crawl on commit so
 * the operator doesn't have to bounce back to "Add a crawl to every city"
 * for the rows where they already specified a date in the CSV.
 *
 * - Skips any city already in this campaign (returned in `skipped`)
 * - All inserts run inside a single transaction with ON CONFLICT DO
 *   NOTHING for race-safety
 * - Events insert is best-effort; if it conflicts on the unique
 *   (cityCampaignId, eventDate, slotNumber) index the dup is silently
 *   skipped (same shape as bulk-add-crawls)
 */
export async function commitBulkCityImport(
  campaignId: string,
  picks: Array<{
    cityId: string;
    priority: number | null;
    eventDate?: string | null;
    crawlNumber?: number | null;
  }>,
): Promise<ActionResult<{ added: number; skipped: number; crawlsAdded: number }>> {
  const { staff } = await requireStaff();
  if (picks.length === 0) {
    return { ok: false, error: "No cities to import." };
  }

  // Dedupe within the request itself (an operator might have picked
  // the same city for two CSV rows). For dupes we keep the FIRST row's
  // priority + crawl-schedule info.
  const uniqueById = new Map<
    string,
    { priority: number | null; eventDate: string | null; crawlNumber: number | null }
  >();
  for (const p of picks) {
    if (!uniqueById.has(p.cityId)) {
      uniqueById.set(p.cityId, {
        priority: p.priority,
        eventDate: p.eventDate ?? null,
        crawlNumber: p.crawlNumber ?? null,
      });
    }
  }

  // Per CLAUDE.md §12.1, cityCampaigns has no archivedAt — the unique
  // index on (city_id, campaign_id) is the source of truth for dedup.
  const existing = await db
    .select({ id: cityCampaigns.id, cityId: cityCampaigns.cityId })
    .from(cityCampaigns)
    .where(eq(cityCampaigns.campaignId, campaignId));
  const existingByCityId = new Map(existing.map((r) => [r.cityId, r.id]));

  const toInsert = Array.from(uniqueById.entries())
    .filter(([cityId]) => !existingByCityId.has(cityId))
    .map(([cityId, info]) => ({
      cityId,
      campaignId,
      // Per #026: priority defaults to 5 when the CSV row didn't
      // specify one. Operator can edit later.
      priority: info.priority ?? 5,
      createdBy: staff.id,
      updatedBy: staff.id,
    }));

  // Pre-allocate a list of crawls we'll schedule after the city_campaigns
  // insert. We need the new city_campaign IDs back from the insert so we
  // can attach events to them; existing rows already have IDs in
  // existingByCityId so we can schedule for those too without re-inserting.
  const wantsCrawlByCityId = new Map<string, { eventDate: string; crawlNumber: number }>();
  for (const [cityId, info] of uniqueById.entries()) {
    if (info.eventDate && /^\d{4}-\d{2}-\d{2}$/.test(info.eventDate)) {
      const slot =
        info.crawlNumber && info.crawlNumber >= 1 && info.crawlNumber <= 9 ? info.crawlNumber : 1;
      wantsCrawlByCityId.set(cityId, { eventDate: info.eventDate, crawlNumber: slot });
    }
  }

  try {
    let crawlsAdded = 0;
    await withAuditContext(staff.id, async (tx) => {
      const newCcIdByCityId = new Map<string, string>();
      if (toInsert.length > 0) {
        const insertedRows = await tx
          .insert(cityCampaigns)
          .values(toInsert)
          .onConflictDoNothing()
          .returning({ id: cityCampaigns.id, cityId: cityCampaigns.cityId });
        for (const r of insertedRows) newCcIdByCityId.set(r.cityId, r.id);
      }

      // Schedule crawls for both pre-existing AND newly-inserted city
      // campaigns where the CSV row carried a date.
      if (wantsCrawlByCityId.size > 0) {
        const eventRows = Array.from(wantsCrawlByCityId.entries())
          .map(([cityId, sched]) => {
            const ccId = newCcIdByCityId.get(cityId) ?? existingByCityId.get(cityId);
            if (!ccId) return null;
            return {
              cityCampaignId: ccId,
              eventDate: sched.eventDate,
              slotNumber: sched.crawlNumber,
              crawlNumber: sched.crawlNumber,
              requiredVenueCountTotal: 4,
              requiredWristbandCount: 1,
              requiredFinalCount: 1,
              requiredMiddleCount: 2,
              createdBy: staff.id,
              updatedBy: staff.id,
            } as const;
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);
        if (eventRows.length > 0) {
          const { events } = await import("@/db/schema");
          const insertedEvents = await tx
            .insert(events)
            .values(eventRows)
            .onConflictDoNothing()
            .returning({ id: events.id });
          crawlsAdded = insertedEvents.length;
        }
      }
    });
    revalidatePath(`/campaigns/${campaignId}`);
    return {
      ok: true,
      data: {
        added: toInsert.length,
        skipped: picks.length - toInsert.length,
        crawlsAdded,
      },
    };
  } catch (err) {
    return wrapDbError(err, "commit bulk city import");
  }
}
