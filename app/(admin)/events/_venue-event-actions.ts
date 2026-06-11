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
import { resolveEngineRole } from "@/lib/engine-roles";
import { type ActionResult, formToObject } from "@/lib/form-utils";
import { scheduleLifecycle } from "@/lib/lifecycle-scheduler";
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
): Promise<ActionResult<{ id: string; lifecycleScheduled?: number }>> {
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
  if (input.ourContactOverridePhoneE164 !== undefined)
    patch.ourContactOverridePhoneE164 = input.ourContactOverridePhoneE164;

  try {
    // Fetch previous status BEFORE update so we can detect a transition
    // to confirmed (vs. saving while already confirmed).
    const previousStatusRow = await db
      .select({ status: venueEvents.status })
      .from(venueEvents)
      .where(eq(venueEvents.id, id))
      .limit(1);
    const previousStatus = previousStatusRow[0]?.status ?? null;

    // Confirmation transition -> resolve the graphics designer (engine role)
    // up front so the cascade can auto-assign the graphics task. Read happens
    // outside the tx; null when unassigned (cascade falls back to the lead).
    const isConfirming =
      input.status !== undefined && isConfirmationTransition(previousStatus, input.status);
    const graphicsDesignerId = isConfirming
      ? await resolveEngineRole(staff.teamId, "graphics_designer")
      : null;
    // Lifecycle owner sends the post-confirm emails (T13-T17). Falls back to the
    // confirming operator so the scheduled drafts always have a valid owner.
    const lifecycleOwnerId = isConfirming
      ? ((await resolveEngineRole(staff.teamId, "lifecycle_owner")) ?? staff.id)
      : null;
    let graphicsNotify: { assigneeId: string | null; venueName: string } | null = null;

    const txOutput = await withAuditContext(staff.id, async (tx) => {
      const result = await tx
        .update(venueEvents)
        .set(patch)
        .where(eq(venueEvents.id, id))
        .returning({ eventId: venueEvents.eventId });

      // Confirmation cascade - generate auto-tasks (+ the graphics task and
      // social_media_graphics deliverable) atomically with the status flip.
      // Only fires on transition (not on repeated saves while already
      // confirmed).
      if (isConfirming) {
        try {
          const cascade = await generateConfirmationCascade(tx, id, { graphicsDesignerId });
          graphicsNotify = cascade.graphics;
          logger.info({ venueEventId: id, ...cascade }, "confirmation cascade fired");
        } catch (cascadeErr) {
          // Log but don't block the venue_event update. Operators can
          // manually create tasks if cascade fails.
          logger.error(
            { err: cascadeErr, venueEventId: id },
            "confirmation cascade failed (venue_event update committed anyway)",
          );
        }
      }

      return { result };
    });

    // Notify the graphics designer after the tx commits (best-effort, deduped).
    const notify = graphicsNotify as { assigneeId: string | null; venueName: string } | null;
    if (notify?.assigneeId) {
      try {
        const { emitNotification } = await import("@/app/(admin)/_actions/notifications");
        await emitNotification({
          staffId: notify.assigneeId,
          kind: "admin_message",
          title: `Graphic needed: ${notify.venueName}`,
          body: `${notify.venueName} is confirmed. Create the social media graphic, then hand it to the lifecycle owner to send.`,
          linkPath: "/crawl-management?tab=graphics",
        });
      } catch (notifyErr) {
        logger.error({ err: notifyErr, venueEventId: id }, "graphics-designer notification failed");
      }
    }

    // Lifecycle scheduler (Phase 3.2): auto-create the post-confirm scheduled
    // emails (T13-T17). Best-effort + outside the tx so a scheduling hiccup
    // never blocks the confirm; idempotent on re-confirm.
    let lifecycleScheduled = 0;
    if (isConfirming && lifecycleOwnerId) {
      try {
        const result = await scheduleLifecycle({
          venueEventId: id,
          ownerStaffId: lifecycleOwnerId,
          teamId: staff.teamId,
        });
        lifecycleScheduled = result.scheduledDraftIds.length;
        logger.info({ venueEventId: id, ...result }, "lifecycle scheduled on confirm");
      } catch (lifecycleErr) {
        logger.error(
          { err: lifecycleErr, venueEventId: id },
          "lifecycle scheduling failed (confirm committed anyway)",
        );
      }
    }

    // Crawl finalization (migration 0133): if THIS confirm filled the crawl's
    // last required slot, record who finalized it and broadcast the big
    // "%name% finalized %city%!" quick win to every active staffer.
    // Best-effort post-commit; never blocks the confirm.
    if (isConfirming) {
      try {
        const { maybeRecordCrawlFinalization } = await import("@/lib/crawl-finalize");
        const finalized = await maybeRecordCrawlFinalization({
          venueEventId: id,
          staffId: staff.id,
        });
        if (finalized) {
          const { emitNotification } = await import("@/app/(admin)/_actions/notifications");
          const { staffMembers } = await import("@/db/schema");
          const { eq: eqOp } = await import("drizzle-orm");
          const everyone = await db
            .select({ id: staffMembers.id })
            .from(staffMembers)
            .where(eqOp(staffMembers.status, "active"));
          const name = staff.displayName ?? "Someone";
          for (const person of everyone) {
            await emitNotification({
              staffId: person.id,
              kind: "quick_win",
              title: `\u{1F389} ${name} finalized ${finalized.cityName}!`,
              body: `Every slot on the ${finalized.eventDate} crawl is confirmed. Crawl complete!`,
              linkPath: `/events/${finalized.eventId}`,
              metadata: { bigWin: true, eventId: finalized.eventId, finalizedBy: staff.id },
            });
          }
          logger.info(
            { venueEventId: id, eventId: finalized.eventId, by: staff.id },
            "crawl finalized -- big quick win broadcast",
          );
        }
      } catch (finalizeErr) {
        logger.error({ err: finalizeErr, venueEventId: id }, "crawl-finalize broadcast failed");
      }
    }

    const finalRow = txOutput?.result?.[0];
    if (finalRow?.eventId) revalidatePath(`/events/${finalRow.eventId}`);
    revalidatePath("/tasks");
    revalidatePath("/crawl-management");
    revalidatePath("/worklist");
    revalidatePath("/");
    return { ok: true, data: { id, lifecycleScheduled } };
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
