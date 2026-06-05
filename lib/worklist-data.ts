/**
 * Worklist data loaders (Phase 2).
 *
 * Server-only queries backing the /worklist sections. Section 1 (drafts) lands
 * here in Phase 2.2; replies / follow-ups / calls join in 2.3-2.5.
 */

import "server-only";
import {
  events,
  campaigns,
  cities,
  cityCampaigns,
  coldOutreachEntries,
  emailDrafts,
  emailTemplates,
  emailThreads,
  outreachBrands,
  outreachLog,
  venueEvents,
  venues,
} from "@/db/schema";
import { db } from "@/lib/db";
import { and, asc, desc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { planFromState } from "./cadence-engine-core";
import { computeEffectivePriority } from "./effective-priority";

/**
 * Effective priority per city campaign (Phase 2.15). Sums ticket sales and
 * finds the earliest upcoming event date so the sales pivot can blend static
 * priority with real demand. Returns a map keyed by cityCampaignId.
 * [ReferenceDoc 1.6]
 */
async function loadEffectivePriorityByCityCampaign(
  cityCampaignIds: string[],
  staticByCc: Map<string, number>,
  now: Date,
): Promise<Map<string, { effective: number; static: number; reason: string }>> {
  const out = new Map<string, { effective: number; static: number; reason: string }>();
  if (cityCampaignIds.length === 0) return out;
  const agg = await db
    .select({
      cityCampaignId: events.cityCampaignId,
      ticketsSold: sql<number>`COALESCE(SUM(${events.ticketSalesCount}), 0)::int`,
      earliestEvent: sql<
        string | null
      >`MIN(${events.eventDate}) FILTER (WHERE ${events.eventDate} >= ${now}::date)`,
    })
    .from(events)
    .where(inArray(events.cityCampaignId, cityCampaignIds))
    .groupBy(events.cityCampaignId);
  const aggByCc = new Map(agg.map((a) => [a.cityCampaignId, a]));
  for (const ccId of cityCampaignIds) {
    const staticPriority = staticByCc.get(ccId) ?? 5;
    const a = aggByCc.get(ccId);
    // No upcoming event -> pivot inactive (effective == static).
    const daysToEvent = a?.earliestEvent
      ? Math.floor((new Date(a.earliestEvent).getTime() - now.getTime()) / DAY_MS)
      : Number.POSITIVE_INFINITY;
    const r = computeEffectivePriority({
      staticPriority,
      ticketsSold: a?.ticketsSold ?? 0,
      daysToEvent,
    });
    out.set(ccId, { effective: r.effective, static: staticPriority, reason: r.reason });
  }
  return out;
}

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
        // Assigned to the operator OR in a city campaign they lead. Threads
        // mostly aren't individually assigned (work is owned at the city
        // level), so a city lead sees their cities' replies via the thread's
        // campaign or the venue's city. [worklist by city leadership]
        or(
          eq(emailThreads.assignedStaffId, opts.staffId),
          sql`EXISTS (
            SELECT 1 FROM city_campaigns cc
            WHERE cc.lead_staff_id = ${opts.staffId}
              AND (cc.id = ${emailThreads.cityCampaignId} OR cc.city_id = ${venues.cityId})
          )`,
        ),
        inArray(emailThreads.state, ["needs_reply", "follow_up_due"]),
        isNull(emailThreads.deletedAt),
      ),
    )
    .orderBy(desc(emailThreads.lastMessageAt))
    .limit(60);

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
        // Assigned to the operator OR in a city campaign they lead.
        or(
          eq(emailThreads.assignedStaffId, opts.staffId),
          sql`EXISTS (
            SELECT 1 FROM city_campaigns cc
            WHERE cc.lead_staff_id = ${opts.staffId}
              AND (cc.id = ${emailThreads.cityCampaignId} OR cc.city_id = ${venues.cityId})
          )`,
        ),
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
  /** Static city priority (1 = highest). */
  priority: number;
  /** Sales-blended priority (Phase 2.15); equals `priority` outside the window. */
  effectivePriority: number;
  /** Why effective differs from static, for the badge tooltip. */
  effectiveReason: string;
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
        // The operator owns the entry directly OR leads its city campaign.
        // Work is assigned at the city level (city_campaigns.lead_staff_id),
        // so a city lead sees every due call in their cities even when the
        // individual entries were never personally assigned.
        or(
          eq(coldOutreachEntries.assignedStaffId, opts.staffId),
          eq(cityCampaigns.leadStaffId, opts.staffId),
        ),
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

  // Effective priority per city campaign (Phase 2.15) -- inside the 21-day
  // window the call queue follows sales velocity, not static priority, so a
  // converting lower-priority city outranks a higher-priority city that's quiet.
  const staticByCc = new Map(candidates.map((c) => [c.cityCampaignId, c.priority]));
  const effByCc = await loadEffectivePriorityByCityCampaign(
    [...staticByCc.keys()],
    staticByCc,
    now,
  );
  const effOf = (ccId: string) => effByCc.get(ccId)?.effective ?? 5;

  // Re-rank by effective priority (then stalest-first) BEFORE the cap so the
  // top 8 reflect the sales pivot, not the DB's static-priority order.
  const ranked = [...candidates].sort((a, b) => {
    const ep = effOf(a.cityCampaignId) - effOf(b.cityCampaignId);
    if (ep !== 0) return ep;
    const at = a.lastTouchAt ? a.lastTouchAt.getTime() : 0;
    const bt = b.lastTouchAt ? b.lastTouchAt.getTime() : 0;
    return at - bt;
  });

  const rows: WorklistCallRow[] = [];
  for (const c of ranked) {
    const lastCallAt = lastCallByVenue.get(c.venueId) ?? null;
    // Skip venues called within the last 2 days.
    if (lastCallAt && lastCallAt.getTime() > twoDaysAgo.getTime()) continue;
    const eff = effByCc.get(c.cityCampaignId);
    rows.push({
      coldEntryId: c.coldEntryId,
      venueId: c.venueId,
      venueName: c.venueName,
      cityName: c.cityName ?? null,
      cityCampaignId: c.cityCampaignId,
      outreachBrandId: c.outreachBrandId ?? null,
      priority: c.priority,
      effectivePriority: eff?.effective ?? c.priority,
      effectiveReason: eff?.reason ?? "",
      phoneE164: c.phoneE164 ?? null,
      venueHours: c.venueHours ?? null,
      venueTimezone: c.cityTimezone ?? null,
      summary: callSummary(c.status, c.isWarm, c.lastTouchAt, now),
    });
    if (rows.length >= CALL_CAP) break;
  }
  return rows;
}

