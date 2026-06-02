"use server";

/**
 * Middle venue group actions for the city sheet.
 *
 * Two operator workflows:
 *
 *   A. Assign crawl → existing group
 *      Operator clicks "Use shared middle group" on a crawl, picks an
 *      existing group from the dropdown. We set events.middle_venue_
 *      group_id, the crawl's Middle 1/Middle 2 slots are replaced with
 *      a read-only view of the group's members.
 *
 *   B. Create new group
 *      Operator picks "Create new group". We create the row, attach
 *      this crawl to it. Other crawls can be attached to the same
 *      group from their own pickers.
 *
 * Unassigning a group reverts the crawl to the per-event slot model.
 * Group's members aren't touched (other crawls may still use them).
 *
 * Adding/removing members from a group used to live at
 * /middle-groups/[id]. That route was removed; member-management UI
 * is currently absent. The schema + ability to assign an existing
 * group to a crawl remain functional — what's gone is the
 * group-membership editor.
 */

import { events, middleVenueGroupMembers, middleVenueGroups, venueEvents } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { and, asc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

/**
 * Valid venue_event_status enum values. A middle_venue_group_member's
 * status is free text (db/schema: kept as text on purpose), so when we
 * seed it onto a venue_event we coerce anything unrecognized down to
 * 'lead' rather than letting Postgres reject the insert on the enum.
 */
const VENUE_EVENT_STATUSES = new Set([
  "lead",
  "contacted",
  "interested",
  "negotiating",
  "confirmed",
  "scheduled",
  "contract_signed",
  "declined",
  "cancelled",
]);
type VenueEventStatus =
  | "lead"
  | "contacted"
  | "interested"
  | "negotiating"
  | "confirmed"
  | "scheduled"
  | "contract_signed"
  | "declined"
  | "cancelled";
function coerceVenueEventStatus(s: string | null | undefined): VenueEventStatus {
  return s != null && VENUE_EVENT_STATUSES.has(s) ? (s as VenueEventStatus) : "lead";
}

/**
 * TEMPLATE COPY: seed a crawl's own role='middle' venue_events from a
 * middle group's members. Runs inside the caller's audit transaction.
 *
 * Why copy instead of project: a shared middle group is a TEMPLATE, not
 * authoritative truth. Each crawl must own editable middle rows so the
 * operator can tweak hours / status / swap a venue per crawl without
 * mutating every other crawl on the group. We additively INSERT one
 * venue_event per group member that the crawl doesn't already have (the
 * (venue_id, event_id) unique index guards against duplicates via
 * onConflictDoNothing), seeding status / hours / specials from the
 * member. Existing middle rows are left untouched -- this never deletes
 * or overwrites a crawl's own data.
 *
 * Returns the number of rows inserted (for logging / no-op detection).
 */
async function copyGroupMembersIntoCrawl(
  tx: Parameters<Parameters<typeof withAuditContext>[1]>[0],
  opts: { eventId: string; middleVenueGroupId: string; staffId: string },
): Promise<number> {
  const members = await tx
    .select({
      venueId: middleVenueGroupMembers.venueId,
      status: middleVenueGroupMembers.status,
      slotStartTime: middleVenueGroupMembers.slotStartTime,
      slotEndTime: middleVenueGroupMembers.slotEndTime,
      agreedHoursText: middleVenueGroupMembers.agreedHoursText,
      drinkSpecials: middleVenueGroupMembers.drinkSpecials,
    })
    .from(middleVenueGroupMembers)
    .where(eq(middleVenueGroupMembers.middleVenueGroupId, opts.middleVenueGroupId))
    .orderBy(asc(middleVenueGroupMembers.createdAt));

  if (members.length === 0) return 0;

  // Existing middle venue_events for this crawl: their venue ids (so we
  // never re-seed one the crawl already has) and the current max
  // slot_position (so new rows continue the numbering).
  const existingMiddles = await tx
    .select({
      venueId: venueEvents.venueId,
      slotPosition: venueEvents.slotPosition,
    })
    .from(venueEvents)
    .where(and(eq(venueEvents.eventId, opts.eventId), eq(venueEvents.role, "middle")));

  const existingVenueIds = new Set(existingMiddles.map((m) => m.venueId));
  let nextPosition = existingMiddles.reduce((max, m) => Math.max(max, m.slotPosition ?? 0), 0) + 1;

  let inserted = 0;
  for (const m of members) {
    if (existingVenueIds.has(m.venueId)) continue;
    const result = await tx
      .insert(venueEvents)
      .values({
        eventId: opts.eventId,
        venueId: m.venueId,
        role: "middle",
        slotPosition: nextPosition,
        status: coerceVenueEventStatus(m.status),
        slotStartTime: m.slotStartTime,
        slotEndTime: m.slotEndTime,
        agreedHoursText: m.agreedHoursText,
        drinkSpecials: m.drinkSpecials,
        ourContactStaffId: opts.staffId,
        createdBy: opts.staffId,
        updatedBy: opts.staffId,
      })
      // venue_events has TWO unique constraints: (venue_id, event_id)
      // and (event_id, role, slot_position). An untargeted
      // ON CONFLICT DO NOTHING covers BOTH -- so if the venue is already
      // on this crawl in any role, OR the computed slot_position somehow
      // collides, we skip rather than error. We only count rows that
      // actually inserted (returning is empty on a skipped conflict).
      .onConflictDoNothing()
      .returning({ id: venueEvents.id });
    if (result.length > 0) {
      inserted++;
      // Only advance the position when a row actually landed, so a
      // skipped (conflicting) member doesn't leave a gap.
      nextPosition++;
      existingVenueIds.add(m.venueId);
    }
  }
  return inserted;
}

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

const assignSchema = z.object({
  eventId: uuid,
  middleVenueGroupId: uuid.nullable(),
  cityCampaignId: uuid.optional(),
});

/**
 * Set or clear events.middle_venue_group_id. Null clears.
 */
export async function assignMiddleGroup(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ eventId: string }>> {
  const { staff } = await requireStaff();
  const raw = String(formData.get("middleVenueGroupId") ?? "");
  const parsed = assignSchema.safeParse({
    eventId: formData.get("eventId"),
    middleVenueGroupId: raw && raw !== "_clear" ? raw : null,
    cityCampaignId: formData.get("cityCampaignId") ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: "Invalid group assignment." };

  try {
    await withAuditContext(staff.id, async (tx) => {
      await tx
        .update(events)
        .set({
          middleVenueGroupId: parsed.data.middleVenueGroupId,
          updatedBy: staff.id,
        })
        .where(eq(events.id, parsed.data.eventId));

      // TEMPLATE MODEL: attaching a group SEEDS the crawl's own editable
      // role='middle' venue_events from the group's members (additive,
      // conflict-safe). Clearing a group (null) leaves the already-copied
      // middle rows in place -- they're the crawl's own data now, not a
      // projection that should vanish when the template is detached.
      if (parsed.data.middleVenueGroupId) {
        await copyGroupMembersIntoCrawl(tx, {
          eventId: parsed.data.eventId,
          middleVenueGroupId: parsed.data.middleVenueGroupId,
          staffId: staff.id,
        });
      }
    });
    if (parsed.data.cityCampaignId) {
      revalidatePath(`/city-campaigns/${parsed.data.cityCampaignId}`);
    }
    return { ok: true, data: { eventId: parsed.data.eventId } };
  } catch (err) {
    logger.error({ err }, "assignMiddleGroup failed");
    return { ok: false, error: "Group assignment failed." };
  }
}

const createSchema = z.object({
  cityCampaignId: uuid,
  name: z.string().min(1).max(80),
  // Matches the day_part DB enum (all 7 values, nullable for groups
  // that span multiple day-parts). Widened from the old 3-value
  // restriction so saturday_day / sunday_day / sunday_night / other
  // crawls can attach to a group.
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
    .nullable(),
  /** Optional: immediately attach this event to the new group. */
  attachEventId: uuid.optional(),
});

/**
 * Create a new middle venue group within a city_campaign. Optional
 * attach: if attachEventId is set, sets events.middle_venue_group_id
 * on that event in the same transaction so the operator gets a one-
 * click create-and-attach flow.
 */
export async function createMiddleGroup(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ groupId: string }>> {
  const { staff } = await requireStaff();
  const parsed = createSchema.safeParse({
    cityCampaignId: formData.get("cityCampaignId"),
    name: formData.get("name"),
    dayPart: formData.get("dayPart") || null,
    attachEventId: formData.get("attachEventId") ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: "Invalid group create payload." };

  try {
    const groupId = await withAuditContext(staff.id, async (tx) => {
      const [row] = await tx
        .insert(middleVenueGroups)
        .values({
          cityCampaignId: parsed.data.cityCampaignId,
          name: parsed.data.name,
          dayPart: parsed.data.dayPart,
          status: "planning",
          createdBy: staff.id,
          updatedBy: staff.id,
        })
        .returning({ id: middleVenueGroups.id });

      if (row && parsed.data.attachEventId) {
        await tx
          .update(events)
          .set({ middleVenueGroupId: row.id, updatedBy: staff.id })
          .where(eq(events.id, parsed.data.attachEventId));
      }
      return row?.id ?? "";
    });

    revalidatePath(`/city-campaigns/${parsed.data.cityCampaignId}`);
    return { ok: true, data: { groupId } };
  } catch (err) {
    logger.error({ err }, "createMiddleGroup failed");
    return { ok: false, error: "Couldn't create group." };
  }
}

/**
 * Read helper: list groups available for a city_campaign, optionally
 * filtered by day_part so the picker shows only relevant options.
 *
 * Used by the picker component to populate its dropdown.
 */
export async function listMiddleGroupsForCityCampaign(opts: {
  cityCampaignId: string;
  /** Filter by day_part. Pass null for "no filter" (returns all
   *  groups regardless of their day_part, useful when the calling
   *  crawl itself has no day_part set). */
  dayPart?:
    | "thursday_night"
    | "friday_night"
    | "saturday_day"
    | "saturday_night"
    | "sunday_day"
    | "sunday_night"
    | "other"
    | null;
}): Promise<Array<{ id: string; name: string; dayPart: string | null; memberCount: number }>> {
  await requireStaff();
  const rows = await db
    .select({
      id: middleVenueGroups.id,
      name: middleVenueGroups.name,
      dayPart: middleVenueGroups.dayPart,
    })
    .from(middleVenueGroups)
    .where(
      and(
        eq(middleVenueGroups.cityCampaignId, opts.cityCampaignId),
        isNull(middleVenueGroups.archivedAt),
      ),
    )
    .orderBy(asc(middleVenueGroups.name));

  // Member counts
  const counts = await db
    .select({
      groupId: middleVenueGroupMembers.middleVenueGroupId,
    })
    .from(middleVenueGroupMembers);
  const countByGroup = new Map<string, number>();
  for (const c of counts) {
    countByGroup.set(c.groupId, (countByGroup.get(c.groupId) ?? 0) + 1);
  }

  return rows
    .filter((r) => !opts.dayPart || !r.dayPart || r.dayPart === opts.dayPart)
    .map((r) => ({
      id: r.id,
      name: r.name,
      dayPart: r.dayPart,
      memberCount: countByGroup.get(r.id) ?? 0,
    }));
}
