import "server-only";

/**
 * Lifecycle scheduler (Phase 3.1). [ReferenceDoc 7]
 *
 * When a venue is confirmed for a crawl, the engine auto-creates the
 * post-confirm email_drafts (scheduled_for set) so they surface in the worklist
 * on the right day. The existing confirmation-cascade owns the operational
 * TASKS + the graphics deliverable; this scheduler owns the EMAILS. They share
 * the venue_events timestamp columns so neither double-fires.
 *
 * Touches (the seeded Halloween 2026 set; T10 is the graphics email, gated by
 * graphics readiness, so not time-scheduled here):
 *   - T9 / T9-near -> confirm time, REVIEW draft (scheduled_for null). T9-near
 *     (loaded, bundles T11 info) replaces sparse T9 inside the 3-week window.
 *   - T11  -> event - 21 days   (far confirms only; near bundles it into T9-near)
 *   - T13  -> event - 14 days   (idempotency: venue_events.two_week_email_sent_at)
 *   - T14  -> event -  7 days   (idempotency: venue_events.one_week_email_sent_at)
 *   - T15  -> morning of event
 *   - T17  -> event +  2 days
 *
 * Multi-night (3.3): anchors to the earliest confirmed night. Per-night T15
 * split is a later refinement.
 */

import {
  events,
  campaigns,
  cityCampaigns,
  emailDrafts,
  emailTemplates,
  venueEvents,
  venues,
} from "@/db/schema";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { buildFlatMergeContext } from "@/lib/template-merge-context";
import { renderTemplate } from "@/lib/template-render";
import { and, asc, eq, gt, inArray, isNull, or } from "drizzle-orm";

interface LifecycleTouch {
  code: string;
  /** Days relative to the event date (negative = before). */
  offsetDays: number;
  /** Local hour of day for scheduled_for. */
  hourUtc: number;
  /** venue_events column whose presence means this touch already went out. */
  sentAtColumn?: "twoWeekEmailSentAt" | "oneWeekEmailSentAt";
}

const LIFECYCLE_TOUCHES: LifecycleTouch[] = [
  { code: "T13", offsetDays: -14, hourUtc: 14, sentAtColumn: "twoWeekEmailSentAt" },
  { code: "T14", offsetDays: -7, hourUtc: 14, sentAtColumn: "oneWeekEmailSentAt" },
  { code: "T15", offsetDays: 0, hourUtc: 13 },
  { code: "T17", offsetDays: 2, hourUtc: 14 },
];

export interface ScheduleLifecycleArgs {
  venueEventId: string;
  /** Draft owner (lifecycle_owner engine role, else city lead, else confirmer). */
  ownerStaffId: string | null;
  /** Owner's team (email_drafts.team_id is NOT NULL). */
  teamId: string;
}

export interface ScheduleLifecycleResult {
  scheduledDraftIds: string[];
  skippedTouches: { code: string; reason: string }[];
}

function scheduledForOf(eventDate: Date, touch: LifecycleTouch): Date {
  const d = new Date(eventDate);
  d.setUTCDate(d.getUTCDate() + touch.offsetDays);
  d.setUTCHours(touch.hourUtc, 0, 0, 0);
  return d;
}

