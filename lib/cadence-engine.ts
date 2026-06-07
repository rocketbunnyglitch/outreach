/**
 * Cadence engine (Phase 1.8) -- replaces lib/follow-up-cadence.ts with the
 * reference-doc Section 6 rules. Server-only DB wrapper around the pure timing
 * + floor core (lib/cadence-engine-core.ts):
 *
 *   - planNextTouch:      what touch is due next for a venue x campaign, when,
 *                         which template + alias.
 *   - checkCadenceFloors: may a send go out now (hard cap + cross-domain floor).
 *   - recordTouch:        log an outbound touch + advance the thread state.
 *
 * Cadence rules and their citations live in cadence-engine-core.ts. Phone calls
 * never enter venue_campaign_touch_log, so they never count against the floor
 * or the hard cap. [ReferenceDoc 6.6 + 6.7]
 */

import "server-only";
import { type CadenceState, cityCampaigns, emailThreads, venueCampaignTouchLog } from "@/db/schema";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { type PickContext, pickTemplate } from "@/lib/template-picker";
import { and, count, desc, eq, max, ne, or } from "drizzle-orm";
import {
  DEFAULT_HARD_CAP,
  type FloorCheckCoreResult,
  checkFloors,
  planFromState,
  terminalStateFor,
} from "./cadence-engine-core";

export interface NextTouchPlan {
  venueId: string;
  campaignId: string;
  recommendedTemplateCode: string;
  recommendedAliasId: string;
  earliestAllowedSendAt: Date;
  reasonIfBlocked?: string;
  cadenceState: CadenceState;
}

export interface CadenceFloorCheckArgs {
  venueId: string;
  campaignId: string;
  sendingAliasId: string;
  sendingOutreachBrandId: string;
}

export interface CadenceFloorCheckResult {
  allowed: boolean;
  reason?: string;
  earliestAllowedAt?: Date;
  totalTouchCount: number;
  hardCapReached: boolean;
  crossDomainFloorMet: boolean;
}

// cadence_state values that have no pending automated touch (terminal /
// off-cadence), so planNextTouch skips threads resting in them.
const NON_ACTIONABLE_STATES: CadenceState[] = [
  "cold_exhausted_ready_for_handoff",
  "stalled_warm",
  "declined_this_campaign",
  "opt_out_permanent",
  "cancelled_by_them",
  "confirmed",
  "lifecycle_active",
];

/** Map an outbound touchKind to the cadence_state once it has been sent. */
function sentStateForTouchKind(touchKind: string): CadenceState | null {
  switch (touchKind) {
    case "cold_touch_1":
      return "cold_sent_touch_1";
    case "cold_touch_2":
      return "cold_sent_touch_2";
    case "cold_touch_3":
      return "cold_sent_touch_3";
    case "warm_nudge_1":
      return "warm_nudge_1_sent";
    case "warm_nudge_2":
      return "warm_nudge_2_sent";
    case "warm_nudge_3":
      return "warm_nudge_3_sent";
    default:
      return null;
  }
}

/**
 * The hard cap for a campaign. No per-campaign column exists yet, so this is
 * the reference-doc default of 6 [ReferenceDoc 6.3]; threading a configurable
 * value through is a later concern (the core already takes hardCap as input).
 */
function hardCapForCampaign(_campaignId: string): number {
  return DEFAULT_HARD_CAP;
}

/** Resolve the active cadence thread for a venue x campaign, if one exists. */
async function findCadenceThread(venueId: string, campaignId: string) {
  const rows = await db
    .select({
      id: emailThreads.id,
      cadenceState: emailThreads.cadenceState,
      staffOutreachEmailId: emailThreads.staffOutreachEmailId,
      outreachBrandId: emailThreads.outreachBrandId,
    })
    .from(emailThreads)
    .innerJoin(cityCampaigns, eq(cityCampaigns.id, emailThreads.cityCampaignId))
    .where(and(eq(emailThreads.venueId, venueId), eq(cityCampaigns.campaignId, campaignId)))
    .orderBy(desc(emailThreads.lastMessageAt))
    .limit(1);
  return rows[0] ?? null;
}

/** Most recent touch time for a venue x campaign, across all aliases. */
async function lastTouchAt(venueId: string, campaignId: string): Promise<Date | null> {
  const [row] = await db
    .select({ maxAt: max(venueCampaignTouchLog.sentAt) })
    .from(venueCampaignTouchLog)
    .where(
      and(
        eq(venueCampaignTouchLog.venueId, venueId),
        eq(venueCampaignTouchLog.campaignId, campaignId),
      ),
    );
  return row?.maxAt ?? null;
}

/**
 * Plan the next touch for a venue x campaign: the due time from the cadence
 * sequence, the recommended template (via the auto-picker), and the alias to
 * send from. Returns null when there is no cadence thread or the thread is in a
 * non-actionable state. Sets reasonIfBlocked when the floors block the send.
 * [ReferenceDoc 6.1 + 6.4]
 */
