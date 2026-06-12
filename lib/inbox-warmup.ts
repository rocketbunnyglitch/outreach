/**
 * Inbox warm-up ramp.
 *
 * A brand-new sending inbox/domain that immediately blasts its full daily cold
 * cap looks like spam to Google and gets throttled (or burned). Best practice
 * is to ramp send volume up over ~3 weeks. This computes the EFFECTIVE daily
 * cold cap for an inbox given when its warm-up started -- the send-cap path
 * uses min(configured cap, ramp).
 *
 * Pure + dependency-free so it's unit-tested and safe to import anywhere.
 * warmup_started_at = NULL means "not warming up" -> full configured cap (used
 * for established inboxes; only newly-connected inboxes get a start date).
 */

// Ramp as a fraction of the target cap, keyed by days since warm-up started.
// New-domain-safe ~3-week schedule. The last matching threshold wins.
const RAMP: Array<{ day: number; frac: number }> = [
  // Operator-tuned 2026-06-12 ("lift the cap a bit"): early steps raised
  // 0.15/0.3 -> 0.2/0.4 after the first week of the new brand domains
  // showed clean deliverability (real replies, no bounce spike). Still a
  // ~3-week ramp; established domains bypass entirely (warmup NULL).
  { day: 0, frac: 0.2 },
  { day: 3, frac: 0.4 },
  { day: 7, frac: 0.55 },
  { day: 14, frac: 0.75 },
  { day: 21, frac: 1.0 },
];

// Never ramp below this many sends/day (a 1-2/day inbox isn't worth warming).
const WARMUP_FLOOR = 5;

export interface WarmupStatus {
  /** Effective daily cold cap right now. */
  cap: number;
  /** True while still ramping (today's cap < target). */
  ramping: boolean;
  /** Whole days since warm-up started (0 on day one). */
  daysIn: number;
  /** Fraction of target currently unlocked (0-1). */
  fraction: number;
}

/**
 * Effective daily cold cap for an inbox under warm-up. Returns targetCap
 * unchanged when not warming up (null start) or once fully ramped.
 */
export function warmupRampCap(
  warmupStartedAt: Date | null,
  targetCap: number,
  now: Date = new Date(),
): number {
  return warmupStatus(warmupStartedAt, targetCap, now).cap;
}

export function warmupStatus(
  warmupStartedAt: Date | null,
  targetCap: number,
  now: Date = new Date(),
): WarmupStatus {
  if (!warmupStartedAt) {
    return { cap: targetCap, ramping: false, daysIn: 0, fraction: 1 };
  }
  const ms = now.getTime() - warmupStartedAt.getTime();
  // Future start date (clock skew / misconfig) -> treat as not ramping.
  if (ms < 0) return { cap: targetCap, ramping: false, daysIn: 0, fraction: 1 };
  const daysIn = Math.floor(ms / 86_400_000);
  let fraction = RAMP[0]?.frac ?? 1;
  for (const step of RAMP) {
    if (daysIn >= step.day) fraction = step.frac;
  }
  const ramped = Math.max(WARMUP_FLOOR, Math.round(targetCap * fraction));
  const cap = Math.min(targetCap, ramped);
  return { cap, ramping: cap < targetCap, daysIn, fraction };
}
