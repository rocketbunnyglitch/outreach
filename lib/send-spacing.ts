/**
 * Send spacing algorithm.
 *
 * Given N venues to send to + a time window (e.g. 10am-4pm today) +
 * minimum spacing constraints, returns N scheduled timestamps that:
 *   - Fit within the window
 *   - Respect the inbox's min_seconds_between_sends
 *   - Have jitter so sends don't look like a robot ticking exactly
 *     every 90s
 *
 * The function fails fast (throws) when the window is too short to fit
 * N sends at the spacing floor. Caller should catch + show "shrink the
 * batch or widen the window".
 *
 * Pure / deterministic-enough — uses a seeded PRNG so previewing the
 * schedule before queueing matches the actual queue. Tests pass a fixed
 * seed.
 */

export interface SpacingOpts {
  /** How many sends to schedule. */
  count: number;
  /** Earliest a send may go out. */
  windowStart: Date;
  /** Latest a send may go out. */
  windowEnd: Date;
  /** Minimum gap between consecutive sends, in seconds. */
  minSpacingSeconds: number;
  /**
   * How much to jitter the gap, in seconds. Each gap becomes:
   *   minSpacingSeconds + random(0, jitterSeconds).
   * Set to 0 for evenly-spaced (rigid) schedule.
   */
  jitterSeconds: number;
  /**
   * Optional deterministic seed for tests. Falls back to Math.random.
   */
  seed?: number;
}

export interface SpacingResult {
  scheduledTimestamps: Date[];
  /** Average gap between consecutive sends, seconds. For UI feedback. */
  avgGapSeconds: number;
}

export function computeSendSchedule(opts: SpacingOpts): SpacingResult {
  const { count, windowStart, windowEnd, minSpacingSeconds, jitterSeconds, seed } = opts;
  if (count <= 0) return { scheduledTimestamps: [], avgGapSeconds: 0 };

  const windowSeconds = (windowEnd.getTime() - windowStart.getTime()) / 1000;
  if (windowSeconds <= 0) {
    throw new Error("windowEnd must be after windowStart");
  }
  const minTotalSeconds = (count - 1) * minSpacingSeconds;
  if (minTotalSeconds > windowSeconds) {
    const neededHours = Math.ceil(minTotalSeconds / 3600);
    throw new Error(
      `Can't fit ${count} sends with ${minSpacingSeconds}s spacing in this window. Need at least ${neededHours}h of runway or fewer venues.`,
    );
  }

  // Average gap = remaining window divided by gaps. We add (or remove)
  // jitter so total ≤ window.
  const baseGap = windowSeconds / Math.max(1, count - 1);
  // Clamp the effective base to at least the minimum spacing
  const effectiveBase = Math.max(baseGap, minSpacingSeconds);

  // Seeded PRNG (mulberry32) — light, deterministic.
  let s = (seed ?? Math.floor(Math.random() * 2_147_483_647)) | 0;
  const random = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const result: Date[] = [];
  let cursor = windowStart.getTime();
  for (let i = 0; i < count; i++) {
    if (i === 0) {
      // First send fires ~5-30 seconds into the window (small lead-in
      // jitter so a Queue All click doesn't fire its first send at the
      // exact same instant for two operators).
      cursor += (5 + random() * 25) * 1000;
    } else {
      const jitter = jitterSeconds * (random() - 0.5);
      const gap = Math.max(minSpacingSeconds, effectiveBase + jitter);
      cursor += gap * 1000;
    }
    // Clamp to window end (last send can't slip past)
    if (cursor > windowEnd.getTime()) cursor = windowEnd.getTime();
    result.push(new Date(cursor));
  }

  const avgGap =
    result.length < 2
      ? 0
      : (result[result.length - 1]?.getTime() - result[0]?.getTime()) / 1000 / (result.length - 1);

  return { scheduledTimestamps: result, avgGapSeconds: Math.round(avgGap) };
}

/**
 * Format a gap in seconds as "3m" / "1h 20m" for the UI.
 */
export function formatGap(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
