import "server-only";

/**
 * Venue activity timeline -- server read path. [CRM buildout, Phase 6]
 *
 * Merges every venue-related activity source into ONE chronological feed: email
 * threads, calls, manual touches, notes, tasks, slot lifecycle (assigned /
 * confirmed / cancelled), floor-staff (V2) outcomes, wristband shipments and
 * relationship-flag changes. Each source is queried independently and degraded
 * to empty on error (CLAUDE.md 12.3/12.4) so one bad source never 500s the
 * venue page. Timestamps are formatted here (pinned tz) so the client timeline
 * renders plain strings -- no client-side date work, no hydration risk.
 */

import {
  events,
  callLogs,
  campaigns,
  cities,
  cityCampaigns,
  crawlDeliverables,
  emailSendEvents,
  emailThreads,
  notes,
  outreachBrands,
  outreachLog,
  tasks,
  users,
  venueDomainRelationships,
  venueEvents,
  wristbands,
} from "@/db/schema";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  type ActivityTone,
  type VenueActivityEntry,
  sortActivityDesc,
} from "@/lib/venue-activity-core";
import { loadVenueCommunication } from "@/lib/venue-communication";
import { and, desc, eq, inArray, isNotNull, ne, or } from "drizzle-orm";

export interface VenueActivityData {
  entries: VenueActivityEntry[];
  /** Distinct campaigns present in the feed -- powers the campaign filter. */
  campaigns: Array<{ id: string; name: string }>;
}

const TZ = "America/Toronto";
const DTF = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: TZ,
});

