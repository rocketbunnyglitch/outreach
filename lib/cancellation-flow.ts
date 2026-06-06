import "server-only";

/**
 * Venue cancellation flow (Phase 4.1/4.3/4.4/4.5). [ReferenceDoc 7.16]
 *
 * When a confirmed venue backs out, triggerVenueCancellation:
 *   - marks the venue_event cancelled (status + when/why/who),
 *   - 4.3 stops downstream: deletes the venue's unsent scheduled lifecycle
 *     drafts (T13-T17) and cancels the pending auto tasks for the event,
 *   - 4.4 drafts the T16 cancellation email to the venue (review + send),
 *   - 4.5 notifies the city lead.
 *
 * Operator-initiated: the classifier flags cancellation language
 * (cancelled_by_them) but a human confirms the actual cancellation, per the
 * classifier-suggests / human-confirms invariant.
 */

import {
  events,
  campaigns,
  cityCampaigns,
  emailDrafts,
  emailTemplates,
  tasks,
  venueEvents,
  venues,
} from "@/db/schema";
import { db, withAuditContext } from "@/lib/db";
import { logger } from "@/lib/logger";
import { buildFlatMergeContext } from "@/lib/template-merge-context";
import { renderTemplate } from "@/lib/template-render";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

export interface CancellationArgs {
  venueEventId: string;
  /** Short human reason, also merged into T16 as cancellation_reason_phrase. */
  reason: string;
  byStaffId: string;
  teamId: string;
}

export interface CancellationResult {
  ok: boolean;
  t16DraftId: string | null;
  draftsCancelled: number;
  tasksCancelled: number;
  notified: number;
}

