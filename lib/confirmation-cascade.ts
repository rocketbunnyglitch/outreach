/**
 * Confirmation cascade: when a venue_event status transitions to
 * `confirmed`, generate the operational follow-up tasks automatically.
 *
 * Cascade is invoked from the venue_event update action when the status
 * flips. The transaction context is passed in so the cascade writes are
 * atomic with the venue_event update (and audit attribution is
 * preserved).
 *
 * Cascade contents (Phase 7b):
 *   1. Deliver poster to <venue>           — due immediately (no SLA)
 *   2. 2-week confirm with <venue>         — due event_date - 14d
 *   3. 1-week confirm with <venue>         — due event_date -  7d
 *   4. Floor staff brief for <venue>       — due event_date -  3d
 *
 * Idempotency: before inserting, we delete any existing auto-generated
 * tasks targeting this venue_event. So re-firing (e.g. status flipped to
 * pending then back to confirmed) cleanly regenerates the cascade.
 * Manually-created tasks (source='manual') for the same target are
 * NEVER touched.
 *
 * Assignee: the city_campaign.lead_staff_id. If unset, tasks land
 * unassigned and any staff can claim them.
 */

import { crawlDeliverables, tasks } from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";

type Tx = Parameters<Parameters<typeof import("@/lib/db").withAuditContext>[1]>[0];

/**
 * Title prefix for the auto-generated "create the social graphic" task. The
 * Graphics queue (Graphics tab) filters tasks by this prefix, so keep them in
 * sync. [Graphics workflow]
 */
export const GRAPHICS_TASK_TITLE_PREFIX = "Design social graphic";

interface CascadeContext {
  venueEventId: string;
  venueName: string;
  eventDate: Date;
  leadStaffId: string | null;
}

export interface CascadeResult {
  tasksCreated: number;
  skipped: boolean;
  /** Set when a graphics task was created, so the caller can notify the
   *  assignee after the transaction commits. */
  graphics: { assigneeId: string | null; venueName: string } | null;
}

