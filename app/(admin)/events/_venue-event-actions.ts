"use server";

/**
 * VenueEvent actions — assign and update which venues are participating in
 * each event, with role and status. Phase 4c keeps this minimal:
 *   - role (wristband / middle / final)
 *   - status (lead → contacted → confirmed → ...)
 *   - slot start/end times, agreed hours text, drink specials
 *   - night-of contact info
 *
 * Phase 7b adds the confirmation cascade: when status transitions to
 * `confirmed`, generateConfirmationCascade auto-creates the follow-up
 * tasks (deliver poster, 2-week confirm, 1-week confirm, floor staff
 * brief). Cascade is idempotent — re-firing replaces existing auto tasks
 * for the same venue_event.
 *
 * Phase 6 automation will populate the cadence timestamps
 * (two_week_email_sent_at, one_week_email_sent_at, etc.) — those stay
 * read-only in this form.
 */

import { venueEvents } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { generateConfirmationCascade, isConfirmationTransition } from "@/lib/confirmation-cascade";
import { db, withAuditContext } from "@/lib/db";
import { type ActionResult, formToObject } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import {
  type VenueEventCreateInput,
  type VenueEventUpdateInput,
  venueEventCreateSchema,
  venueEventUpdateSchema,
} from "@/lib/validation/venue-events";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { DatabaseError } from "pg";

function wrapDbError(err: unknown, action: string): ActionResult<never> {
  const dbErr = err as DatabaseError;
  logger.error({ err, action }, "venue-event action failed");
  if (dbErr?.code === "23505") {
    return {
      ok: false,
      error: "That venue is already linked to this event.",
    };
  }
  if (dbErr?.code === "23503") {
    return { ok: false, error: "Referenced venue, event, or staff not found." };
  }
  return { ok: false, error: "Unexpected database error. See server logs." };
}

export async function addVenueToEvent(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = venueEventCreateSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const input: VenueEventCreateInput = parsed.data;

  try {
    const [row] = await withAuditContext(staff.id, async (tx) =>
      tx
        .insert(venueEvents)
        .values({
          venueId: input.venueId,
          eventId: input.eventId,
          role: input.role,
          status: input.status,
          slotStartTime: input.slotStartTime,
          slotEndTime: input.slotEndTime,
          agreedHoursText: input.agreedHoursText,
          drinkSpecials: input.drinkSpecials,
          nightOfContactName: input.nightOfContactName,
          nightOfContactPhoneE164: input.nightOfContactPhoneE164,
          ourContactStaffId: input.ourContactStaffId ?? null,
          createdBy: staff.id,
          updatedBy: staff.id,
        })
        .returning({ id: venueEvents.id }),
    );
    if (!row) throw new Error("insert returned no row");
    revalidatePath(`/events/${input.eventId}`);
    return { ok: true, data: { id: row.id } };
  } catch (err) {
    return wrapDbError(err, "add venue to event");
  }
}

export async function updateVenueEvent(
  id: string,
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = venueEventUpdateSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const input: VenueEventUpdateInput = parsed.data;

  const patch: Partial<typeof venueEvents.$inferInsert> = {
    updatedBy: staff.id,
  };
  if (input.role !== undefined) patch.role = input.role;
  if (input.status !== undefined) {
    patch.status = input.status;
    // When status flips to "confirmed", stamp confirmed_at so downstream code
    // can show "confirmed N days ago" without scanning audit_log.
    if (input.status === "confirmed") patch.confirmedAt = new Date();
  }
  if (input.slotStartTime !== undefined) patch.slotStartTime = input.slotStartTime;
  if (input.slotEndTime !== undefined) patch.slotEndTime = input.slotEndTime;
  if (input.agreedHoursText !== undefined) patch.agreedHoursText = input.agreedHoursText;
  if (input.drinkSpecials !== undefined) patch.drinkSpecials = input.drinkSpecials;
  if (input.nightOfContactName !== undefined) patch.nightOfContactName = input.nightOfContactName;
  if (input.nightOfContactPhoneE164 !== undefined)
    patch.nightOfContactPhoneE164 = input.nightOfContactPhoneE164;
  if (input.ourContactStaffId !== undefined) patch.ourContactStaffId = input.ourContactStaffId;

  try {
    // Fetch previous status BEFORE update so we can detect a transition
    // to confirmed (vs. saving while already confirmed).
    const previousStatusRow = await db
      .select({ status: venueEvents.status })
      .from(venueEvents)
      .where(eq(venueEvents.id, id))
      .limit(1);
    const previousStatus = previousStatusRow[0]?.status ?? null;

    const txOutput = await withAuditContext(staff.id, async (tx) => {
      const result = await tx
        .update(venueEvents)
        .set(patch)
        .where(eq(venueEvents.id, id))
        .returning({ eventId: venueEvents.eventId });

      // Confirmation cascade — generate auto-tasks atomically with the
      // status flip. Only fires on transition (not on repeated saves
      // while already confirmed).
      let firePhase4 = false;
      if (input.status !== undefined && isConfirmationTransition(previousStatus, input.status)) {
        try {
          const cascade = await generateConfirmationCascade(tx, id);
          logger.info({ venueEventId: id, ...cascade }, "confirmation cascade fired");
          firePhase4 = !cascade.skipped;
        } catch (cascadeErr) {
          // Log but don't block the venue_event update. Operators can
          // manually create tasks if cascade fails.
          logger.error(
            { err: cascadeErr, venueEventId: id },
            "confirmation cascade failed (venue_event update committed anyway)",
          );
        }
      }

      return { result, firePhase4 };
    });

    // Phase 4 — if the brand is at Phase 4, queue the cascade emails as
    // transactional scheduled_sends. Runs OUTSIDE the venue_event tx so
    // a queue-insert failure doesn't roll back the status flip.
    if (txOutput?.firePhase4) {
      try {
        const { queueCascadeSendsForVenueEvent } = await import("@/lib/cascade-sends-trigger");
        await queueCascadeSendsForVenueEvent({
          venueEventId: id,
          staffMemberId: staff.id,
        });
      } catch (sendErr) {
        logger.error({ err: sendErr, venueEventId: id }, "phase 4 cascade-sends trigger failed");
      }
    }

    const finalRow = txOutput?.result?.[0];
    if (finalRow?.eventId) revalidatePath(`/events/${finalRow.eventId}`);
    revalidatePath("/tasks");
    revalidatePath("/");
    return { ok: true, data: { id } };
  } catch (err) {
    return wrapDbError(err, "update venue event");
  }
}

export async function removeVenueFromEvent(id: string): Promise<void> {
  const { staff } = await requireStaff();
  const [row] = await db
    .select({ eventId: venueEvents.eventId })
    .from(venueEvents)
    .where(eq(venueEvents.id, id))
    .limit(1);

  await withAuditContext(staff.id, async (tx) =>
    tx.delete(venueEvents).where(eq(venueEvents.id, id)),
  );
  if (row?.eventId) revalidatePath(`/events/${row.eventId}`);
}
