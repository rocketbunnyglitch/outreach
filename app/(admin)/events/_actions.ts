"use server";

/**
 * Event actions — create and update events under a (campaign, city) pair.
 */

import { events } from "@/db/schema";
import { hasMinimumRole, requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import { type ActionResult, formToObject } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import {
  type EventCreateInput,
  type EventUpdateInput,
  eventCreateSchema,
  eventUpdateSchema,
} from "@/lib/validation/events";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { DatabaseError } from "pg";

function wrapDbError(err: unknown, action: string): ActionResult<never> {
  const dbErr = err as DatabaseError;
  logger.error({ err, action }, "event action failed");
  if (dbErr?.code === "23505") {
    return {
      ok: false,
      error: "An event already exists for that date + slot. Increment slot number.",
    };
  }
  if (dbErr?.code === "23503") {
    return { ok: false, error: "Referenced city-campaign not found." };
  }
  return { ok: false, error: "Unexpected database error. See server logs." };
}

export async function createEvent(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = eventCreateSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const input: EventCreateInput = parsed.data;

  try {
    const [row] = await withAuditContext(staff.id, async (tx) =>
      tx
        .insert(events)
        .values({
          cityCampaignId: input.cityCampaignId,
          eventDate: input.eventDate,
          slotNumber: input.slotNumber,
          eventbriteEventId: input.eventbriteEventId,
          eventbriteUrl: input.eventbriteUrl,
          dayPart: input.dayPart,
          crawlNumber: input.crawlNumber,
          ticketSalesCount: input.ticketSalesCount ?? 0,
          startsAt: input.startsAt ? new Date(input.startsAt) : null,
          endsAt: input.endsAt ? new Date(input.endsAt) : null,
          routeLabel: input.routeLabel,
          middleVenueGroupId: input.middleVenueGroupId ?? null,
          requiredVenueCountTotal: input.requiredVenueCountTotal,
          requiredWristbandCount: input.requiredWristbandCount,
          requiredMiddleCount: input.requiredMiddleCount,
          requiredFinalCount: input.requiredFinalCount,
          status: input.status ?? "planned",
          createdBy: staff.id,
          updatedBy: staff.id,
        })
        .returning({ id: events.id }),
    );
    if (!row) throw new Error("insert returned no row");
    revalidatePath(`/city-campaigns/${input.cityCampaignId}`);
    redirect(`/events/${row.id}`);
  } catch (err) {
    return wrapDbError(err, "create event");
  }
}

export async function updateEvent(
  id: string,
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = eventUpdateSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const input: EventUpdateInput = parsed.data;

  const patch: Partial<typeof events.$inferInsert> = { updatedBy: staff.id };
  if (input.eventbriteEventId !== undefined) patch.eventbriteEventId = input.eventbriteEventId;
  if (input.eventbriteUrl !== undefined) patch.eventbriteUrl = input.eventbriteUrl;
  if (input.dayPart !== undefined) patch.dayPart = input.dayPart;
  if (input.crawlNumber !== undefined) patch.crawlNumber = input.crawlNumber;
  if (input.ticketSalesCount !== undefined) patch.ticketSalesCount = input.ticketSalesCount;
  // The datetime-local input gives 'YYYY-MM-DDTHH:MM' (no tz). Treat as
  // server-local; the DB column is timestamptz so it'll be coerced.
  if (input.startsAt !== undefined)
    patch.startsAt = input.startsAt ? new Date(input.startsAt) : null;
  if (input.endsAt !== undefined) patch.endsAt = input.endsAt ? new Date(input.endsAt) : null;
  if (input.routeLabel !== undefined) patch.routeLabel = input.routeLabel;
  if (input.middleVenueGroupId !== undefined)
    patch.middleVenueGroupId = input.middleVenueGroupId ?? null;
  if (input.requiredVenueCountTotal !== undefined)
    patch.requiredVenueCountTotal = input.requiredVenueCountTotal;
  if (input.requiredWristbandCount !== undefined)
    patch.requiredWristbandCount = input.requiredWristbandCount;
  if (input.requiredMiddleCount !== undefined)
    patch.requiredMiddleCount = input.requiredMiddleCount;
  if (input.requiredFinalCount !== undefined) patch.requiredFinalCount = input.requiredFinalCount;
  if (input.status !== undefined) patch.status = input.status;

  try {
    await withAuditContext(staff.id, async (tx) =>
      tx.update(events).set(patch).where(eq(events.id, id)),
    );
    revalidatePath(`/events/${id}`);
    return { ok: true, data: { id } };
  } catch (err) {
    return wrapDbError(err, "update event");
  }
}

/**
 * Cancel a crawl (events.status -> 'cancelled'). This is a DANGEROUS override:
 * it pulls a live/planned crawl off the board, so it is gated two ways:
 *
 *   1. Role gate -- requires at least `lead` (admin OR lead). There is no
 *      "manager" tier in STAFF_ROLE_RANK (lib/auth.ts); `lead` is the
 *      manager-equivalent tier between admin and outreach.
 *   2. Required reason -- the caller MUST supply a non-empty justification.
 *      It is persisted to events.override_reason in the SAME update, so the
 *      audit trigger captures it in audit_log.new_values and the /audit
 *      viewer shows "override_reason" as a changed field with the text.
 *
 * `reason` is typed optional so existing zero-arg form bindings keep
 * compiling, but it is enforced at runtime: a missing/blank reason throws
 * before any mutation. UI surfaces that call this MUST collect a reason.
 */
export async function archiveEvent(id: string, reason?: string): Promise<void> {
  const { staff } = await requireStaff();
  if (!hasMinimumRole(staff, "lead")) {
    throw new Error("Cancelling a crawl requires lead or admin role.");
  }
  const trimmed = (reason ?? "").trim();
  if (trimmed.length < 3) {
    throw new Error("A reason (at least 3 characters) is required to cancel a crawl.");
  }
  const overrideReason = trimmed.slice(0, 500);

  const [row] = await db
    .select({ cityCampaignId: events.cityCampaignId })
    .from(events)
    .where(eq(events.id, id))
    .limit(1);
  await withAuditContext(staff.id, async (tx) =>
    // override_reason is written via raw SQL: the Drizzle model for `events`
    // (db/schema/events.ts) is owned by another surface and not part of this
    // change. The column exists (migration 0087) and the audit trigger reads
    // it off the row regardless of how it was written. NOW()/updated_by mirror
    // what the touch trigger + Drizzle path would set.
    tx.execute(sql`
      UPDATE events
      SET status = 'cancelled'::event_status,
          override_reason = ${overrideReason},
          updated_by = ${staff.id}::uuid,
          updated_at = NOW()
      WHERE id = ${id}
    `),
  );
  if (row?.cityCampaignId) revalidatePath(`/city-campaigns/${row.cityCampaignId}`);
  redirect(row?.cityCampaignId ? `/city-campaigns/${row.cityCampaignId}` : "/campaigns");
}

// =========================================================================
// Bulk operations across many events at once
// =========================================================================

/**
 * Bulk-rename: set crawl_name for every event matching the filter.
 * Used by the tracker tab so an operator can say "all Saturday crawl
 * 4's are Day Parties" in one shot.
 *
 * Filter shape:
 *   - campaignId required (scopes the bulk to one campaign)
 *   - crawlNumber required (which slot to rename)
 *   - dayPart optional (when omitted, applies across every day part)
 *
 * setFormat is parallel: same filter, sets crawl_format = 'day_party'
 * or 'standard'. Operators usually pair them: "name + format" for
 * day-party crawls.
 */
export async function bulkRenameCrawls(input: {
  campaignId: string;
  crawlNumber: number;
  dayPart?:
    | "thursday_night"
    | "friday_night"
    | "saturday_day"
    | "saturday_night"
    | "sunday_day"
    | "sunday_night"
    | "other";
  /** New name. Null/empty clears the override and reverts to the auto label. */
  crawlName?: string | null;
  /** Optional format change applied at the same time. */
  crawlFormat?: "standard" | "day_party";
}): Promise<ActionResult<{ updated: number }>> {
  const { staff } = await requireStaff();

  if (!Number.isInteger(input.crawlNumber) || input.crawlNumber < 1 || input.crawlNumber > 9) {
    return { ok: false, error: "Crawl number must be 1-9." };
  }
  if (input.crawlName !== undefined && input.crawlName !== null && input.crawlName.length > 60) {
    return { ok: false, error: "Crawl name must be 60 characters or fewer." };
  }

  // Validation only — the actual UPDATE is built as raw SQL further
  // down so it can carry a CITY_CAMPAIGN -> CAMPAIGN join in the
  // WHERE clause. Either crawlName or crawlFormat must be set.
  if (input.crawlName === undefined && input.crawlFormat === undefined) {
    return { ok: false, error: "Provide at least one of crawlName or crawlFormat." };
  }

  try {
    const result = await withAuditContext(staff.id, async (tx) => {
      // Build the SET clause as a list of SQL fragments. Only fields
      // explicitly provided get written — bulk-rename without format
      // change leaves format alone, and vice versa.
      const setParts: import("drizzle-orm").SQL[] = [
        sql`updated_at = NOW()`,
        sql`updated_by = ${staff.id}`,
      ];
      if (input.crawlName !== undefined) {
        const v = input.crawlName === "" ? null : input.crawlName;
        setParts.push(sql`crawl_name = ${v}`);
      }
      if (input.crawlFormat !== undefined) {
        setParts.push(sql`crawl_format = ${input.crawlFormat}::crawl_format`);
        // Day-party format also overrides venue mix: no final, still
        // 1 wristband + 2 middles. Standard restores defaults.
        if (input.crawlFormat === "day_party") {
          setParts.push(sql`required_final_count = 0`);
          setParts.push(sql`required_venue_count_total = 3`);
        } else {
          setParts.push(sql`required_final_count = 1`);
          setParts.push(sql`required_venue_count_total = 4`);
        }
      }
      const setClause = sql.join(setParts, sql`, `);
      const dpClause = input.dayPart ? sql`AND e.day_part = ${input.dayPart}` : sql``;
      const upd = await tx.execute(sql`
        UPDATE events e
        SET ${setClause}
        FROM city_campaigns cc
        WHERE cc.id = e.city_campaign_id
          AND cc.campaign_id = ${input.campaignId}
          AND e.crawl_number = ${input.crawlNumber}
          AND e.archived_at IS NULL
          ${dpClause}
        RETURNING e.id
      `);
      const rows = Array.isArray(upd) ? upd : ((upd as { rows?: unknown[] }).rows ?? []);
      return { updated: rows.length };
    });
    revalidatePath("/tracker");
    revalidatePath(`/campaigns/${input.campaignId}`);
    return { ok: true, data: result };
  } catch (err) {
    return wrapDbError(err, "bulk rename crawls");
  }
}