export async function generateConfirmationCascade(
  tx: Tx,
  venueEventId: string,
  opts?: { graphicsDesignerId?: string | null },
): Promise<CascadeResult> {
  // 1. Pull the bits we need: venue.name, event.eventDate, city_campaign.lead_staff
  const ctxRows = await tx.execute<{
    venue_event_id: string;
    venue_name: string;
    event_date: string;
    lead_staff_id: string | null;
    role: string;
    event_id: string;
  }>(sql`
    SELECT
      ve.id AS venue_event_id,
      v.name AS venue_name,
      e.event_date::text AS event_date,
      cc.lead_staff_id,
      ve.role,
      e.id AS event_id
    FROM venue_events ve
    JOIN venues v ON v.id = ve.venue_id
    JOIN events e ON e.id = ve.event_id
    JOIN city_campaigns cc ON cc.id = e.city_campaign_id
    WHERE ve.id = ${venueEventId}
    LIMIT 1
  `);
  const list = Array.isArray(ctxRows)
    ? ctxRows
    : ((
        ctxRows as unknown as {
          rows: Array<{
            venue_event_id: string;
            venue_name: string;
            event_date: string;
            lead_staff_id: string | null;
            role: string;
            event_id: string;
          }>;
        }
      ).rows ?? []);
  const row = list[0];
  if (!row) {
    return { tasksCreated: 0, skipped: true, graphics: null };
  }

  const ctx: CascadeContext = {
    venueEventId: row.venue_event_id,
    venueName: row.venue_name,
    eventDate: new Date(`${row.event_date}T00:00:00Z`),
    leadStaffId: row.lead_staff_id,
  };

  // 2. Clean up any UNFINISHED auto tasks for this venue_event so we regenerate
  //    cleanly. Only pending/in_progress are removed -- COMPLETED auto tasks are
  //    preserved (deleting them on a re-confirm/slot-swap destroyed SLA history
  //    and re-surfaced already-done work). Manual tasks are never touched.
  await tx
    .delete(tasks)
    .where(
      and(
        eq(tasks.targetId, venueEventId),
        eq(tasks.targetType, "venue_event"),
        eq(tasks.source, "auto"),
        inArray(tasks.status, ["pending", "in_progress"]),
      ),
    );

  // 3. Build the cascade
  const daysBefore = (n: number): Date => {
    const d = new Date(ctx.eventDate);
    d.setUTCDate(d.getUTCDate() - n);
    return d;
  };

  const cascade = [
    {
      title: `Deliver poster to ${ctx.venueName}`,
      description: `Drop the printed poster off at ${ctx.venueName}. Schedule with the night-of contact if needed.`,
      dueAt: null, // No specific due date — just "do it soon"
      slaThresholdMinutes: null,
    },
    {
      title: `2-week confirm with ${ctx.venueName}`,
      description: `Two-week confirmation touch — check ${ctx.venueName} is still good for the event date.`,
      dueAt: daysBefore(14),
      slaThresholdMinutes: 60 * 24, // 1-day SLA after due
    },
    {
      title: `1-week confirm with ${ctx.venueName}`,
      description: `One-week confirmation touch — last chance to flag any logistics issues with ${ctx.venueName}.`,
      dueAt: daysBefore(7),
      slaThresholdMinutes: 60 * 12, // 12-hour SLA — get on it
    },
    {
      title: `Floor staff brief for ${ctx.venueName}`,
      description: `Send floor staff the night-of contact + drink specials + role notes for ${ctx.venueName}.`,
      dueAt: daysBefore(3),
      slaThresholdMinutes: 60 * 6, // 6-hour SLA — closer to the night
    },
  ];

  await tx.insert(tasks).values(
    cascade.map((c) => ({
      title: c.title,
      description: c.description,
      source: "auto" as const,
      status: "pending" as const,
      targetType: "venue_event" as const,
      targetId: venueEventId,
      assignedStaffId: ctx.leadStaffId,
      dueAt: c.dueAt,
      slaThresholdMinutes: c.slaThresholdMinutes,
    })),
  );

  // Graphics workflow: auto-create the "create the social graphic" task,
  // assigned to the graphics_designer (resolved by the caller from the engine
  // roles) or falling back to the city lead, plus the social_media_graphics
  // deliverable row the lifecycle owner later flips to "done" (= sent to the
  // venue). The deliverable insert is onConflictDoNothing so a re-confirm never
  // wipes a prior "sent" status. The graphics task IS an auto task, so the
  // cleanup-delete above regenerates it on a re-confirm like the others.
  const graphicsAssignee = opts?.graphicsDesignerId ?? ctx.leadStaffId;
  await tx.insert(tasks).values({
    title: `${GRAPHICS_TASK_TITLE_PREFIX} for ${ctx.venueName}`,
    description: `${ctx.venueName} is confirmed. Create the social media graphic, then hand it to the lifecycle owner to send to the venue.`,
    source: "auto" as const,
    status: "pending" as const,
    targetType: "venue_event" as const,
    targetId: venueEventId,
    assignedStaffId: graphicsAssignee,
    dueAt: daysBefore(10),
    slaThresholdMinutes: null,
  });

  await tx
    .insert(crawlDeliverables)
    .values({
      venueEventId,
      deliverableType: "social_media_graphics" as const,
      status: "pending" as const,
      assignedStaffId: graphicsAssignee,
    })
    .onConflictDoNothing({
      target: [crawlDeliverables.venueEventId, crawlDeliverables.deliverableType],
    });

  // Wristband venues host check-in, so they additionally owe the participant
  // sheet/poster (refdoc 7.4.2) — and the T11 send gate now requires this
  // deliverable to be "done" before the staff-info email can go out (CRM plan
  // A2). Auto-create it pending on confirm so the gate points at a real row
  // the team can see and flip, instead of failing against nothing.
  if (row.role === "wristband") {
    await tx
      .insert(crawlDeliverables)
      .values({
        venueEventId,
        deliverableType: "participant_poster" as const,
        status: "pending" as const,
        assignedStaffId: ctx.leadStaffId,
      })
      .onConflictDoNothing({
        target: [crawlDeliverables.venueEventId, crawlDeliverables.deliverableType],
      });
  }

  // Replacement playbook close (CRM plan B2): if an emergency push is open
  // for this (event, role), this confirm fills it — mark the push filled and
  // cancel its unsent sibling drafts atomically with the confirm, so nobody
  // keeps pitching a slot that's already taken. No-op in the common case.
  try {
    const { closeFilledReplacementPushes } = await import("@/lib/emergency-replacement");
    await closeFilledReplacementPushes(tx, {
      eventId: row.event_id,
      role: row.role,
      filledByVenueEventId: venueEventId,
    });
  } catch (replErr) {
    // Never block the confirm on playbook bookkeeping.
    const { logger } = await import("@/lib/logger");
    logger.error({ err: replErr, venueEventId }, "closeFilledReplacementPushes failed");
  }

  return {
    tasksCreated: cascade.length + 1,
    skipped: false,
    graphics: { assigneeId: graphicsAssignee, venueName: ctx.venueName },
  };
}

/**
 * Detect whether a status update represents a transition INTO confirmed.
 * The cascade should only fire on transitions, not on every save while
 * already confirmed.
 */
export function isConfirmationTransition(
  previousStatus: string | null | undefined,
  newStatus: string | null | undefined,
): boolean {
  return previousStatus !== "confirmed" && newStatus === "confirmed";
}
