/**
 * Worklist data loaders (Phase 2).
 *
 * Server-only queries backing the /worklist sections. Section 1 (drafts) lands
 * here in Phase 2.2; replies / follow-ups / calls join in 2.3-2.5.
 */

import "server-only";
import {
  cities,
  cityCampaigns,
  emailDrafts,
  emailTemplates,
  emailThreads,
  venues,
} from "@/db/schema";
import { db } from "@/lib/db";
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

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
