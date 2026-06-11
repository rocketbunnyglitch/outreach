"use server";

/**
 * Guided cancellation playbook — server actions (CRM plan B3).
 *
 * lib/cancellation-flow.ts already does the engine side (stop this
 * night's lifecycle emails + auto tasks, draft the T16, fan out
 * notifications). These wrappers add the GUIDED part:
 *
 *   - previewVenueCancellation: read-only "what will stop" — exact
 *     venue + night + role, how many unsent drafts get deleted (and
 *     how many of those were scheduled), how many pending auto tasks
 *     get cancelled. Shown before the operator confirms, so a
 *     cancellation can never target the wrong night silently.
 *   - runGuidedCancellation: records WHO cancelled (venue vs us) in
 *     the reason, runs the flow, and tells the UI whether to offer
 *     the emergency replacement playbook (the slot still needs a
 *     venue).
 */

import { events, emailDrafts, tasks, venueEvents, venues } from "@/db/schema";
import { hasMinimumRole, requireStaff } from "@/lib/auth";
import { triggerVenueCancellation } from "@/lib/cancellation-flow";
import { db } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { and, count, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CancellationPreview {
  venueName: string;
  /** YYYY-MM-DD of the night being cancelled — displayed verbatim so the
   *  operator confirms the EXACT night, not "the venue". */
  eventDate: string;
  role: string;
  status: string;
  /** Unsent drafts for THIS night that will be deleted. */
  unsentDrafts: number;
  /** Of those, how many were scheduled sends (lifecycle T13-T17 etc). */
  scheduledDrafts: number;
  /** Pending/in-progress auto tasks for this night that will be cancelled. */
  pendingAutoTasks: number;
}

export async function previewVenueCancellation(
  venueEventId: string,
): Promise<ActionResult<CancellationPreview>> {
  await requireStaff();
  if (!UUID_RE.test(venueEventId)) return { ok: false, error: "Invalid venue event id." };
  try {
    const [ve] = await db
      .select({
        venueName: venues.name,
        eventDate: events.eventDate,
        role: venueEvents.role,
        status: venueEvents.status,
      })
      .from(venueEvents)
      .innerJoin(venues, eq(venues.id, venueEvents.venueId))
      .innerJoin(events, eq(events.id, venueEvents.eventId))
      .where(eq(venueEvents.id, venueEventId))
      .limit(1);
    if (!ve) return { ok: false, error: "Venue event not found." };

    const [draftCounts] = await db
      .select({ total: count() })
      .from(emailDrafts)
      .where(and(eq(emailDrafts.venueEventId, venueEventId), isNull(emailDrafts.sentAt)));
    const [scheduledCounts] = await db
      .select({ total: count() })
      .from(emailDrafts)
      .where(
        and(
          eq(emailDrafts.venueEventId, venueEventId),
          isNull(emailDrafts.sentAt),
          isNotNull(emailDrafts.scheduledFor),
        ),
      );
    const [taskCounts] = await db
      .select({ total: count() })
      .from(tasks)
      .where(
        and(
          eq(tasks.targetType, "venue_event"),
          eq(tasks.targetId, venueEventId),
          eq(tasks.source, "auto"),
          inArray(tasks.status, ["pending", "in_progress"]),
        ),
      );

    return {
      ok: true,
      data: {
        venueName: ve.venueName,
        eventDate: String(ve.eventDate),
        role: ve.role,
        status: ve.status,
        unsentDrafts: draftCounts?.total ?? 0,
        scheduledDrafts: scheduledCounts?.total ?? 0,
        pendingAutoTasks: taskCounts?.total ?? 0,
      },
    };
  } catch (err) {
    logger.error({ err, venueEventId }, "previewVenueCancellation failed");
    return { ok: false, error: "Couldn't load the cancellation preview." };
  }
}

export interface GuidedCancellationResult {
  draftsCancelled: number;
  tasksCancelled: number;
  t16Drafted: boolean;
  /** The cancelled slot's role — every crawl role needs a venue, so the UI
   *  offers the emergency replacement playbook when the night was confirmed. */
  offerReplacement: boolean;
  role: string;
  eventId: string;
}

export async function runGuidedCancellation(input: {
  venueEventId: string;
  /** true = the venue pulled out; false = we cancelled on them. */
  cancelledByVenue: boolean;
  reason: string;
}): Promise<ActionResult<GuidedCancellationResult>> {
  const { staff } = await requireStaff();
  if (!hasMinimumRole(staff, "outreach")) {
    return { ok: false, error: "Read-only access cannot cancel a venue." };
  }
  if (!UUID_RE.test(input.venueEventId)) return { ok: false, error: "Invalid venue event id." };
  const trimmed = (input.reason ?? "").trim();
  if (trimmed.length < 3) {
    return { ok: false, error: "Add a short reason (at least 3 characters)." };
  }

  try {
    const [ve] = await db
      .select({
        role: venueEvents.role,
        status: venueEvents.status,
        eventId: venueEvents.eventId,
      })
      .from(venueEvents)
      .where(eq(venueEvents.id, input.venueEventId))
      .limit(1);
    if (!ve) return { ok: false, error: "Venue event not found." };
    if (ve.status === "cancelled") return { ok: false, error: "Already cancelled." };

    const wasConfirmed = ve.status === "confirmed";
    const reason = `${input.cancelledByVenue ? "Cancelled by venue" : "Cancelled by us"}: ${trimmed}`;

    const result = await triggerVenueCancellation({
      venueEventId: input.venueEventId,
      reason,
      byStaffId: staff.id,
      teamId: staff.teamId,
    });
    if (!result.ok) return { ok: false, error: "Cancellation flow failed. See server logs." };

    revalidatePath(`/events/${ve.eventId}`);
    revalidatePath("/crawl-management");
    revalidatePath("/worklist");
    return {
      ok: true,
      data: {
        draftsCancelled: result.draftsCancelled,
        tasksCancelled: result.tasksCancelled,
        t16Drafted: result.t16DraftId !== null,
        offerReplacement: wasConfirmed,
        role: ve.role,
        eventId: ve.eventId,
      },
    };
  } catch (err) {
    logger.error({ err, venueEventId: input.venueEventId }, "runGuidedCancellation failed");
    return { ok: false, error: "Cancellation failed. See server logs." };
  }
}