function fmt(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? "" : DTF.format(date);
}
function iso(d: Date | string): string {
  return (d instanceof Date ? d : new Date(d)).toISOString();
}
function truncate(s: string | null | undefined, n: number): string | null {
  if (!s) return null;
  const t = s.trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

const ROLE_LABEL: Record<string, string> = {
  wristband: "Wristband",
  middle: "Middle",
  final: "Final",
  alt_final: "Alt final",
};
const DAY_PART_SHORT: Record<string, string> = {
  thursday_night: "Thu",
  friday_night: "Fri",
  saturday_day: "Sat day",
  saturday_night: "Sat",
  sunday_day: "Sun day",
  sunday_night: "Sun",
  other: "",
};

function classificationTone(c: string | null | undefined): ActivityTone {
  const v = (c ?? "").toLowerCase();
  if (["interested", "warm", "confirmed", "callback_requested"].includes(v)) return "positive";
  if (["decline", "unsubscribe", "spam", "cancelled_by_them"].includes(v)) return "negative";
  return "neutral";
}

/** Build the unified, newest-first activity feed for a venue. */
export async function loadVenueActivity(
  venueId: string,
  teamId: string,
): Promise<VenueActivityData> {
  // venue_events lifecycle first -- its ids also scope the task query.
  const veRows = await db
    .select({
      veId: venueEvents.id,
      role: venueEvents.role,
      createdAt: venueEvents.createdAt,
      confirmedAt: venueEvents.confirmedAt,
      cancelledAt: venueEvents.cancelledAt,
      cancellationReason: venueEvents.cancellationReason,
      floorDoneAt: venueEvents.floorStaffCallCompletedAt,
      floorLastAt: venueEvents.floorStaffLastCallAt,
      floorOutcome: venueEvents.floorStaffLastCallOutcome,
      eventDate: events.eventDate,
      dayPart: events.dayPart,
      campaignId: campaigns.id,
      campaignName: campaigns.name,
      cityName: cities.name,
    })
    .from(venueEvents)
    .innerJoin(events, eq(events.id, venueEvents.eventId))
    .innerJoin(cityCampaigns, eq(cityCampaigns.id, events.cityCampaignId))
    .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
    .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
    .where(eq(venueEvents.venueId, venueId))
    .catch((err) => {
      logger.error({ err, venueId }, "venue-activity: venue_events failed");
      return [] as never[];
    });
  const veIds = veRows.map((r) => r.veId);

  // Tasks tied to the venue directly, plus tasks on any of its venue_events.
  const taskWhere =
    veIds.length > 0
      ? or(
          and(eq(tasks.targetType, "venue"), eq(tasks.targetId, venueId)),
          and(eq(tasks.targetType, "venue_event"), inArray(tasks.targetId, veIds)),
        )
      : and(eq(tasks.targetType, "venue"), eq(tasks.targetId, venueId));

  const [comm, callRows, noteRows, taskRows, relRows, wbRows, touchRows, delivRows, overrideRows] =
    await Promise.all([
      loadVenueCommunication(venueId, teamId).catch((err) => {
        logger.error({ err, venueId }, "venue-activity: communication failed");
        return null;
      }),
      db
        .select({
          id: callLogs.id,
          direction: callLogs.direction,
          status: callLogs.status,
          durationSeconds: callLogs.durationSeconds,
          callerName: callLogs.callerName,
          occurredAt: callLogs.occurredAt,
        })
        .from(callLogs)
        .where(eq(callLogs.matchedVenueId, venueId))
        .orderBy(desc(callLogs.occurredAt))
        .limit(100)
        .catch((err) => {
          logger.error({ err, venueId }, "venue-activity: calls failed");
          return [];
        }),
      db
        .select({
          id: notes.id,
          body: notes.body,
          createdAt: notes.createdAt,
          author: users.displayName,
        })
        .from(notes)
        .leftJoin(users, eq(users.id, notes.authorStaffId))
        .where(and(eq(notes.targetType, "venue"), eq(notes.targetId, venueId)))
        .orderBy(desc(notes.createdAt))
        .limit(100)
        .catch((err) => {
          logger.error({ err, venueId }, "venue-activity: notes failed");
          return [];
        }),
      db
        .select({
          id: tasks.id,
          title: tasks.title,
          status: tasks.status,
          createdAt: tasks.createdAt,
          completedAt: tasks.completedAt,
          assignee: users.displayName,
        })
        .from(tasks)
        .leftJoin(users, eq(users.id, tasks.assignedStaffId))
        .where(taskWhere)
        .orderBy(desc(tasks.createdAt))
        .limit(100)
        .catch((err) => {
          logger.error({ err, venueId }, "venue-activity: tasks failed");
          return [];
        }),
      db
        .select({
          id: venueDomainRelationships.id,
          status: venueDomainRelationships.status,
          notes: venueDomainRelationships.notes,
          setAt: venueDomainRelationships.setAt,
          brand: outreachBrands.displayName,
          byName: users.displayName,
        })
        .from(venueDomainRelationships)
        .innerJoin(outreachBrands, eq(outreachBrands.id, venueDomainRelationships.outreachBrandId))
        .leftJoin(users, eq(users.id, venueDomainRelationships.setByStaffId))
        .where(eq(venueDomainRelationships.venueId, venueId))
        .catch((err) => {
          logger.error({ err, venueId }, "venue-activity: relationships failed");
          return [];
        }),
      db
        .select({
          id: wristbands.id,
          status: wristbands.status,
          shippedAt: wristbands.shippedAt,
          deliveredAt: wristbands.deliveredAt,
          carrier: wristbands.carrier,
          trackingNumber: wristbands.trackingNumber,
          campaignId: campaigns.id,
          campaignName: campaigns.name,
        })
        .from(wristbands)
        .innerJoin(venueEvents, eq(venueEvents.id, wristbands.venueEventId))
        .innerJoin(events, eq(events.id, venueEvents.eventId))
        .innerJoin(cityCampaigns, eq(cityCampaigns.id, events.cityCampaignId))
        .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
        .where(eq(venueEvents.venueId, venueId))
        .catch((err) => {
          logger.error({ err, venueId }, "venue-activity: wristbands failed");
          return [];
        }),
      db
        .select({
          id: outreachLog.id,
          channel: outreachLog.channel,
          outcome: outreachLog.outcome,
          subject: outreachLog.subject,
          createdAt: outreachLog.createdAt,
          by: users.displayName,
        })
        .from(outreachLog)
        .leftJoin(users, eq(users.id, outreachLog.staffMemberId))
        .where(
          and(
            eq(outreachLog.venueId, venueId),
            // Emails + calls already surface via their own sources; keep only the
            // manual touch channels here (sms / instagram / form / in_person...).
            ne(outreachLog.channel, "email"),
            ne(outreachLog.channel, "call"),
          ),
        )
        .orderBy(desc(outreachLog.createdAt))
        .limit(100)
        .catch((err) => {
          logger.error({ err, venueId }, "venue-activity: outreach_log failed");
          return [];
        }),
      // Deliverable events (CRM plan D3): a deliverable flipped to done/n_a
      // is real work that previously left no trace in the timeline.
      veIds.length > 0
        ? db
            .select({
              id: crawlDeliverables.id,
              deliverableType: crawlDeliverables.deliverableType,
              status: crawlDeliverables.status,
              updatedAt: crawlDeliverables.updatedAt,
              by: users.displayName,
              campaignId: campaigns.id,
              campaignName: campaigns.name,
            })
            .from(crawlDeliverables)
            .innerJoin(venueEvents, eq(venueEvents.id, crawlDeliverables.venueEventId))
            .innerJoin(events, eq(events.id, venueEvents.eventId))
            .innerJoin(cityCampaigns, eq(cityCampaigns.id, events.cityCampaignId))
            .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
            .leftJoin(users, eq(users.id, crawlDeliverables.updatedBy))
            .where(
              and(
                inArray(crawlDeliverables.venueEventId, veIds),
                ne(crawlDeliverables.status, "pending"),
              ),
            )
            .catch((err) => {
              logger.error({ err, venueId }, "venue-activity: deliverables failed");
              return [];
            })
        : Promise.resolve([]),
      // Manual overrides (CRM plan D3): cap bypasses + cadence-floor
      // overrides on sends tied to this venue's nights — the timeline must
      // show when a human reached around the rails and why.
      veIds.length > 0
        ? db
            .select({
              id: emailSendEvents.id,
              sentAt: emailSendEvents.sentAt,
              capBypassed: emailSendEvents.capBypassed,
              overrideReason: emailSendEvents.cadenceOverrideReason,
              campaignId: campaigns.id,
              campaignName: campaigns.name,
            })
            .from(emailSendEvents)
            .innerJoin(venueEvents, eq(venueEvents.id, emailSendEvents.venueEventId))
            .innerJoin(events, eq(events.id, venueEvents.eventId))
            .innerJoin(cityCampaigns, eq(cityCampaigns.id, events.cityCampaignId))
            .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
            .where(
              and(
                inArray(emailSendEvents.venueEventId, veIds),
                or(
                  eq(emailSendEvents.capBypassed, true),
                  isNotNull(emailSendEvents.cadenceOverrideReason),
                ),
              ),
            )
            .limit(50)
            .catch((err) => {
              logger.error({ err, venueId }, "venue-activity: overrides failed");
              return [];
            })
        : Promise.resolve([]),
    ]);

  // Thread -> campaign map (CRM plan D3): email entries previously carried no
  // campaign context, so picking a campaign in the filter HID every email.
  const threadIds = (comm?.threads ?? []).map((t) => t.threadId);
  const threadCampaignMap = new Map<string, { campaignId: string; campaignName: string }>();
  if (threadIds.length > 0) {
    const tcRows = await db
      .select({
        threadId: emailThreads.id,
        campaignId: campaigns.id,
        campaignName: campaigns.name,
      })
      .from(emailThreads)
      .innerJoin(cityCampaigns, eq(cityCampaigns.id, emailThreads.cityCampaignId))
      .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
      .where(inArray(emailThreads.id, threadIds))
      .catch((err) => {
        logger.error({ err, venueId }, "venue-activity: thread-campaign map failed");
        return [];
      });
    for (const r of tcRows) {
      threadCampaignMap.set(r.threadId, { campaignId: r.campaignId, campaignName: r.campaignName });
    }
  }

  const entries: VenueActivityEntry[] = [];

  // Emails (one entry per thread).
  for (const t of comm?.threads ?? []) {
    const conf =
      t.matchConfidence != null ? ` · ${Math.round(Number(t.matchConfidence) * 100)}%` : "";
    const threadCampaign = threadCampaignMap.get(t.threadId);
    entries.push({
      id: `email:${t.threadId}`,
      type: "email",
      at: iso(t.lastMessageAt),
      atLabel: fmt(t.lastMessageAt),
      title: t.subject || "(no subject)",
      detail: `${t.direction} · ${t.messageCount} msg${t.messageCount === 1 ? "" : "s"} · ${t.accountEmail}${conf}`,
      actor: t.ownerName,
      // Campaign context (D3): campaign-attributed threads stay visible
      // when the operator filters to a campaign; unattributed ones keep the
      // old venue-global behavior.
      campaignId: threadCampaign?.campaignId ?? null,
      campaignName: threadCampaign?.campaignName ?? null,
      href: `/inbox?thread=${t.threadId}`,
      tone: classificationTone(t.classification),
    });
  }

  // Deliverable events (D3).
  for (const d of delivRows) {
    entries.push({
      id: `deliverable:${d.id}`,
      type: "deliverable",
      at: iso(d.updatedAt),
      atLabel: fmt(d.updatedAt),
      title: `${d.deliverableType.replace(/_/g, " ")} marked ${d.status === "n_a" ? "N/A" : "done"}`,
      actor: d.by,
      campaignId: d.campaignId,
      campaignName: d.campaignName,
      href: "/crawl-management",
      tone: d.status === "done" ? "positive" : "neutral",
    });
  }

  // Manual overrides (D3).
  for (const o of overrideRows) {
    const parts: string[] = [];
    if (o.capBypassed) parts.push("send cap bypassed");
    if (o.overrideReason) parts.push(`cadence floor overridden: ${o.overrideReason}`);
    entries.push({
      id: `override:${o.id}`,
      type: "override",
      at: iso(o.sentAt),
      atLabel: fmt(o.sentAt),
      title: "Send-safety override",
      detail: parts.join(" · "),
      campaignId: o.campaignId,
      campaignName: o.campaignName,
      tone: "negative",
    });
  }

  // Calls.
  for (const c of callRows) {
    const mins = c.durationSeconds
      ? `${Math.floor(c.durationSeconds / 60)}m ${c.durationSeconds % 60}s`
      : null;
    entries.push({
      id: `call:${c.id}`,
      type: "call",
      at: iso(c.occurredAt),
      atLabel: fmt(c.occurredAt),
      title: `${c.direction === "incoming" ? "Incoming" : "Outgoing"} call${c.status ? ` · ${c.status}` : ""}`,
      detail: mins,
      actor: c.callerName,
      tone: "neutral",
    });
  }

  // Notes.
  for (const n of noteRows) {
    entries.push({
      id: `note:${n.id}`,
      type: "note",
      at: iso(n.createdAt),
      atLabel: fmt(n.createdAt),
      title: "Note added",
      detail: truncate(n.body, 160),
      actor: n.author,
      tone: "neutral",
    });
  }

  // Tasks (created + completed).
  for (const t of taskRows) {
    entries.push({
      id: `task-new:${t.id}`,
      type: "task",
      at: iso(t.createdAt),
      atLabel: fmt(t.createdAt),
      title: `Task: ${t.title}`,
      detail: null,
      actor: t.assignee,
      tone: "neutral",
    });
    if (t.completedAt) {
      entries.push({
        id: `task-done:${t.id}`,
        type: "task",
        at: iso(t.completedAt),
        atLabel: fmt(t.completedAt),
        title: `Task completed: ${t.title}`,
        detail: null,
        actor: t.assignee,
        tone: "positive",
      });
    }
  }

  // Venue-event lifecycle: slot assigned / confirmed / cancelled / V2.
  for (const v of veRows) {
    const roleLabel = ROLE_LABEL[v.role] ?? v.role;
    const dayShort = (v.dayPart && DAY_PART_SHORT[v.dayPart]) || "";
    const where = `${v.cityName}${dayShort ? ` ${dayShort}` : ""}`;
    const camp = { campaignId: v.campaignId, campaignName: v.campaignName };
    entries.push({
      id: `slot:${v.veId}`,
      type: "slot",
      at: iso(v.createdAt),
      atLabel: fmt(v.createdAt),
      title: `Slot assigned — ${roleLabel} · ${where}`,
      tone: "neutral",
      ...camp,
    });
    if (v.confirmedAt) {
      entries.push({
        id: `confirm:${v.veId}`,
        type: "confirmation",
        at: iso(v.confirmedAt),
        atLabel: fmt(v.confirmedAt),
        title: `Confirmed — ${roleLabel} · ${where}`,
        tone: "positive",
        ...camp,
      });
    }
    if (v.cancelledAt) {
      entries.push({
        id: `cancel:${v.veId}`,
        type: "cancellation",
        at: iso(v.cancelledAt),
        atLabel: fmt(v.cancelledAt),
        title: `Cancelled — ${roleLabel} · ${where}`,
        detail: v.cancellationReason,
        tone: "negative",
        ...camp,
      });
    }
    if (v.floorDoneAt) {
      entries.push({
        id: `v2:${v.veId}`,
        type: "v2_call",
        at: iso(v.floorDoneAt),
        atLabel: fmt(v.floorDoneAt),
        title: `Floor-staff briefed — ${where}`,
        detail: v.floorOutcome,
        tone: "positive",
        ...camp,
      });
    } else if (v.floorLastAt) {
      entries.push({
        id: `v2try:${v.veId}`,
        type: "v2_call",
        at: iso(v.floorLastAt),
        atLabel: fmt(v.floorLastAt),
        title: `Floor-staff call attempted — ${where}`,
        detail: v.floorOutcome,
        tone: "neutral",
        ...camp,
      });
    }
  }

  // Relationship flags.
  for (const r of relRows) {
    const tone: ActivityTone =
      r.status === "good" ? "positive" : r.status === "bad" ? "negative" : "neutral";
    entries.push({
      id: `rel:${r.id}`,
      type: "relationship",
      at: iso(r.setAt),
      atLabel: fmt(r.setAt),
      title: `Relationship set "${r.status}" · ${r.brand}`,
      detail: truncate(r.notes, 140),
      actor: r.byName,
      tone,
    });
  }

  // Wristband shipments.
  for (const w of wbRows) {
    const camp = { campaignId: w.campaignId, campaignName: w.campaignName };
    const track = [w.carrier, w.trackingNumber].filter(Boolean).join(" · ") || null;
    if (w.shippedAt) {
      entries.push({
        id: `wb-ship:${w.id}`,
        type: "wristband",
        at: iso(w.shippedAt),
        atLabel: fmt(w.shippedAt),
        title: "Wristbands shipped",
        detail: track,
        tone: "neutral",
        ...camp,
      });
    }
    if (w.deliveredAt) {
      entries.push({
        id: `wb-deliver:${w.id}`,
        type: "wristband",
        at: iso(w.deliveredAt),
        atLabel: fmt(w.deliveredAt),
        title: "Wristbands delivered",
        detail: track,
        tone: "positive",
        ...camp,
      });
    }
  }

  // Manual touches (non-email/call outreach_log).
  for (const t of touchRows) {
    entries.push({
      id: `touch:${t.id}`,
      type: "touch",
      at: iso(t.createdAt),
      atLabel: fmt(t.createdAt),
      title: `${t.channel} · ${t.outcome}`,
      detail: truncate(t.subject, 140),
      actor: t.by,
      tone: "neutral",
    });
  }

  const sorted = sortActivityDesc(entries);

  // Distinct campaigns present (for the filter).
  const seen = new Map<string, string>();
  for (const e of sorted) {
    if (e.campaignId && e.campaignName && !seen.has(e.campaignId)) {
      seen.set(e.campaignId, e.campaignName);
    }
  }
  const campaignList = Array.from(seen.entries()).map(([id, name]) => ({ id, name }));

  return { entries: sorted, campaigns: campaignList };
}