export async function scheduleLifecycle(
  args: ScheduleLifecycleArgs,
): Promise<ScheduleLifecycleResult> {
  const scheduledDraftIds: string[] = [];
  const skippedTouches: { code: string; reason: string }[] = [];

  if (!args.ownerStaffId) {
    return { scheduledDraftIds, skippedTouches: [{ code: "*", reason: "no lifecycle owner" }] };
  }

  const [ve] = await db
    .select({
      venueId: venueEvents.venueId,
      eventId: venueEvents.eventId,
      eventDate: events.eventDate,
      cityCampaignId: events.cityCampaignId,
      campaignId: cityCampaigns.campaignId,
      venueEmail: venues.email,
      twoWeekEmailSentAt: venueEvents.twoWeekEmailSentAt,
      oneWeekEmailSentAt: venueEvents.oneWeekEmailSentAt,
    })
    .from(venueEvents)
    .innerJoin(events, eq(events.id, venueEvents.eventId))
    .innerJoin(cityCampaigns, eq(cityCampaigns.id, events.cityCampaignId))
    .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
    .innerJoin(venues, eq(venues.id, venueEvents.venueId))
    .where(eq(venueEvents.id, args.venueEventId))
    .limit(1);
  if (!ve) {
    return { scheduledDraftIds, skippedTouches: [{ code: "*", reason: "venue_event not found" }] };
  }

  // Multi-night (Phase 3.3): anchor the bundled lifecycle to the EARLIEST
  // confirmed night for this venue in the campaign, so confirming a second
  // night doesn't shift the schedule (and the per-template dedup below doesn't
  // drop the first night's drafts). venue_nights_summary in the merge context
  // names every night. T15 (day-of) still anchors here; per-night day-of splits
  // are a later refinement.
  const [earliest] = await db
    .select({ eventDate: events.eventDate })
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
  const eventDate = new Date(`${earliest?.eventDate ?? ve.eventDate}T00:00:00Z`);
  const now = new Date();

  // T9 fires at confirm time as a REVIEW draft (scheduled_for null) -- the
  // operator reviews/edits/sends it (ReferenceDoc 7.2). Inside the 3-week window
  // the loaded T9-near variant replaces the sparse T9 and bundles the T11 info,
  // so the separate T11 (3 weeks out) is only scheduled for far confirms.
  const daysToEvent = Math.floor((eventDate.getTime() - now.getTime()) / 86_400_000);
  type PlannedTouch = {
    code: string;
    scheduledFor: Date | null;
    sentAtColumn?: "twoWeekEmailSentAt" | "oneWeekEmailSentAt";
  };
  const plan: PlannedTouch[] = [{ code: daysToEvent > 21 ? "T9" : "T9-near", scheduledFor: null }];
  if (daysToEvent > 21) {
    plan.push({
      code: "T11",
      scheduledFor: scheduledForOf(eventDate, { code: "T11", offsetDays: -21, hourUtc: 14 }),
    });
  }
  for (const t of LIFECYCLE_TOUCHES) {
    plan.push({
      code: t.code,
      scheduledFor: scheduledForOf(eventDate, t),
      sentAtColumn: t.sentAtColumn,
    });
  }

  // Resolve every template the plan needs for this campaign.
  const codes = [...new Set(plan.map((p) => p.code))];
  const templates = await db
    .select({
      id: emailTemplates.id,
      code: emailTemplates.templateCode,
      subject: emailTemplates.subjectTemplate,
      bodyHtml: emailTemplates.bodyTemplateHtml,
      bodyText: emailTemplates.bodyTemplateText,
    })
    .from(emailTemplates)
    .where(
      and(
        eq(emailTemplates.campaignId, ve.campaignId),
        inArray(emailTemplates.templateCode, codes),
      ),
    );
  const byCode = new Map(templates.map((t) => [t.code, t]));

  // One merge context for this venue_event covers every lifecycle touch.
  const ctx = await buildFlatMergeContext({
    venueId: ve.venueId,
    campaignId: ve.campaignId,
    cityCampaignId: ve.cityCampaignId,
    eventId: ve.eventId,
    staffId: args.ownerStaffId,
  });

  for (const touch of plan) {
    const tpl = byCode.get(touch.code);
    if (!tpl) {
      skippedTouches.push({ code: touch.code, reason: "template not seeded" });
      continue;
    }
    if (touch.sentAtColumn && ve[touch.sentAtColumn]) {
      skippedTouches.push({ code: touch.code, reason: "already sent" });
      continue;
    }
    // A scheduled touch (Date) whose window has passed is skipped; a review
    // draft (scheduledFor null, e.g. T9) is always created.
    if (touch.scheduledFor && touch.scheduledFor.getTime() <= now.getTime()) {
      skippedTouches.push({ code: touch.code, reason: "window passed" });
      continue;
    }

    const subject = renderTemplate(tpl.subject, ctx).output;
    const bodyText = renderTemplate(tpl.bodyText, ctx).output;
    const bodyHtml = tpl.bodyHtml ? renderTemplate(tpl.bodyHtml, ctx).output : null;

    // Idempotent re-confirm: drop any prior unsent draft for this venue +
    // template that is still pending -- a future-scheduled one OR an unsent
    // review draft (scheduled_for null) -- so flipping confirmed off/on or
    // confirming another night doesn't pile up duplicates.
    await db
      .delete(emailDrafts)
      .where(
        and(
          eq(emailDrafts.venueId, ve.venueId),
          eq(emailDrafts.templateId, tpl.id),
          isNull(emailDrafts.sentAt),
          or(isNull(emailDrafts.scheduledFor), gt(emailDrafts.scheduledFor, now)),
        ),
      );

    const [inserted] = await db
      .insert(emailDrafts)
      .values({
        ownerUserId: args.ownerStaffId,
        teamId: args.teamId,
        toAddresses: ve.venueEmail ? [ve.venueEmail] : [],
        subject,
        bodyText,
        bodyHtml,
        venueId: ve.venueId,
        cityCampaignId: ve.cityCampaignId,
        templateId: tpl.id,
        scheduledFor: touch.scheduledFor,
      })
      .returning({ id: emailDrafts.id });
    if (inserted) scheduledDraftIds.push(inserted.id);
  }

  logger.info(
    {
      venueEventId: args.venueEventId,
      scheduled: scheduledDraftIds.length,
      skipped: skippedTouches,
    },
    "lifecycle scheduled",
  );
  return { scheduledDraftIds, skippedTouches };
}