export async function triggerVenueCancellation(
  args: CancellationArgs,
): Promise<CancellationResult> {
  const [ve] = await db
    .select({
      venueId: venueEvents.venueId,
      eventId: venueEvents.eventId,
      venueName: venues.name,
      venueEmail: venues.email,
      cityCampaignId: events.cityCampaignId,
      campaignId: cityCampaigns.campaignId,
      leadStaffId: cityCampaigns.leadStaffId,
      eventDate: events.eventDate,
    })
    .from(venueEvents)
    .innerJoin(events, eq(events.id, venueEvents.eventId))
    .innerJoin(cityCampaigns, eq(cityCampaigns.id, events.cityCampaignId))
    .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
    .innerJoin(venues, eq(venues.id, venueEvents.venueId))
    .where(eq(venueEvents.id, args.venueEventId))
    .limit(1);
  if (!ve) {
    return { ok: false, t16DraftId: null, draftsCancelled: 0, tasksCancelled: 0, notified: 0 };
  }

  let draftsCancelled = 0;
  let tasksCancelled = 0;
  await withAuditContext(args.byStaffId, async (tx) => {
    // 1. Mark the venue_event cancelled.
    await tx
      .update(venueEvents)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        cancellationReason: args.reason,
        cancelledBy: args.byStaffId,
      })
      .where(eq(venueEvents.id, args.venueEventId));

    // 2. (4.3 + P0-5) Stop downstream lifecycle emails for THIS NIGHT ONLY --
    // scope the delete to the cancelled venue_event so a multi-night venue keeps
    // its other nights' drafts. Deletes this night's unsent lifecycle drafts
    // (review + scheduled). Bundled drafts owned by the anchor night are rebuilt
    // below if other nights remain. Drafts with no venue_event are left alone.
    const delDrafts = await tx
      .delete(emailDrafts)
      .where(and(eq(emailDrafts.venueEventId, args.venueEventId), isNull(emailDrafts.sentAt)))
      .returning({ id: emailDrafts.id });
    draftsCancelled = delDrafts.length;

    // 3. (4.3) Cancel the pending auto tasks for this venue_event.
    const cancTasks = await tx
      .update(tasks)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(tasks.targetType, "venue_event"),
          eq(tasks.targetId, args.venueEventId),
          eq(tasks.source, "auto"),
          inArray(tasks.status, ["pending", "in_progress"]),
        ),
      )
      .returning({ id: tasks.id });
    tasksCancelled = cancTasks.length;

    // 3b. (P0-5) Open the slot for replacement. The freed slot is already "open"
    // (the confirmed-filter excludes cancelled venue_events); this auto task is
    // the needs-replacement signal in the city lead's worklist.
    await tx.insert(tasks).values({
      title: `Find replacement: ${ve.venueName}`,
      description: `${ve.venueName} cancelled (${args.reason}). Its slot is open and needs a replacement venue.`,
      source: "auto",
      status: "pending",
      targetType: "venue_event",
      targetId: args.venueEventId,
      assignedStaffId: ve.leadStaffId ?? null,
      dueAt: new Date(),
      createdBy: args.byStaffId,
      updatedBy: args.byStaffId,
    });
  });

  // 4. (4.4) Draft the T16 cancellation email to the venue (review + send).
  let t16DraftId: string | null = null;
  const [t16] = await db
    .select({
      id: emailTemplates.id,
      subject: emailTemplates.subjectTemplate,
      bodyHtml: emailTemplates.bodyTemplateHtml,
      bodyText: emailTemplates.bodyTemplateText,
    })
    .from(emailTemplates)
    .where(
      and(eq(emailTemplates.campaignId, ve.campaignId), eq(emailTemplates.templateCode, "T16")),
    )
    .limit(1);
  if (t16) {
    const ctx = await buildFlatMergeContext({
      venueId: ve.venueId,
      campaignId: ve.campaignId,
      cityCampaignId: ve.cityCampaignId,
      eventId: ve.eventId,
      staffId: args.byStaffId,
    });
    // cancellation_reason_phrase is engine/operator-supplied at this point.
    ctx.cancellation_reason_phrase = args.reason;
    const [inserted] = await db
      .insert(emailDrafts)
      .values({
        ownerUserId: args.byStaffId,
        teamId: args.teamId,
        toAddresses: ve.venueEmail ? [ve.venueEmail] : [],
        subject: renderTemplate(t16.subject, ctx).output,
        bodyText: renderTemplate(t16.bodyText, ctx).output,
        bodyHtml: t16.bodyHtml ? renderTemplate(t16.bodyHtml, ctx).output : null,
        venueId: ve.venueId,
        cityCampaignId: ve.cityCampaignId,
        venueEventId: args.venueEventId,
        templateId: t16.id,
        scheduledFor: null,
        // P0-1: T16 is a venue email -- review-required (a human sends it).
        sendMode: "review_required",
        requiresHumanApproval: true,
        recipientType: "venue",
        touchType: "T16",
      })
      .returning({ id: emailDrafts.id });
    t16DraftId = inserted?.id ?? null;
  }

  // (P0-5) If other confirmed nights remain for this venue + campaign, rebuild
  // the bundled lifecycle against the earliest remaining night -- so cancelling
  // the night that anchored the bundled T9-T17 set does not strand the other
  // nights. scheduleLifecycle is idempotent (delete-then-insert per template).
  try {
    const [remaining] = await db
      .select({ venueEventId: venueEvents.id })
      .from(venueEvents)
      .innerJoin(events, eq(events.id, venueEvents.eventId))
      .innerJoin(cityCampaigns, eq(cityCampaigns.id, events.cityCampaignId))
      .where(
        and(
          eq(venueEvents.venueId, ve.venueId),
          eq(cityCampaigns.campaignId, ve.campaignId),
          eq(venueEvents.status, "confirmed"),
        ),
      )
      .orderBy(asc(events.eventDate))
      .limit(1);
    if (remaining) {
      const { scheduleLifecycle } = await import("@/lib/lifecycle-scheduler");
      const { resolveEngineRole } = await import("@/lib/engine-roles");
      const ownerStaffId =
        (await resolveEngineRole(args.teamId, "lifecycle_owner")) ??
        ve.leadStaffId ??
        args.byStaffId;
      await scheduleLifecycle({
        venueEventId: remaining.venueEventId,
        ownerStaffId,
        teamId: args.teamId,
      });
    }
  } catch (err) {
    logger.error(
      { err, venueEventId: args.venueEventId },
      "cancellation: lifecycle rebuild for remaining nights failed",
    );
  }

  // 5. (4.5) Notify the city lead (when it's not the operator who cancelled).
  // Escalation tier by urgency (4.6): day-of cancellations escalate in 15 min,
  // event-week in 2 hours, otherwise 24 hours.
  let notified = 0;
  if (ve.leadStaffId && ve.leadStaffId !== args.byStaffId) {
    try {
      const now = new Date();
      const daysToEvent = ve.eventDate
        ? Math.floor((new Date(`${ve.eventDate}T00:00:00Z`).getTime() - now.getTime()) / 86_400_000)
        : 999;
      const escalateMs =
        daysToEvent <= 0 ? 15 * 60_000 : daysToEvent <= 7 ? 2 * 3_600_000 : 24 * 3_600_000;
      const { emitNotification } = await import("@/app/(admin)/_actions/notifications");
      await emitNotification({
        staffId: ve.leadStaffId,
        kind: "admin_message",
        title: `Venue cancelled: ${ve.venueName}`,
        body: `${ve.venueName} cancelled (${args.reason}). Downstream emails stopped; a T16 draft is ready to review.`,
        linkPath: `/venues/${ve.venueId}`,
        escalateAfter: new Date(now.getTime() + escalateMs),
      });
      notified = 1;
    } catch (err) {
      logger.error({ err, venueEventId: args.venueEventId }, "cancellation notify failed");
    }
  }

  logger.info(
    { venueEventId: args.venueEventId, draftsCancelled, tasksCancelled, t16DraftId, notified },
    "venue cancellation processed",
  );
  return { ok: true, t16DraftId, draftsCancelled, tasksCancelled, notified };
}
