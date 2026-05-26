"use server";

/**
 * Slot actions for the city sheet.
 *
 * Spreadsheet-fast inline edits map to these actions. Each handles ONE
 * field for ONE slot; the UI fires them on blur or change. All writes
 * go through withAuditContext for attribution.
 *
 * Slot lifecycle:
 *   1. Empty slot (no venue_event row exists) — placeholder rendered
 *   2. Operator picks a venue from the autocomplete → assignSlotVenue
 *      creates the venue_event row with role + slot_position
 *   3. Operator edits inline fields → updateSlotField patches the row
 *   4. Operator clears the venue → clearSlot deletes the venue_event
 */

import { venueEvents, venues } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { and, asc, eq, ilike, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

const roleEnum = z.enum(["wristband", "middle", "final", "alt_final"]);

const assignSchema = z.object({
  eventId: uuid,
  role: roleEnum,
  slotPosition: z.coerce.number().int().min(1).max(20),
  venueId: uuid,
  cityCampaignId: uuid.optional(),
});

/**
 * Create or replace the venue_event for a slot. If a row already exists
 * at (event, role, slot_position), it's updated to point at the new
 * venue. Otherwise a new row is inserted.
 */
export async function assignSlotVenue(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ venueEventId: string }>> {
  const { staff } = await requireStaff();
  const parsed = assignSchema.safeParse({
    eventId: formData.get("eventId"),
    role: formData.get("role"),
    slotPosition: formData.get("slotPosition"),
    venueId: formData.get("venueId"),
    cityCampaignId: formData.get("cityCampaignId") ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: "Invalid slot assignment payload." };
  const input = parsed.data;

  // ----- Conflict detection -----
  // A venue can't be used in CONFLICTING roles on the same day across
  // crawls within the same city_campaign. Conflict matrix:
  //   - If assigning as wristband/final/alt_final: venue must not be a
  //     middle (in either a venue_event OR a middle_venue_group used by
  //     any same-day event) for ANY other event on that date.
  //   - If assigning as middle: venue must not be wristband/final/
  //     alt_final on any other same-day event in this city_campaign.
  // Within the SAME event the unique index already blocks duplicate
  // (event, role, slot_position).
  const conflict = await db.execute<{
    other_event_id: string;
    other_role: string;
    other_day_part: string | null;
    other_crawl_number: number | null;
    same_date: boolean;
  }>(sql`
    WITH this_event AS (
      SELECT id, event_date, city_campaign_id FROM events WHERE id = ${input.eventId}
    ),
    direct_conflicts AS (
      -- venue_events on a different event in the same city_campaign, same date
      SELECT
        ve.event_id AS other_event_id,
        ve.role::text AS other_role,
        e.day_part::text AS other_day_part,
        e.crawl_number AS other_crawl_number,
        (e.event_date = (SELECT event_date FROM this_event)) AS same_date
      FROM venue_events ve
      JOIN events e ON e.id = ve.event_id
      WHERE ve.venue_id = ${input.venueId}
        AND e.city_campaign_id = (SELECT city_campaign_id FROM this_event)
        AND ve.event_id <> ${input.eventId}
        AND e.event_date = (SELECT event_date FROM this_event)
        AND (
          -- Cross-role conflict matrix
          (${input.role}::text IN ('wristband','final','alt_final')
             AND ve.role::text = 'middle')
          OR
          (${input.role}::text = 'middle'
             AND ve.role::text IN ('wristband','final','alt_final'))
        )
    ),
    group_conflicts AS (
      -- venue is a member of a middle group used by another same-day
      -- event, and we're assigning as wristband/final/alt_final
      SELECT
        e.id AS other_event_id,
        'middle (shared group)' AS other_role,
        e.day_part::text AS other_day_part,
        e.crawl_number AS other_crawl_number,
        TRUE AS same_date
      FROM middle_venue_group_members mvgm
      JOIN events e ON e.middle_venue_group_id = mvgm.middle_venue_group_id
      WHERE mvgm.venue_id = ${input.venueId}
        AND e.city_campaign_id = (SELECT city_campaign_id FROM this_event)
        AND e.event_id <> ${input.eventId}
        AND e.event_date = (SELECT event_date FROM this_event)
        AND ${input.role}::text IN ('wristband','final','alt_final')
    )
    SELECT * FROM direct_conflicts
    UNION ALL
    SELECT * FROM group_conflicts
    LIMIT 5
  `);

  const conflictRows: Array<{
    other_event_id: string;
    other_role: string;
    other_day_part: string | null;
    other_crawl_number: number | null;
    same_date: boolean;
  }> = Array.isArray(conflict)
    ? (conflict as unknown as Array<{
        other_event_id: string;
        other_role: string;
        other_day_part: string | null;
        other_crawl_number: number | null;
        same_date: boolean;
      }>)
    : ((
        conflict as unknown as {
          rows: Array<{
            other_event_id: string;
            other_role: string;
            other_day_part: string | null;
            other_crawl_number: number | null;
            same_date: boolean;
          }>;
        }
      ).rows ?? []);

  if (conflictRows.length > 0) {
    const c = conflictRows[0]!;
    const label = `${capitalize(c.other_day_part ?? "")} crawl ${c.other_crawl_number ?? "?"} (${c.other_role})`;
    return {
      ok: false,
      error: `Venue conflict: this venue is already used as ${c.other_role} on the same day in ${label}. Pick a different venue or change the other assignment first.`,
    };
  }

  try {
    const id = await withAuditContext(staff.id, async (tx) => {
      const existing = await tx
        .select({ id: venueEvents.id })
        .from(venueEvents)
        .where(
          and(
            eq(venueEvents.eventId, input.eventId),
            eq(venueEvents.role, input.role),
            eq(venueEvents.slotPosition, input.slotPosition),
          ),
        )
        .limit(1)
        .then((r) => r[0]);

      if (existing) {
        await tx
          .update(venueEvents)
          .set({ venueId: input.venueId, updatedBy: staff.id })
          .where(eq(venueEvents.id, existing.id));
        return existing.id;
      }
      const [row] = await tx
        .insert(venueEvents)
        .values({
          eventId: input.eventId,
          venueId: input.venueId,
          role: input.role,
          slotPosition: input.slotPosition,
          status: "lead",
          ourContactStaffId: staff.id,
          createdBy: staff.id,
          updatedBy: staff.id,
        })
        .returning({ id: venueEvents.id });
      return row?.id ?? "";
    });

    if (input.cityCampaignId) {
      revalidatePath(`/city-campaigns/${input.cityCampaignId}`);
    }
    return { ok: true, data: { venueEventId: id } };
  } catch (err) {
    logger.error({ err }, "assignSlotVenue failed");
    return { ok: false, error: "Couldn't assign venue. Check for role conflicts." };
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const updateFieldSchema = z.object({
  venueEventId: uuid,
  field: z.enum([
    "agreedHoursText",
    "drinkSpecials",
    "nightOfContactName",
    "ourContactStaffId",
    "status",
  ]),
  value: z.string().max(500),
  cityCampaignId: uuid.optional(),
});

/**
 * Patch a single field on an existing venue_event row. Used by every
 * inline-edit cell in the slot table.
 */
export async function updateSlotField(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = updateFieldSchema.safeParse({
    venueEventId: formData.get("venueEventId"),
    field: formData.get("field"),
    value: formData.get("value") ?? "",
    cityCampaignId: formData.get("cityCampaignId") ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: "Invalid update." };
  const { venueEventId, field, value, cityCampaignId } = parsed.data;

  try {
    await withAuditContext(staff.id, async (tx) => {
      const patch: Record<string, unknown> = { updatedBy: staff.id };
      if (field === "ourContactStaffId") {
        patch[field] = value || null;
      } else if (field === "status") {
        patch[field] = value;
      } else {
        patch[field] = value || null;
      }
      await tx.update(venueEvents).set(patch).where(eq(venueEvents.id, venueEventId));
    });

    if (cityCampaignId) revalidatePath(`/city-campaigns/${cityCampaignId}`);
    return { ok: true, data: { id: venueEventId } };
  } catch (err) {
    logger.error({ err }, "updateSlotField failed");
    return { ok: false, error: "Save failed." };
  }
}

const clearSchema = z.object({
  venueEventId: uuid,
  cityCampaignId: uuid.optional(),
});

export async function clearSlot(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = clearSchema.safeParse({
    venueEventId: formData.get("venueEventId"),
    cityCampaignId: formData.get("cityCampaignId") ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: "Invalid clear." };

  try {
    await withAuditContext(staff.id, async (tx) => {
      await tx.delete(venueEvents).where(eq(venueEvents.id, parsed.data.venueEventId));
    });
    if (parsed.data.cityCampaignId) {
      revalidatePath(`/city-campaigns/${parsed.data.cityCampaignId}`);
    }
    return { ok: true, data: { id: parsed.data.venueEventId } };
  } catch (err) {
    logger.error({ err }, "clearSlot failed");
    return { ok: false, error: "Clear failed." };
  }
}

const extraSlotSchema = z.object({
  eventId: uuid,
  role: z.enum(["middle", "alt_final"]),
  cityCampaignId: uuid.optional(),
});

/**
 * Add an extra slot row (Middle 3+ or Alt Final 1+). Returns the next
 * slot_position the UI should render.
 *
 * No venue_event is created — the slot is a UI placeholder until a
 * venue is assigned. The position is computed from existing rows
 * (max slot_position + 1).
 */
export async function addExtraSlot(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ slotPosition: number }>> {
  const { staff: _staff } = await requireStaff();
  const parsed = extraSlotSchema.safeParse({
    eventId: formData.get("eventId"),
    role: formData.get("role"),
    cityCampaignId: formData.get("cityCampaignId") ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: "Invalid extra slot." };

  // Find max existing slot_position for this (event, role)
  const max = await db.execute<{ maxpos: number | null }>(sql`
    SELECT max(slot_position) AS maxpos FROM venue_events
    WHERE event_id = ${parsed.data.eventId} AND role = ${parsed.data.role}
  `);
  const rows: Array<{ maxpos: number | null }> = Array.isArray(max)
    ? (max as unknown as Array<{ maxpos: number | null }>)
    : ((max as unknown as { rows: Array<{ maxpos: number | null }> }).rows ?? []);
  const current = rows[0]?.maxpos ?? 0;

  // For middles: default 2 (M1+M2), so the next "extra" is position 3+.
  // For alt_finals: no defaults — start at 1.
  const baseMin = parsed.data.role === "middle" ? 3 : 1;
  const nextPosition = Math.max(current + 1, baseMin);

  if (parsed.data.cityCampaignId) {
    revalidatePath(`/city-campaigns/${parsed.data.cityCampaignId}`);
  }
  return { ok: true, data: { slotPosition: nextPosition } };
}

/**
 * Venue autocomplete for the slot picker. City-scoped — only venues in
 * the same city as the city_campaign show up, so operator doesn't
 * accidentally pick a Toronto venue for a Buffalo crawl.
 */
export async function searchVenues(opts: {
  cityId: string;
  query: string;
  limit?: number;
}): Promise<
  Array<{
    id: string;
    name: string;
    email: string | null;
    capacity: number | null;
    address: string | null;
  }>
> {
  await requireStaff();
  const q = opts.query.trim();
  if (q.length < 1) return [];
  const rows = await db
    .select({
      id: venues.id,
      name: venues.name,
      email: venues.email,
      capacity: venues.capacity,
      address: venues.address,
    })
    .from(venues)
    .where(
      and(eq(venues.cityId, opts.cityId), isNull(venues.archivedAt), ilike(venues.name, `%${q}%`)),
    )
    .orderBy(asc(venues.name))
    .limit(opts.limit ?? 8);
  return rows;
}

/**
 * Quick-create a venue when none matches. Used by the slot autocomplete
 * "Create '{name}' as new venue" affordance. Returns the new id so the
 * caller can immediately assign it to the slot.
 */
const createVenueSchema = z.object({
  name: z.string().min(1).max(200),
  cityId: uuid,
});

export async function quickCreateVenue(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ venueId: string }>> {
  const { staff } = await requireStaff();
  const parsed = createVenueSchema.safeParse({
    name: formData.get("name"),
    cityId: formData.get("cityId"),
  });
  if (!parsed.success) return { ok: false, error: "Invalid venue input." };

  try {
    const id = await withAuditContext(staff.id, async (tx) => {
      const [row] = await tx
        .insert(venues)
        .values({
          name: parsed.data.name,
          cityId: parsed.data.cityId,
          createdBy: staff.id,
          updatedBy: staff.id,
        })
        .returning({ id: venues.id });
      return row?.id ?? "";
    });
    return { ok: true, data: { venueId: id } };
  } catch (err) {
    logger.error({ err }, "quickCreateVenue failed");
    return { ok: false, error: "Couldn't create venue." };
  }
}