export async function planNextTouch(
  venueId: string,
  campaignId: string,
): Promise<NextTouchPlan | null> {
  const thread = await findCadenceThread(venueId, campaignId);
  if (!thread || !thread.cadenceState) return null;
  if (NON_ACTIONABLE_STATES.includes(thread.cadenceState)) return null;

  const last = (await lastTouchAt(venueId, campaignId)) ?? new Date();
  const plan = planFromState(thread.cadenceState, last);
  if (!plan) return null;

  // Recommend a template via the auto-picker. A first-touch maps to a big open
  // ask (opener); follow-ups fall through to the detail/follow-up templates.
  // [ReferenceDoc 7] engine picks, operator overrides.
  const ctx: PickContext = { campaignId, venueId };
  if (plan.stageHint === "first_touch") ctx.askSize = "big_open";
  let recommendedTemplateCode = plan.touchKind === "cold_touch_1" ? "T1" : "T4";
  try {
    const picked = await pickTemplate(ctx);
    if (picked) recommendedTemplateCode = picked.template.templateCode;
  } catch (err) {
    logger.error({ err, venueId, campaignId }, "planNextTouch pickTemplate failed");
  }

  // Apply the floors: the touch cannot go out before the sequence time or the
  // cross-domain floor, whichever is later.
  const floors = await checkCadenceFloors({
    venueId,
    campaignId,
    sendingAliasId: thread.staffOutreachEmailId,
    sendingOutreachBrandId: thread.outreachBrandId ?? "",
  });
  let earliestAllowedSendAt = plan.earliestAllowedSendAt;
  if (floors.earliestAllowedAt && floors.earliestAllowedAt > earliestAllowedSendAt) {
    earliestAllowedSendAt = floors.earliestAllowedAt;
  }

  return {
    venueId,
    campaignId,
    recommendedTemplateCode,
    recommendedAliasId: thread.staffOutreachEmailId,
    earliestAllowedSendAt,
    reasonIfBlocked: floors.allowed ? undefined : floors.reason,
    cadenceState: thread.cadenceState,
  };
}

/**
 * Check whether an outbound touch may go out now: the hard cap [6.3] and the
 * cross-domain 7-day floor [6.2]. The floor looks at the most recent touch from
 * a DIFFERENT alias or brand than the one sending. Calls are never logged, so
 * they never count here. [ReferenceDoc 6.7]
 */
export async function checkCadenceFloors(
  args: CadenceFloorCheckArgs,
): Promise<CadenceFloorCheckResult> {
  const [counted] = await db
    .select({ n: count() })
    .from(venueCampaignTouchLog)
    .where(
      and(
        eq(venueCampaignTouchLog.venueId, args.venueId),
        eq(venueCampaignTouchLog.campaignId, args.campaignId),
      ),
    );
  const totalTouchCount = counted?.n ?? 0;

  const [crossDomain] = await db
    .select({ maxAt: max(venueCampaignTouchLog.sentAt) })
    .from(venueCampaignTouchLog)
    .where(
      and(
        eq(venueCampaignTouchLog.venueId, args.venueId),
        eq(venueCampaignTouchLog.campaignId, args.campaignId),
        or(
          ne(venueCampaignTouchLog.staffOutreachEmailId, args.sendingAliasId),
          ne(venueCampaignTouchLog.outreachBrandId, args.sendingOutreachBrandId),
        ),
      ),
    );

  const result: FloorCheckCoreResult = checkFloors({
    totalTouchCount,
    hardCap: hardCapForCampaign(args.campaignId),
    mostRecentCrossDomainTouchAt: crossDomain?.maxAt ?? null,
    now: new Date(),
  });
  return result;
}

/**
 * Record an outbound touch: append a venue_campaign_touch_log row and advance
 * the thread's cadence_state + next-due. A touch that exhausts the sequence
 * rests the thread in the handoff / stalled-warm state. [ReferenceDoc 6.1-6.4]
 */
export async function recordTouch(args: {
  venueId: string;
  campaignId: string;
  sendingAliasId: string;
  sendingOutreachBrandId: string;
  touchKind: string;
  emailMessageId?: string;
  /** The thread the touch was ACTUALLY sent on. When provided, advance THIS
   *  thread's cadence_state -- not the most-recent thread for the venue, which
   *  corrupts state on venues with more than one thread (e.g. after a handoff). */
  threadId?: string;
}): Promise<void> {
  const sentAt = new Date();
  await db.insert(venueCampaignTouchLog).values({
    venueId: args.venueId,
    campaignId: args.campaignId,
    staffOutreachEmailId: args.sendingAliasId,
    outreachBrandId: args.sendingOutreachBrandId,
    touchKind: args.touchKind,
    sentAt,
    emailMessageId: args.emailMessageId ?? null,
  });

  const sentState = sentStateForTouchKind(args.touchKind);
  if (!sentState) return;

  // Advance the thread the send actually went out on when known; only fall back
  // to the most-recent thread for the venue when the caller didn't supply one.
  const threadId =
    args.threadId ?? (await findCadenceThread(args.venueId, args.campaignId))?.id ?? null;
  if (!threadId) return;

  // After this touch, the next plan tells us when the following touch is due;
  // if the sequence is exhausted, rest in the terminal state with no due time.
  const nextPlan = planFromState(sentState, sentAt);
  let newState: CadenceState = sentState;
  let nextDueAt: Date | null = nextPlan?.earliestAllowedSendAt ?? null;
  if (!nextPlan) {
    newState = terminalStateFor(sentState) ?? sentState;
    nextDueAt = null;
  }

  await db
    .update(emailThreads)
    .set({ cadenceState: newState, cadenceNextDueAt: nextDueAt })
    .where(eq(emailThreads.id, threadId));
}
