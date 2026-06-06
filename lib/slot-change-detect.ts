/**
 * Slot-change reply detection (Phase 3.5). [ReferenceDoc 9.4]
 *
 * A PURE heuristic detector for the case where an already-confirmed venue
 * replies asking to move to a different day/slot ("actually we can only do
 * Friday", "can we switch to the late slot instead"). There is NO db import
 * and NO "server-only" pragma here on purpose: this module must be importable
 * from anywhere -- the inbound poll worker (server), worklist loaders (server),
 * and any client component that wants to preview the match all share it.
 *
 * DESIGN CHOICE (operator-assisted detection, NOT a new AI enum):
 *   Per the Phase 3.5 handoff, slot-change is surfaced via a reliable heuristic
 *   FLAG on the thread (email_threads.slot_change_requested), NOT a new value
 *   in the AI reply_classification enum. Reasons:
 *     - The existing classifier (lib/ai-classify) advances cadence + colours
 *       the inbox; adding a slot-change enum value would force a model retrain
 *       and risk mislabelling ordinary "confirmed" replies as slot changes.
 *     - The SWAP itself is operator-driven anyway (the operator picks the new
 *       slot), so all we need from automation is a cheap, high-precision "this
 *       thread probably wants a different slot" hint to raise the row on the
 *       worklist. A deterministic phrase heuristic is auditable and tunable
 *       without ML, and it only fires for venues that ALREADY have a confirmed
 *       venue_event (venueHasConfirmedEvent), which is exactly the 9.4 case.
 *
 * PRECISION OVER RECALL. This detector is deliberately conservative: a false
 * positive nags the operator about a non-existent slot change, so we only fire
 * when a "change intent" phrase co-occurs with a "slot/day" word in the same
 * text, AND the venue already has a confirmed slot. Missing a few real ones is
 * cheaper than crying wolf -- the operator still sees the reply in the normal
 * replies queue.
 */

export interface SlotChangeDetectResult {
  isSlotChange: boolean;
  /** The change-intent phrase that matched, for display on the worklist row. */
  matchedPhrase?: string;
}

export interface SlotChangeDetectInput {
  subject: string | null | undefined;
  body: string | null | undefined;
  /** Only ever true for a venue that already holds a confirmed venue_event. */
  venueHasConfirmedEvent: boolean;
}

/**
 * Change-intent phrases. Each is a literal lowercase substring; we require one
 * of these PLUS a slot/day word (below) to co-occur, so "can we switch the
 * contact email" alone never trips the flag. Ordered roughly most- to
 * least-specific; the first match wins as the displayed matchedPhrase.
 */
const CHANGE_PHRASES: readonly string[] = [
  "can we switch",
  "switch to",
  "swap to",
  "move to",
  "change to",
  "instead of",
  "reschedule",
  "can't do",
  "cant do",
  "cannot do",
  "can no longer do",
  "won't work",
  "wont work",
  "doesn't work",
  "does not work",
  "different day",
  "different night",
  "another day",
  "another night",
] as const;

/**
 * Slot / day anchor words. A change phrase must co-occur with one of these for
 * the reply to count as a slot change -- this is what keeps precision high.
 * Day-of-week names, slot-role words, and generic scheduling nouns.
 */
const SLOT_WORDS: readonly string[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "day",
  "night",
  "evening",
  "weekend",
  "slot",
  "time",
  "date",
  "wristband",
  "middle",
  "final",
  "early",
  "late",
] as const;

// A handful of phrases ARE self-contained slot changes (they already name a
// day/night) and do not need a second anchor word. Listed so they fire even in
// a terse one-line reply like "different night?".
const SELF_ANCHORED_PHRASES: ReadonlySet<string> = new Set([
  "different day",
  "different night",
  "another day",
  "another night",
]);

function normalize(text: string | null | undefined): string {
  return (text ?? "").toLowerCase();
}

/**
 * Pure heuristic. Returns isSlotChange=false whenever the venue has no confirmed
 * event (slot changes only make sense for a venue that already holds a slot) or
 * when no change-intent phrase co-occurs with a slot/day anchor word.
 */
export function detectSlotChange(input: SlotChangeDetectInput): SlotChangeDetectResult {
  if (!input.venueHasConfirmedEvent) return { isSlotChange: false };

  const haystack = `${normalize(input.subject)} ${normalize(input.body)}`;
  if (haystack.trim().length === 0) return { isSlotChange: false };

  const matchedPhrase = CHANGE_PHRASES.find((p) => haystack.includes(p));
  if (!matchedPhrase) return { isSlotChange: false };

  // A self-anchored phrase ("different night") already implies a slot/day.
  if (SELF_ANCHORED_PHRASES.has(matchedPhrase)) {
    return { isSlotChange: true, matchedPhrase };
  }

  // Otherwise require a slot/day anchor word somewhere in the text.
  const hasSlotWord = SLOT_WORDS.some((w) => haystack.includes(w));
  if (!hasSlotWord) return { isSlotChange: false };

  return { isSlotChange: true, matchedPhrase };
}