// =========================================================================
// Post-event relationship-flag prompts (Phase 3.12). After an event runs, the
// operator who led the city is prompted to flag how the venue x brand
// relationship went (good / neutral / bad), feeding future re-engagement.
// Query-based (no task rows): a venue shows until a post_event_flag relationship
// is recorded for it, within a 14-day post-event window.
// =========================================================================

export interface WorklistRelationshipFlagRow {
  venueId: string;
  venueName: string;
  cityName: string | null;
  brandId: string;
  brandName: string;
  eventDate: string;
}

export async function loadWorklistRelationshipFlags(opts: {
  staffId: string;
}): Promise<WorklistRelationshipFlagRow[]> {
  const rows = await db
    .select({
      venueId: venues.id,
      venueName: venues.name,
      cityName: cities.name,
      brandId: outreachBrands.id,
      brandName: outreachBrands.displayName,
      eventDate: events.eventDate,
    })
    .from(venueEvents)
    .innerJoin(events, eq(events.id, venueEvents.eventId))
    .innerJoin(cityCampaigns, eq(cityCampaigns.id, events.cityCampaignId))
    .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
    .innerJoin(outreachBrands, eq(outreachBrands.id, campaigns.outreachBrandId))
    .innerJoin(venues, eq(venues.id, venueEvents.venueId))
    .leftJoin(cities, eq(cities.id, venues.cityId))
    .where(
      and(
        eq(venueEvents.status, "confirmed"),
        eq(cityCampaigns.leadStaffId, opts.staffId),
        sql`${events.eventDate} < now()::date`,
        sql`${events.eventDate} >= (now() - interval '14 days')::date`,
        sql`NOT EXISTS (
          SELECT 1 FROM venue_domain_relationships vdr
          WHERE vdr.venue_id = ${venues.id}
            AND vdr.outreach_brand_id = ${campaigns.outreachBrandId}
            AND vdr.set_by = 'post_event_flag'
        )`,
      ),
    )
    .orderBy(desc(events.eventDate));

  // Dedupe by venue x brand (a multi-night venue has several venue_events).
  const seen = new Set<string>();
  const out: WorklistRelationshipFlagRow[] = [];
  for (const r of rows) {
    const key = `${r.venueId}:${r.brandId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      venueId: r.venueId,
      venueName: r.venueName,
      cityName: r.cityName ?? null,
      brandId: r.brandId,
      brandName: r.brandName,
      eventDate: r.eventDate,
    });
  }
  return out;
}

// =========================================================================
// Comebacks (Phase 4.8). A venue that cancelled but then replied again (after
// the cancellation) may want back in. Surface it so the lead can re-confirm if
// the slot is still open. Detected as: a cancelled venue_event in a led city
// whose venue has an inbound reply AFTER cancelled_at.
// =========================================================================

export interface WorklistComebackRow {
  venueEventId: string;
  venueId: string;
  venueName: string;
  cityName: string | null;
  cancelledAt: string | null;
  threadId: string;
}

export async function loadWorklistComebacks(opts: {
  staffId: string;
}): Promise<WorklistComebackRow[]> {
  const rows = await db
    .select({
      venueEventId: venueEvents.id,
      venueId: venues.id,
      venueName: venues.name,
      cityName: cities.name,
      cancelledAt: venueEvents.cancelledAt,
      threadId: emailThreads.id,
      lastInboundAt: emailThreads.lastInboundAt,
    })
    .from(venueEvents)
    .innerJoin(events, eq(events.id, venueEvents.eventId))
    .innerJoin(cityCampaigns, eq(cityCampaigns.id, events.cityCampaignId))
    .innerJoin(venues, eq(venues.id, venueEvents.venueId))
    .leftJoin(cities, eq(cities.id, venues.cityId))
    .innerJoin(emailThreads, eq(emailThreads.venueId, venues.id))
    .where(
      and(
        eq(venueEvents.status, "cancelled"),
        eq(cityCampaigns.leadStaffId, opts.staffId),
        sql`${venueEvents.cancelledAt} IS NOT NULL`,
        sql`${emailThreads.lastInboundAt} > ${venueEvents.cancelledAt}`,
      ),
    )
    .orderBy(desc(emailThreads.lastInboundAt));

  const seen = new Set<string>();
  const out: WorklistComebackRow[] = [];
  for (const r of rows) {
    if (seen.has(r.venueEventId)) continue;
    seen.add(r.venueEventId);
    out.push({
      venueEventId: r.venueEventId,
      venueId: r.venueId,
      venueName: r.venueName,
      cityName: r.cityName ?? null,
      cancelledAt: r.cancelledAt ? r.cancelledAt.toISOString() : null,
      threadId: r.threadId,
    });
  }
  return out;
}

// =========================================================================
// Today's completion stats (Phase 2.6) -- powers the worklist's "all caught
// up" empty state. Three real, operator-attributable counters for the current
// day. "Today" is bounded in America/Toronto entirely in SQL so the day rolls
// over at local midnight regardless of the server's UTC clock.
// =========================================================================

export interface WorklistTodayStats {
  /** New/cold outbound sent by the operator today (sends on threads with no inbound). */
  draftsSent: number;
  /** Replies sent by the operator today (sends on threads that had an inbound). */
  repliesHandled: number;
  /** Calls the operator logged today (outreach_log channel='call'). */
  callsCompleted: number;
}

export async function loadWorklistTodayStats(opts: {
  staffId: string;
}): Promise<WorklistTodayStats> {
  const { staffId } = opts;

  // Sends split into cold (no prior inbound) vs replies (thread had inbound).
  // last_inbound_at is the persisted "we've heard from them" marker on the
  // thread; a send on such a thread is treated as a reply handled.
  const sends = await db.execute<{ drafts_sent: number; replies_handled: number }>(sql`
    SELECT
      COUNT(*) FILTER (WHERE t.last_inbound_at IS NULL)::int AS drafts_sent,
      COUNT(*) FILTER (WHERE t.last_inbound_at IS NOT NULL)::int AS replies_handled
    FROM email_send_events e
    LEFT JOIN email_threads t ON t.id = e.thread_id
    WHERE e.sent_by_user_id = ${staffId}
      AND (e.sent_at AT TIME ZONE 'America/Toronto')
          >= date_trunc('day', now() AT TIME ZONE 'America/Toronto')
  `);

  const calls = await db.execute<{ calls_completed: number }>(sql`
    SELECT COUNT(*)::int AS calls_completed
    FROM outreach_log
    WHERE channel = 'call'
      AND staff_member_id = ${staffId}
      AND (created_at AT TIME ZONE 'America/Toronto')
          >= date_trunc('day', now() AT TIME ZONE 'America/Toronto')
  `);

  const sendsRow = (Array.isArray(sends) ? sends[0] : sends.rows?.[0]) ?? {
    drafts_sent: 0,
    replies_handled: 0,
  };
  const callsRow = (Array.isArray(calls) ? calls[0] : calls.rows?.[0]) ?? {
    calls_completed: 0,
  };

  return {
    draftsSent: Number(sendsRow.drafts_sent ?? 0),
    repliesHandled: Number(sendsRow.replies_handled ?? 0),
    callsCompleted: Number(callsRow.calls_completed ?? 0),
  };
}
