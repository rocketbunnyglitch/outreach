/**
 * Worklist data loaders (Phase 2).
 *
 * Server-only queries backing the /worklist sections. Section 1 (drafts) lands
 * here in Phase 2.2; replies / follow-ups / calls join in 2.3-2.5.
 */

import "server-only";
import {
  campaigns,
  cities,
  cityCampaigns,
  coldOutreachEntries,
  emailDrafts,
  emailTemplates,
  emailThreads,
  outreachLog,
  venues,
} from "@/db/schema";
import { db } from "@/lib/db";
import { and, asc, desc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { planFromState } from "./cadence-engine-core";

export interface WorklistDraftRow {
  id: string;
  subject: string;
  toAddress: string | null;
  templateCode: string | null;
  templateName: string | null;
  venueName: string | null;
  cityName: string | null;
  scheduledFor: string | null;
  /** scheduled_for is in the past -- this draft is overdue to go out. */
  overdue: boolean;
}

/**
 * Drafts queued for the operator to review + send (Phase 2.2). The engine's
 * cadence-advance cron generates these as replies on due threads; manually
 * started drafts surface here too. Window: unsent, and either unscheduled or
 * scheduled within the next 24h (a draft scheduled further out is not yet
 * today's work).
 *
 * Sort: overdue (scheduled in the past) first, then upcoming-scheduled soonest
 * first, then unscheduled oldest first. NOTE: the spec's "cadence floor closest
 * to violation" tie-breaker is intentionally simplified to scheduled/created
 * time -- per-draft floor computation is expensive and the touch log is empty
 * until campaign sends begin; revisit when there is floor data to sort on.
 */
export async function loadWorklistDrafts(opts: { staffId: string }): Promise<WorklistDraftRow[]> {
  const now = new Date();
  const horizon = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // Resolve the template via the engine pick, falling back to a manually
  // chosen template id.
  const templateJoin = sql`${emailTemplates.id} = coalesce(${emailDrafts.enginePickedTemplateId}, ${emailDrafts.templateId})`;

  const rows = await db
    .select({
      id: emailDrafts.id,
      subject: emailDrafts.subject,
      toAddresses: emailDrafts.toAddresses,
      scheduledFor: emailDrafts.scheduledFor,
      createdAt: emailDrafts.createdAt,
      templateCode: emailTemplates.templateCode,
      templateName: emailTemplates.name,
      venueName: venues.name,
      cityName: cities.name,
    })
    .from(emailDrafts)
    .leftJoin(emailTemplates, templateJoin)
    .leftJoin(venues, eq(venues.id, emailDrafts.venueId))
    .leftJoin(cityCampaigns, eq(cityCampaigns.id, emailDrafts.cityCampaignId))
    .leftJoin(cities, eq(cities.id, cityCampaigns.cityId))
    .where(
      and(
        eq(emailDrafts.ownerUserId, opts.staffId),
        isNull(emailDrafts.sentAt),
        or(isNull(emailDrafts.scheduledFor), lte(emailDrafts.scheduledFor, horizon)),
      ),
    )
    .orderBy(
      sql`CASE
        WHEN ${emailDrafts.scheduledFor} IS NOT NULL AND ${emailDrafts.scheduledFor} <= now() THEN 0
        WHEN ${emailDrafts.scheduledFor} IS NOT NULL THEN 1
        ELSE 2 END`,
      asc(emailDrafts.scheduledFor),
      asc(emailDrafts.createdAt),
    );

  return rows.map((r) => ({
    id: r.id,
    subject: r.subject,
    toAddress: r.toAddresses?.[0] ?? null,
    templateCode: r.templateCode ?? null,
    templateName: r.templateName ?? null,
    venueName: r.venueName ?? null,
    cityName: r.cityName ?? null,
    scheduledFor: r.scheduledFor ? r.scheduledFor.toISOString() : null,
    overdue: r.scheduledFor ? r.scheduledFor.getTime() <= now.getTime() : false,
  }));
}

export interface WorklistReplyRow {
  id: string;
  venueName: string | null;
  cityName: string | null;
  subject: string | null;
  snippet: string | null;
  /** Effective classification (operator-confirmed if set, else the AI
   *  suggestion). Drives the badge + colour. */
  classification: string;
  needsAttention: boolean;
  nextActionLabel: string | null;
  lastMessageAt: string;
}

// Classification -> sort rank for the replies queue. Lower = more urgent.
// cancelled-by-them is a fire drill; engaged leads; soft-no sinks. [2.3]
const REPLY_URGENCY_RANK: Record<string, number> = {
  cancelled_by_them: 0,
  interested: 1,
  warm: 1,
  confirmed: 1,
  stalled_warm: 1,
  question: 2,
  callback_requested: 2,
  decline: 4,
  unsubscribe: 4,
};

function replyUrgencyRank(classification: string): number {
  return REPLY_URGENCY_RANK[classification] ?? 3;
}

/**
 * Inbound replies assigned to the operator that still need action (Phase 2.3):
 * threads in needs_reply / follow_up_due. Sorted needs_attention first, then by
 * classification urgency (engaged > question > soft-no), then most-recent first.
 * The effective classification prefers the operator-confirmed value, falling
 * back to the AI suggestion so a freshly-classified thread still sorts + colours
 * sensibly before anyone confirms it.
 */
export async function loadWorklistReplies(opts: { staffId: string }): Promise<WorklistReplyRow[]> {
  const rows = await db
    .select({
      id: emailThreads.id,
      venueName: venues.name,
      cityName: cities.name,
      subject: emailThreads.subject,
      snippet: emailThreads.snippet,
      classification: emailThreads.classification,
      suggestedClassification: emailThreads.suggestedClassification,
      needsAttention: emailThreads.needsAttention,
      aiNextAction: emailThreads.aiNextAction,
      lastMessageAt: emailThreads.lastMessageAt,
    })
    .from(emailThreads)
    .leftJoin(venues, eq(venues.id, emailThreads.venueId))
    .leftJoin(cities, eq(cities.id, venues.cityId))
    .where(
      and(
        eq(emailThreads.assignedStaffId, opts.staffId),
        inArray(emailThreads.state, ["needs_reply", "follow_up_due"]),
        isNull(emailThreads.deletedAt),
      ),
    )
    .orderBy(desc(emailThreads.lastMessageAt));

  const mapped: WorklistReplyRow[] = rows.map((r) => {
    const confirmed =
      r.classification && r.classification !== "unclassified" ? r.classification : null;
    const classification = confirmed ?? r.suggestedClassification ?? "unclassified";
    const nextAction = r.aiNextAction as { label?: string } | null;
    return {
      id: r.id,
      venueName: r.venueName ?? null,
      cityName: r.cityName ?? null,
      subject: r.subject ?? null,
      snippet: r.snippet ?? null,
      classification,
      needsAttention: r.needsAttention,
      nextActionLabel: typeof nextAction?.label === "string" ? nextAction.label : null,
      lastMessageAt: r.lastMessageAt.toISOString(),
    };
  });

  // Final ordering: needs_attention first, then classification urgency, then
  // recency. Done in JS so the urgency map stays readable + testable.
  mapped.sort(
    (a, b) =>
      Number(b.needsAttention) - Number(a.needsAttention) ||
      replyUrgencyRank(a.classification) - replyUrgencyRank(b.classification) ||
      new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
  );

  return mapped;
}

export interface WorklistFollowUpRow {
  /** cadence = a due cadence touch on a thread (action: Draft now). */
  /** scheduled_draft = an already-built draft scheduled to go out (action: Review). */
  kind: "cadence" | "scheduled_draft";
  /** thread id (cadence) or draft id (scheduled_draft). */
  id: string;
  dueAt: string;
  /** Today / Tomorrow / weekday, in the campaign timezone. */
  dayLabel: string;
  touchLabel: string;
  venueName: string | null;
  cityName: string | null;
  daysSinceLastTouch: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DISPLAY_TZ = "America/Toronto";

function dayLabelFor(due: Date, now: Date): string {
  const ymd = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: DISPLAY_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  const dueKey = ymd(due);
  if (dueKey === ymd(now)) return "Today";
  if (dueKey === ymd(new Date(now.getTime() + DAY_MS))) return "Tomorrow";
  return new Intl.DateTimeFormat("en-US", { timeZone: DISPLAY_TZ, weekday: "long" }).format(due);
}

function humanizeTouchKind(touchKind: string): string {
  return touchKind.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Upcoming work for the operator's owned venues over the next 7 days (Phase
 * 2.4): cadence touches that come due (from the thread's cadence_state +
 * cadence_next_due_at) plus scheduled drafts (the lifecycle T11/T13/... touches
 * land here once the lifecycle scheduler runs in Phase 3.x). Returned flat,
 * sorted by due time; the section groups by dayLabel.
 */
export async function loadWorklistFollowUps(opts: {
  staffId: string;
}): Promise<WorklistFollowUpRow[]> {
  const now = new Date();
  const horizon = new Date(now.getTime() + 7 * DAY_MS);

  const cadenceRows = await db
    .select({
      id: emailThreads.id,
      cadenceState: emailThreads.cadenceState,
      cadenceNextDueAt: emailThreads.cadenceNextDueAt,
      lastOutboundAt: emailThreads.lastOutboundAt,
      venueName: venues.name,
      cityName: cities.name,
    })
    .from(emailThreads)
    .leftJoin(venues, eq(venues.id, emailThreads.venueId))
    .leftJoin(cities, eq(cities.id, venues.cityId))
    .where(
      and(
        eq(emailThreads.assignedStaffId, opts.staffId),
        gt(emailThreads.cadenceNextDueAt, now),
        lte(emailThreads.cadenceNextDueAt, horizon),
        isNull(emailThreads.deletedAt),
      ),
    );

  const templateJoin = sql`${emailTemplates.id} = coalesce(${emailDrafts.enginePickedTemplateId}, ${emailDrafts.templateId})`;
  const draftRows = await db
    .select({
      id: emailDrafts.id,
      scheduledFor: emailDrafts.scheduledFor,
      templateCode: emailTemplates.templateCode,
      venueName: venues.name,
      cityName: cities.name,
    })
    .from(emailDrafts)
    .leftJoin(emailTemplates, templateJoin)
    .leftJoin(venues, eq(venues.id, emailDrafts.venueId))
    .leftJoin(cityCampaigns, eq(cityCampaigns.id, emailDrafts.cityCampaignId))
    .leftJoin(cities, eq(cities.id, cityCampaigns.cityId))
    .where(
      and(
        eq(emailDrafts.ownerUserId, opts.staffId),
        isNull(emailDrafts.sentAt),
        gt(emailDrafts.scheduledFor, now),
        lte(emailDrafts.scheduledFor, horizon),
      ),
    );

  const rows: WorklistFollowUpRow[] = [];

  for (const r of cadenceRows) {
    if (!r.cadenceNextDueAt) continue;
    const plan = r.cadenceState ? planFromState(r.cadenceState, r.lastOutboundAt ?? now) : null;
    rows.push({
      kind: "cadence",
      id: r.id,
      dueAt: r.cadenceNextDueAt.toISOString(),
      dayLabel: dayLabelFor(r.cadenceNextDueAt, now),
      touchLabel: plan ? humanizeTouchKind(plan.touchKind) : "Follow-up",
      venueName: r.venueName ?? null,
      cityName: r.cityName ?? null,
      daysSinceLastTouch: r.lastOutboundAt
        ? Math.floor((now.getTime() - r.lastOutboundAt.getTime()) / DAY_MS)
        : null,
    });
  }

  for (const r of draftRows) {
    if (!r.scheduledFor) continue;
    rows.push({
      kind: "scheduled_draft",
      id: r.id,
      dueAt: r.scheduledFor.toISOString(),
      dayLabel: dayLabelFor(r.scheduledFor, now),
      touchLabel: r.templateCode ?? "Scheduled draft",
      venueName: r.venueName ?? null,
      cityName: r.cityName ?? null,
      daysSinceLastTouch: null,
    });
  }

  rows.sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
  return rows;
}

export interface WorklistCallRow {
  coldEntryId: string;
  venueId: string;
  venueName: string;
  cityName: string | null;
  cityCampaignId: string;
  outreachBrandId: string | null;
  priority: number;
  phoneE164: string | null;
  venueHours: string | null;
  venueTimezone: string | null;
  summary: string;
}

const CALL_CAP = 8;

function callSummary(status: string, isWarm: boolean, lastTouchAt: Date | null, now: Date): string {
  const days = lastTouchAt ? Math.floor((now.getTime() - lastTouchAt.getTime()) / DAY_MS) : null;
  if (status === "follow_up_due") return "Follow-up due";
  if (isWarm) return days !== null ? `Warm, quiet for ${days}d` : "Warm lead";
  if (status === "email_sent")
    return days !== null ? `Emailed, no reply for ${days}d` : "Emailed, no reply";
  return "Due for a call";
}

/**
 * High-priority calls for the operator today (Phase 2.5). Cold entries the
 * operator owns, in priority 1-3 cities, that are due for a call (emailed but
 * silent 5+ days, a warm lead gone quiet, or follow_up_due) and have NOT been
 * called in the last 2 days. Capped at 8 (more than an operator can realistically
 * make), ranked by city priority then stalest-first.
 *
 * "Last call attempt" reads outreach_log channel='call' (where click-to-call
 * logs every attempt). Phone dialling reuses QuoDialControls.
 */
export async function loadWorklistCalls(opts: { staffId: string }): Promise<WorklistCallRow[]> {
  const now = new Date();
  const fiveDaysAgo = new Date(now.getTime() - 5 * DAY_MS);
  const twoDaysAgo = new Date(now.getTime() - 2 * DAY_MS);

  const candidates = await db
    .select({
      coldEntryId: coldOutreachEntries.id,
      venueId: coldOutreachEntries.venueId,
      cityCampaignId: coldOutreachEntries.cityCampaignId,
      status: coldOutreachEntries.status,
      isWarm: coldOutreachEntries.isWarm,
      lastTouchAt: coldOutreachEntries.lastTouchAt,
      priority: cityCampaigns.priority,
      outreachBrandId: campaigns.outreachBrandId,
      venueName: venues.name,
      phoneE164: venues.phoneE164,
      venueHours: venues.hours,
      cityName: cities.name,
      cityTimezone: cities.timezone,
    })
    .from(coldOutreachEntries)
    .innerJoin(cityCampaigns, eq(cityCampaigns.id, coldOutreachEntries.cityCampaignId))
    .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
    .innerJoin(venues, eq(venues.id, coldOutreachEntries.venueId))
    .leftJoin(cities, eq(cities.id, venues.cityId))
    .where(
      and(
        eq(coldOutreachEntries.assignedStaffId, opts.staffId),
        lte(cityCampaigns.priority, 3),
        or(
          and(
            eq(coldOutreachEntries.status, "email_sent"),
            lte(coldOutreachEntries.lastTouchAt, fiveDaysAgo),
          ),
          and(
            eq(coldOutreachEntries.isWarm, true),
            lte(coldOutreachEntries.lastTouchAt, fiveDaysAgo),
          ),
          eq(coldOutreachEntries.status, "follow_up_due"),
        ),
      ),
    )
    .orderBy(asc(cityCampaigns.priority), asc(coldOutreachEntries.lastTouchAt))
    .limit(40);

  if (candidates.length === 0) return [];

  // Last call attempt per venue, from the click-to-call log.
  const venueIds = [...new Set(candidates.map((c) => c.venueId))];
  const lastCalls = await db
    .select({
      venueId: outreachLog.venueId,
      lastCallAt: sql<string | null>`max(${outreachLog.createdAt})`,
    })
    .from(outreachLog)
    .where(and(inArray(outreachLog.venueId, venueIds), eq(outreachLog.channel, "call")))
    .groupBy(outreachLog.venueId);
  const lastCallByVenue = new Map(
    lastCalls.map((r) => [r.venueId, r.lastCallAt ? new Date(r.lastCallAt) : null]),
  );

  const rows: WorklistCallRow[] = [];
  for (const c of candidates) {
    const lastCallAt = lastCallByVenue.get(c.venueId) ?? null;
    // Skip venues called within the last 2 days.
    if (lastCallAt && lastCallAt.getTime() > twoDaysAgo.getTime()) continue;
    rows.push({
      coldEntryId: c.coldEntryId,
      venueId: c.venueId,
      venueName: c.venueName,
      cityName: c.cityName ?? null,
      cityCampaignId: c.cityCampaignId,
      outreachBrandId: c.outreachBrandId ?? null,
      priority: c.priority,
      phoneE164: c.phoneE164 ?? null,
      venueHours: c.venueHours ?? null,
      venueTimezone: c.cityTimezone ?? null,
      summary: callSummary(c.status, c.isWarm, c.lastTouchAt, now),
    });
    if (rows.length >= CALL_CAP) break;
  }
  return rows;
}
