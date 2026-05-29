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

import { events, middleVenueGroupMembers, middleVenueGroups } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { and, asc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

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
  dayPart: z.enum(["thursday_night", "friday_night", "saturday_night"]).nullable(),
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
  dayPart?: "thursday_night" | "friday_night" | "saturday_night";
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
