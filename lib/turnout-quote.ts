/**
 * Deterministic turnout-quote generator (Phase 1.6).
 *
 * Encodes the guest-count math from the Halloween 2026 reference doc so the
 * engine always quotes a venue the same, vetted turnout phrase for a given
 * priority x slot (initial pitch) or a given live ticket count (sales update).
 * Every quote is paired with the wave-size qualifier so a venue never fears
 * being overwhelmed.
 *
 * Pure + deterministic (no DB, no network, no secrets): kept import-safe so it
 * can be unit-tested directly and called from any server context that builds a
 * template render context. Mirrors the pure-logic lib pattern used by
 * lib/template-picker-score.ts.
 *
 * [ReferenceDoc Section 5.1] universal wave-qualifier framing
 * [ReferenceDoc Section 5.2] initial pitch numbers by priority x slot
 * [ReferenceDoc Section 5.3] sales-update math during October
 * [ReferenceDoc Section 5.4] rounding rule (round down, prefer ranges)
 * [ReferenceDoc Section 5.5] Prio 1 final default (100-200, capacity reactive)
 */

export type Priority = 1 | 2 | 3 | 4 | 5 | 6;
export type SlotType = "wristband" | "middle" | "final";
export type SlotContext = "pickup_window" | "slot" | "night" | "afternoon";

export interface InitialPitchArgs {
  priority: Priority;
  slotType: SlotType;
  slotContext: SlotContext;
}

export interface SalesUpdateArgs {
  ticketsSold: number;
  slotType: SlotType;
  slotContext: SlotContext;
}

// [ReferenceDoc Section 5.1] The wave qualifier is non-negotiable: the crawl
// arrives in small waves, never all at once. The tail clause adapts to the
// slot context. ASCII-normalized (hyphen, straight quotes) to match the way
// the seeded template bodies store copy.
const WAVE_PREFIX =
  "in waves or small groups of 5 to 10 people at a time, not all at once - coming through ";

const SLOT_CONTEXT_TAIL: Record<SlotContext, string> = {
  pickup_window: "across your pickup window",
  slot: "across your slot",
  night: "through the night",
  afternoon: "through the afternoon",
};

/** [ReferenceDoc Section 5.1] number + wave-size qualifier, adapted to slot. */
export function waveQualifier(slotContext: SlotContext): string {
  return `${WAVE_PREFIX}${SLOT_CONTEXT_TAIL[slotContext]}`;
}

// [ReferenceDoc Section 5.2] Initial pitch numbers by priority x slot. Prio 5
// and 6 share the lowest-volume row. Prio 1 final uses the venue-facing
// default 100-200 ([ReferenceDoc Section 5.5]); the doc's "ask capacity first"
// note is operator guidance handled reactively, not venue copy. The Prio 1
// wristband/middle inline tails ("through your pickup window") are dropped here
// because the wave qualifier already supplies the slot-context tail.
const INITIAL_PITCH_NUMBER: Record<Priority, Record<SlotType, string>> = {
  1: { wristband: "200-300", middle: "100-200", final: "100-200" },
  2: { wristband: "about 200", middle: "about 100", final: "about 200" },
  3: { wristband: "about 100", middle: "50-100", final: "about 100" },
  4: { wristband: "50-80", middle: "25-50", final: "50-80" },
  5: {
    wristband: "around 50",
    middle: "around 20 split across stops, steady flow - total ~50",
    final: "30-50, depending",
  },
  6: {
    wristband: "around 50",
    middle: "around 20 split across stops, steady flow - total ~50",
    final: "30-50, depending",
  },
};

/**
 * Initial pitch quote for a cold/confirmation touch: the priority x slot number
 * paired with the wave qualifier. [ReferenceDoc Section 5.2 + 5.1]
 */
export function initialPitchQuote(args: InitialPitchArgs): string {
  const number = INITIAL_PITCH_NUMBER[args.priority][args.slotType];
  return `${number}, ${waveQualifier(args.slotContext)}`;
}

/**
 * The bare priority x slot number with no wave qualifier, for templates that
 * embed it mid-sentence ("around {{guest_count}} people"). [ReferenceDoc 5.2]
 */
export function initialPitchNumber(priority: Priority, slotType: SlotType): string {
  return INITIAL_PITCH_NUMBER[priority][slotType];
}

/**
 * Format a single deflated count as venue-facing copy: never a precise figure,
 * always "around N". [ReferenceDoc Section 5.4]
 */
function aroundNumber(n: number): string {
  return `around ${n}`;
}

/**
 * Sales-update number bucket for a live ticket count. Boundaries round DOWN
 * (50 sold still reads "10-20", 100 still reads "30-50", 150 still reads
 * "around 80"). Above 150 the figure is 70% of actual sold, floored, prefixed
 * with "around". [ReferenceDoc Section 5.3 + 5.4]
 */
function salesNumber(ticketsSold: number): { number: string; honestSlowFlag: boolean } {
  if (ticketsSold < 20) return { number: "10-20", honestSlowFlag: true };
  if (ticketsSold <= 50) return { number: "10-20", honestSlowFlag: false };
  if (ticketsSold <= 100) return { number: "30-50", honestSlowFlag: false };
  if (ticketsSold <= 150) return { number: "around 80", honestSlowFlag: false };
  return { number: aroundNumber(Math.floor(ticketsSold * 0.7)), honestSlowFlag: false };
}

/**
 * Sales-update quote for "how's it going?" replies during October. Returns the
 * venue-facing phrase (number + wave qualifier) plus an honestSlowFlag the
 * caller uses to append the candid "sales are slow, we'll keep you updated"
 * line when turnout is genuinely low. [ReferenceDoc Section 5.3]
 *
 * The wristband venue uses the same 70% deflation as middle/final (people
 * no-show or bypass the wristband), so there is no slot-type branch here.
 */
export function salesUpdateQuote(args: SalesUpdateArgs): {
  phrase: string;
  honestSlowFlag: boolean;
} {
  const { number, honestSlowFlag } = salesNumber(args.ticketsSold);
  return { phrase: `${number}, ${waveQualifier(args.slotContext)}`, honestSlowFlag };
}

/**
 * Build the turnout merge-field values for a template render context. Wired
 * into the merge-field system ({{turnout_quote}} / {{turnout_quote_sales_update}})
 * by the server-side context builders. turnout_quote_sales_update is omitted
 * when no live ticket count is known. [ReferenceDoc Section 5]
 */
export function turnoutMergeFields(args: {
  priority: Priority;
  slotType: SlotType;
  slotContext: SlotContext;
  ticketsSold?: number | null;
}): { turnout_quote: string; turnout_quote_sales_update?: string } {
  const out: { turnout_quote: string; turnout_quote_sales_update?: string } = {
    turnout_quote: initialPitchQuote({
      priority: args.priority,
      slotType: args.slotType,
      slotContext: args.slotContext,
    }),
  };
  if (args.ticketsSold != null) {
    out.turnout_quote_sales_update = salesUpdateQuote({
      ticketsSold: args.ticketsSold,
      slotType: args.slotType,
      slotContext: args.slotContext,
    }).phrase;
  }
  return out;
}
