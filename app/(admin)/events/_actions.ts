"use server";

/**
 * Event actions — create and update events under a (campaign, city) pair.
 */

import { events } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import { type ActionResult, formToObject } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import {
  type EventCreateInput,
  type EventUpdateInput,
  eventCreateSchema,
  eventUpdateSchema,
} from "@/lib/validation/events";
import { eq } from "drizzle-orm";
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

export async function archiveEvent(id: string): Promise<void> {
  const { staff } = await requireStaff();
  const [row] = await db
    .select({ cityCampaignId: events.cityCampaignId })
    .from(events)
    .where(eq(events.id, id))
    .limit(1);
  await withAuditContext(staff.id, async (tx) =>
    tx.update(events).set({ status: "cancelled", updatedBy: staff.id }).where(eq(events.id, id)),
  );
  if (row?.cityCampaignId) revalidatePath(`/city-campaigns/${row.cityCampaignId}`);
  redirect(row?.cityCampaignId ? `/city-campaigns/${row.cityCampaignId}` : "/campaigns");
}
