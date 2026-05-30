/**
 * Suggested next action — deterministic mapping from
 * (classification, thread state) → recommended operator action.
 *
 * Per the inbox spec:
 *   "AI / Anthropic Enhancements ... Use Anthropic API as an
 *    operations brain, not an uncontrolled auto-sender."
 *
 * We DON'T call the LLM on every thread open. The mapping is
 * deterministic — the classifier already inferred WHAT the
 * inbound message is; this library encodes WHAT TO DO with
 * each category. Operator clicks the suggested action; nothing
 * fires without their input.
 *
 * The kinds map to client-side intents the SuggestedActionRow
 * component handles. New action kinds = add the case here + a
 * handler in the row component. Adding LLM-driven suggestions
 * later is additive: a separate ai_suggest_for_thread() can
 * return supplementary suggestions alongside these rule-based ones.
 */

import type { Classification } from "@/lib/triage-classifier";

export type ThreadState =
  | "needs_reply"
  | "waiting_on_them"
  | "follow_up_due"
  | "closed_won"
  | "closed_lost"
  | "closed_dnc"
  | "archived";

/** Action kinds the row component knows how to handle. */
export type SuggestedActionKind =
  | "reply" // Open the reply composer focused (same as r shortcut)
  | "create_callback_task" // Create a task targeting this thread
  | "mark_interested" // setThreadState -> closed_won
  | "mark_declined" // setThreadState -> closed_lost
  | "ask_for_manager" // Open reply composer with manager-ask prefill
  | "archive"; // setThreadState -> archived

export interface SuggestedAction {
  kind: SuggestedActionKind;
  /** Short label rendered on the button. Sentence case, no period. */
  label: string;
  /** One-line context the row shows above the button. */
  reason: string;
}

/**
 * Returns the suggested action, or null when no recommendation
 * applies (e.g. unclassified threads, already-closed threads).
 *
 * Decision table (rows = classification, cols = thread state):
 *
 *                       | needs_reply        | waiting       | follow_up_due
 *   interested          | reply              | reply         | reply
 *   question            | reply              | reply         | reply
 *   callback_requested  | create_callback    | create_callback | create_callback
 *   decline             | mark_declined      | mark_declined | mark_declined
 *   unsubscribe         | archive            | archive       | archive
 *   auto_reply          | archive            | null          | null
 *   spam                | archive            | archive       | archive
 *   unclassified        | null               | null          | null
 *
 * Closed/archived states always return null (no further action
 * needed — operator's already decided).
 */
export function suggestNextAction(opts: {
  classification: Classification;
  state: ThreadState;
}): SuggestedAction | null {
  // Closed threads — operator has resolved. No suggestion.
  if (
    opts.state === "closed_won" ||
    opts.state === "closed_lost" ||
    opts.state === "closed_dnc" ||
    opts.state === "archived"
  ) {
    return null;
  }

  switch (opts.classification) {
    case "interested":
      return {
        kind: "reply",
        label: "Reply with details",
        reason:
          "They're interested — send what they need to commit (numbers, hours, ask for manager).",
      };

    case "question":
      return {
        kind: "reply",
        label: "Answer their question",
        reason: "They asked something specific. Quick answer keeps the thread warm.",
      };

    case "callback_requested":
      return {
        kind: "create_callback_task",
        label: "Create callback task",
        reason: "They asked for a call. Schedule it so it doesn't slip.",
      };

    case "decline":
      return {
        kind: "mark_declined",
        label: "Mark declined",
        reason: "They passed. Close the thread so it leaves the active inbox.",
      };

    case "unsubscribe":
      // Inbound unsubscribe auto-suppression already ran in the poll
      // worker; this just closes the thread.
      return {
        kind: "archive",
        label: "Archive",
        reason: "They asked to be removed. Address already auto-suppressed; close the thread.",
      };

    case "auto_reply":
      // Only suggest on needs_reply — a thread sitting in
      // waiting/follow_up with an OOO bounce-back doesn't need
      // action; we wait for the real reply.
      if (opts.state === "needs_reply") {
        return {
          kind: "archive",
          label: "Archive auto-reply",
          reason: "Auto-reply (out-of-office or similar). No human action needed.",
        };
      }
      return null;

    case "spam":
      return {
        kind: "archive",
        label: "Archive spam",
        reason: "Classified as spam. Archive to clear the queue.",
      };

    case "unclassified":
      // No useful suggestion — operator triages manually.
      return null;

    default:
      return null;
  }
}
