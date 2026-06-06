/**
 * Pure mapping: inbound reply classification -> venue x outreach-brand
 * relationship action. NO "server-only", NO db, NO network -- importable by
 * vitest and by client code. The DB write lives in lib/venue-relationships.ts
 * (autoFlagRelationshipFromClassification), which calls this to decide what,
 * if anything, to do.
 *
 * Why a pure function: the original auto-flag checked classification values
 * ("hard_no" / "engaged") the classifier NEVER emits (see
 * lib/ai-classify.ts VALID_CLASSIFICATIONS), so the relationship auto-flag
 * never fired. This maps the REAL classifier labels and gates on confidence.
 *
 * Confidence gate: Reference Doc 8.4 -- the engine auto-acts only at >= 0.90
 * confidence. Below that, this returns "none" (no automatic state change; the
 * operator triages from the needs-attention queue). Reference Doc 7.16.4 -- a
 * cancellation is NEVER auto-flagged bad; the venue stays neutral.
 *
 * NEVER returns an action that sets a relationship to 'good' -- a positive
 * 'good' flag requires an explicit operator/post-event signal (Reference Doc
 * 3.3 / 7.x). The strongest positive auto-action is "ensure_neutral" (create a
 * neutral row only when none exists; never upgrade/downgrade an existing row).
 */

/** Confidence floor for auto-acting on a classification (Reference Doc 8.4). */
export const RELATIONSHIP_AUTO_ACT_CONFIDENCE = 0.9;

/** Days a 'bad' auto-flag stays before the decay cron may clear it. 1 year. */
export const RELATIONSHIP_BAD_AUTO_CLEAR_DAYS = 365;

export type RelationshipAction = "set_bad" | "ensure_neutral" | "none";

export interface RelationshipActionResult {
  action: RelationshipAction;
  /** Only present for set_bad: days until auto_clear_at. */
  autoClearDays?: number;
}

/**
 * Decide the relationship action for a classifier label + confidence.
 *
 * Mapping (only at confidence >= RELATIONSHIP_AUTO_ACT_CONFIDENCE):
 *   unsubscribe                    -> set_bad (auto_clear_at = +365d), hard block
 *   interested / warm / confirmed  -> ensure_neutral (create neutral row only if
 *                                     none exists; NEVER 'good', never downgrade)
 *   everything else                -> none (operator handles)
 *
 * decline           -> none here. Decline is a cadence-level "declined this
 *                      campaign" decision (lib/ai-auto-status.ts), NOT a
 *                      relationship 'bad'. The venue stays eligible next campaign.
 * cancelled_by_them -> none. Reference Doc 7.16.4: cancellations are never
 *                      auto-punished; relationship stays neutral.
 * stalled_warm      -> none. Cadence-level stop for this campaign only; no
 *                      relationship change; auto-clears next campaign.
 * question / callback_requested / auto_reply / spam / unknown -> none.
 *
 * Below the confidence floor: ALWAYS "none" -- surface a suggestion, never
 * auto-act.
 */
export function relationshipActionForClassification(
  classification: string,
  confidence: number,
): RelationshipActionResult {
  // Below the auto-act floor: never act, regardless of label.
  if (!(confidence >= RELATIONSHIP_AUTO_ACT_CONFIDENCE)) {
    return { action: "none" };
  }

  switch (classification) {
    case "unsubscribe":
      return { action: "set_bad", autoClearDays: RELATIONSHIP_BAD_AUTO_CLEAR_DAYS };

    case "interested":
    case "warm":
    case "confirmed":
      return { action: "ensure_neutral" };

    // Explicit no-ops -- listed for intent + so a future label change is a
    // visible diff rather than a silent fall-through.
    case "decline":
    case "cancelled_by_them":
    case "stalled_warm":
    case "question":
    case "callback_requested":
    case "auto_reply":
    case "spam":
      return { action: "none" };

    default:
      return { action: "none" };
  }
}
