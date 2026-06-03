/**
 * Pure scoring/timing core for the cadence engine (Phase 1.8).
 *
 * No server-only / DB imports, so it is unit-testable. lib/cadence-engine.ts
 * wraps this with the DB reads/writes. Encodes the cadence rules from the
 * Halloween 2026 reference doc:
 *
 *   [ReferenceDoc 6.1] Cold sequence: touch 1 day 0, touch 2 +5, touch 3 +7.
 *   [ReferenceDoc 6.4] Warm nudges: +4 / +5 / +7 from the prior touch.
 *   [ReferenceDoc 6.2] Cross-domain 7-day anti-spam floor (applies whenever a
 *                      different alias/brand sent the previous touch).
 *   [ReferenceDoc 6.3] Hard cap: 5-6 total touches per venue x campaign
 *                      (default 6), across all domains/aliases/staff combined.
 */

import type { CadenceState } from "@/db/schema/enums";

// [ReferenceDoc 6.1] cold-sequence offsets from the previous touch.
export const COLD_TOUCH_2_OFFSET_DAYS = 5;
export const COLD_TOUCH_3_OFFSET_DAYS = 7;
// [ReferenceDoc 6.4] warm-nudge offsets from the previous touch.
export const WARM_NUDGE_1_OFFSET_DAYS = 4;
export const WARM_NUDGE_2_OFFSET_DAYS = 5;
export const WARM_NUDGE_3_OFFSET_DAYS = 7;
// [ReferenceDoc 6.2] cross-domain anti-spam floor.
export const CROSS_DOMAIN_FLOOR_DAYS = 7;
// [ReferenceDoc 6.3] hard cap of total touches per venue x campaign.
export const DEFAULT_HARD_CAP = 6;

const DAY_MS = 86_400_000;

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

export interface CadencePlanCore {
  /** Touch about to be sent, e.g. "cold_touch_2" / "warm_nudge_1". */
  touchKind: string;
  /** Earliest the touch may go out (prior touch + the sequence offset). */
  earliestAllowedSendAt: Date;
  /** cadence_state to set AFTER this touch is sent. */
  stateAfterSend: CadenceState;
  /** Stage hint for the template picker. */
  stageHint: "first_touch" | "follow_up";
}

/**
 * Given the current cadence_state and the last touch time, return the next
 * automated touch to send, or null when the sequence is exhausted / the state
 * is terminal. The caller transitions an exhausted state via terminalStateFor.
 * "pending" and "sent" states map to the same upcoming touch so the function is
 * robust whether the cron sees a half-applied state or the settled one.
 * [ReferenceDoc 6.1 + 6.4]
 */
export function planFromState(state: CadenceState, lastTouchAt: Date): CadencePlanCore | null {
  switch (state) {
    case "cold_pending_touch_1":
      return {
        touchKind: "cold_touch_1",
        earliestAllowedSendAt: lastTouchAt,
        stateAfterSend: "cold_sent_touch_1",
        stageHint: "first_touch",
      };
    case "cold_sent_touch_1":
    case "cold_pending_touch_2":
      return {
        touchKind: "cold_touch_2",
        earliestAllowedSendAt: addDays(lastTouchAt, COLD_TOUCH_2_OFFSET_DAYS),
        stateAfterSend: "cold_sent_touch_2",
        stageHint: "follow_up",
      };
    case "cold_sent_touch_2":
    case "cold_pending_touch_3":
      return {
        touchKind: "cold_touch_3",
        earliestAllowedSendAt: addDays(lastTouchAt, COLD_TOUCH_3_OFFSET_DAYS),
        stateAfterSend: "cold_sent_touch_3",
        stageHint: "follow_up",
      };
    case "warm_responded_pending_nudge_1":
      return {
        touchKind: "warm_nudge_1",
        earliestAllowedSendAt: addDays(lastTouchAt, WARM_NUDGE_1_OFFSET_DAYS),
        stateAfterSend: "warm_nudge_1_sent",
        stageHint: "follow_up",
      };
    case "warm_nudge_1_sent":
    case "warm_pending_nudge_2":
      return {
        touchKind: "warm_nudge_2",
        earliestAllowedSendAt: addDays(lastTouchAt, WARM_NUDGE_2_OFFSET_DAYS),
        stateAfterSend: "warm_nudge_2_sent",
        stageHint: "follow_up",
      };
    case "warm_nudge_2_sent":
    case "warm_pending_nudge_3":
      return {
        touchKind: "warm_nudge_3",
        earliestAllowedSendAt: addDays(lastTouchAt, WARM_NUDGE_3_OFFSET_DAYS),
        stateAfterSend: "warm_nudge_3_sent",
        stageHint: "follow_up",
      };
    default:
      // cold_sent_touch_3, warm_nudge_3_sent, and all terminal/non-cadence
      // states have no further automated touch.
      return null;
  }
}

/**
 * The resting cadence_state once a sequence is exhausted with no reply: cold
 * becomes ready-for-handoff, warm becomes stalled-warm. [ReferenceDoc 6.1 + 6.4]
 */
export function terminalStateFor(state: CadenceState): CadenceState | null {
  if (state === "cold_sent_touch_3") return "cold_exhausted_ready_for_handoff";
  if (state === "warm_nudge_3_sent") return "stalled_warm";
  return null;
}

export interface FloorCheckCoreArgs {
  totalTouchCount: number;
  hardCap: number;
  /** Most recent touch from a DIFFERENT alias/brand than the one sending, or
   *  null when no other-alias touch exists. [ReferenceDoc 6.2] */
  mostRecentCrossDomainTouchAt: Date | null;
  now: Date;
}

export interface FloorCheckCoreResult {
  allowed: boolean;
  reason?: string;
  earliestAllowedAt?: Date;
  totalTouchCount: number;
  hardCapReached: boolean;
  crossDomainFloorMet: boolean;
}

/**
 * Evaluate the hard cap [6.3] and the cross-domain 7-day floor [6.2]. A send is
 * allowed only when the cap is not reached AND the floor is met. The hard cap
 * dominates: once reached, the venue is exhausted for the campaign regardless
 * of timing.
 */
export function checkFloors(args: FloorCheckCoreArgs): FloorCheckCoreResult {
  const hardCapReached = args.totalTouchCount >= args.hardCap;
  const floorAt = args.mostRecentCrossDomainTouchAt
    ? addDays(args.mostRecentCrossDomainTouchAt, CROSS_DOMAIN_FLOOR_DAYS)
    : null;
  const crossDomainFloorMet = !floorAt || floorAt.getTime() <= args.now.getTime();
  const allowed = !hardCapReached && crossDomainFloorMet;

  let reason: string | undefined;
  let earliestAllowedAt: Date | undefined;
  if (hardCapReached) {
    reason = `Hard cap of ${args.hardCap} touches reached for this venue this campaign.`;
  } else if (!crossDomainFloorMet && floorAt) {
    reason = `Cross-domain ${CROSS_DOMAIN_FLOOR_DAYS}-day floor: another alias/brand emailed this venue recently.`;
    earliestAllowedAt = floorAt;
  }

  return {
    allowed,
    reason,
    earliestAllowedAt,
    totalTouchCount: args.totalTouchCount,
    hardCapReached,
    crossDomainFloorMet,
  };
}
