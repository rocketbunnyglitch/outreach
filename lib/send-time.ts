/**
 * Bar-calibrated send-time optimization (Tier-2).
 *
 * Picks the next good LOCAL send time for a venue, tuned for hospitality --
 * NOT office hours. Bar/venue managers work nights and weekends (running
 * service) and catch up on email in the daytime lull before evening prep, so:
 *
 *   - AVOID peak service:  Thu-Sat ~18:00-02:00 local (slammed on the floor;
 *     an email lands buried under the next morning's pile).
 *   - AVOID the dead of night: ~02:00-08:00 local (asleep; lands at the bottom
 *     of the stack by the time they wake).
 *   - FAVOR off-peak daytime: ~11:00-15:00 local, mid-week AND weekend daytime.
 *
 * When per-venue / per-city reply history is available (inbound reply
 * timestamps bucketed by local hour), bias toward the hour those venues
 * actually reply. Otherwise fall back to the heuristic late-morning slot.
 *
 * This is timing only -- 100% deliverability-NEUTRAL. It never adds tracking,
 * never changes WHO sends or WHETHER a draft auto-sends; it only proposes a
 * `scheduled_for` instant that the existing operator-approved scheduled-send
 * pipeline (lib/scheduled-send-runner.ts) dispatches. See
 * lib/send-mode-gate.ts -- the send-safety boundary is untouched.
 *
 * Pure + dependency-free (no db, no "server-only") so it is unit-tested
 * directly. Timezone math uses the platform Intl APIs (the VPS runs UTC, so
 * every local-time decision MUST resolve through an explicit IANA zone --
 * see the #418 timezone guardrail).
 */

/** A single bucketed inbound-reply observation, in the venue's local zone. */
export interface ReplyHistoryPoint {
  /** Local hour the venue replied, 0-23. */
  localHour: number;
  /** Local day-of-week the venue replied, 0=Sun .. 6=Sat. Optional. */
  localDay?: number;
}

export interface BestSendWindowInput {
  /** IANA timezone of the venue's city (cities.timezone), e.g. "America/Chicago". */
  cityTimezone: string;
  /** "Now" as an absolute instant. Passed in for determinism / testing. */
  now: Date;
  /**
   * Optional inbound-reply history bucketed to the venue's local hour. When
   * there are enough usable points, the suggested hour biases toward the
   * venue's most common reply hour instead of the heuristic default.
   */
  replyHistory?: ReplyHistoryPoint[];
}

export interface BestSendWindowResult {
  /** The suggested send instant (absolute; store as scheduled_for). */
  sendAt: Date;
  /** Local hour of `sendAt` in the city zone, 0-23. */
  localHour: number;
  /** Local day-of-week of `sendAt`, 0=Sun .. 6=Sat. */
  localDay: number;
  /** Whether the hour came from reply history or the heuristic. */
  source: "reply_history" | "heuristic";
  /** Whether `now` itself falls in a peak-service window (for the send hint). */
  isPeakNow: boolean;
  /** Human-readable rationale for tooltips / logs. */
  reason: string;
}

// ---------------------------------------------------------------------------
// Window definitions (all in the venue's LOCAL wall-clock).
// ---------------------------------------------------------------------------

/** Nights the venue is busy running service. Thu=4, Fri=5, Sat=6. */
const PEAK_EVENING_DAYS = new Set([4, 5, 6]);
/** The 00:00-02:00 spillover of a peak night lands the next morning: Fri/Sat/Sun. */
const PEAK_EARLY_MORNING_DAYS = new Set([5, 6, 0]);
const PEAK_EVENING_START = 18; // 18:00
const PEAK_EARLY_MORNING_END = 2; // 02:00

const DEAD_NIGHT_START = 2; // 02:00
const DEAD_NIGHT_END = 8; // 08:00

/** Ideal daytime band -- the off-peak lull when venues catch up on email. */
const FAVORED_START = 11; // 11:00
const FAVORED_END = 15; // 15:00 (exclusive)
/** Default suggested hour when there is no usable reply history (late morning). */
const DEFAULT_TARGET_HOUR = FAVORED_START;

/** True if `hour` is in the ideal off-peak daytime band (any day). */
export function isFavoredDaytimeHour(hour: number): boolean {
  return hour >= FAVORED_START && hour < FAVORED_END;
}

/**
 * Hours we are willing to send in at all -- after the dead-night ends and
 * before evening service ramps. Reply-history hours outside this band are
 * ignored (we won't propose a 3am or 9pm send even if a venue once replied
 * then).
 */
const ACCEPTABLE_START = 8; // 08:00
const ACCEPTABLE_END = 18; // 18:00 (exclusive)

/** Minimum usable reply observations before we trust the data over the heuristic. */
const MIN_HISTORY_POINTS = 3;
/** Don't search more than two weeks out for a slot (defensive bound). */
const MAX_DAY_LOOKAHEAD = 14;

// ---------------------------------------------------------------------------
// Timezone helpers (Intl-based, dependency-free).
// ---------------------------------------------------------------------------

interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  second: number;
  /** 0=Sun .. 6=Sat */
  weekday: number;
}

/** The wall-clock components of an instant, as seen in `tz`. */
export function getZonedParts(tz: string, date: Date): ZonedParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  const year = Number(map.year);
  const month = Number(map.month);
  const day = Number(map.day);
  const hour = Number(map.hour) % 24; // h23 can emit "24" at midnight on some ICU builds
  const minute = Number(map.minute);
  const second = Number(map.second);
  // Day-of-week: build a UTC date from the local Y-M-D and read getUTCDay --
  // a calendar date's weekday is zone-independent once the date is fixed.
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { year, month, day, hour, minute, second, weekday };
}

/** Offset (local - UTC) in ms for `tz` at the given instant. */
function tzOffsetMs(tz: string, date: Date): number {
  const p = getZonedParts(tz, date);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUTC - date.getTime();
}

/**
 * Convert a local wall-clock time in `tz` to the absolute instant. Uses the
 * standard guess-then-correct: build the naive UTC, measure the zone offset at
 * that instant, subtract it. One correction is accurate except inside the rare
 * DST overlap hour -- which never lands in our daytime send band.
 */
export function zonedWallTimeToUtc(
  tz: string,
  fields: { year: number; month: number; day: number; hour: number; minute?: number },
): Date {
  const naiveUtc = Date.UTC(
    fields.year,
    fields.month - 1,
    fields.day,
    fields.hour,
    fields.minute ?? 0,
    0,
  );
  const offset = tzOffsetMs(tz, new Date(naiveUtc));
  return new Date(naiveUtc - offset);
}

// ---------------------------------------------------------------------------
// Window predicates.
// ---------------------------------------------------------------------------

/** True if (weekday, hour) falls in a peak service window. */
export function isPeakServiceHour(weekday: number, hour: number): boolean {
  if (PEAK_EVENING_DAYS.has(weekday) && hour >= PEAK_EVENING_START) return true;
  if (PEAK_EARLY_MORNING_DAYS.has(weekday) && hour < PEAK_EARLY_MORNING_END) return true;
  return false;
}

/** True if `hour` falls in the dead-of-night band (any day). */
function isDeadNightHour(hour: number): boolean {
  return hour >= DEAD_NIGHT_START && hour < DEAD_NIGHT_END;
}

/** A send hour we will never propose. */
function isAvoidedHour(weekday: number, hour: number): boolean {
  return isPeakServiceHour(weekday, hour) || isDeadNightHour(hour);
}

/** Whether the instant `date` is in a peak-service window in `tz`. */
export function isPeakServiceWindow(tz: string, date: Date): boolean {
  const p = getZonedParts(tz, date);
  return isPeakServiceHour(p.weekday, p.hour);
}

// ---------------------------------------------------------------------------
// Reply-history hour selection.
// ---------------------------------------------------------------------------

/**
 * Pick the venue's most common reply hour among acceptable send hours.
 * Returns null when there isn't enough usable data. Ties resolve to the
 * earliest hour (gets the email in front of them sooner).
 */
function bestReplyHour(history: ReplyHistoryPoint[] | undefined): number | null {
  if (!history || history.length === 0) return null;
  const counts = new Map<number, number>();
  for (const point of history) {
    const h = point.localHour;
    if (!Number.isInteger(h) || h < ACCEPTABLE_START || h >= ACCEPTABLE_END) continue;
    counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  let total = 0;
  for (const c of counts.values()) total += c;
  if (total < MIN_HISTORY_POINTS) return null;

  let bestHour: number | null = null;
  let bestCount = -1;
  // Iterate ascending so ties keep the earliest hour.
  for (const hour of [...counts.keys()].sort((a, b) => a - b)) {
    const count = counts.get(hour) ?? 0;
    if (count > bestCount) {
      bestCount = count;
      bestHour = hour;
    }
  }
  return bestHour;
}

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

/**
 * Compute the next good local send time for a venue.
 *
 * - With usable reply history: targets the venue's most common reply hour.
 * - Otherwise: targets the heuristic late-morning slot (11:00 local).
 * - In both cases: returns the SOONEST future day on which that hour is not in
 *   a peak-service or dead-night window.
 */
export function bestSendWindow(input: BestSendWindowInput): BestSendWindowResult {
  const { cityTimezone: tz, now } = input;

  const historyHour = bestReplyHour(input.replyHistory);
  const source: "reply_history" | "heuristic" =
    historyHour !== null ? "reply_history" : "heuristic";
  const targetHour = historyHour ?? DEFAULT_TARGET_HOUR;

  const nowParts = getZonedParts(tz, now);
  const isPeakNow = isPeakServiceHour(nowParts.weekday, nowParts.hour);

  // Walk forward day by day from today, picking the first occurrence of
  // targetHour that is both in the future and not in an avoided window.
  for (let dayOffset = 0; dayOffset <= MAX_DAY_LOOKAHEAD; dayOffset++) {
    // Advance the calendar date by dayOffset using a UTC anchor on the local
    // date (date arithmetic is zone-safe on a date-only UTC anchor).
    const anchor = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day));
    anchor.setUTCDate(anchor.getUTCDate() + dayOffset);
    const y = anchor.getUTCFullYear();
    const m = anchor.getUTCMonth() + 1;
    const d = anchor.getUTCDate();
    const weekday = anchor.getUTCDay();

    if (isAvoidedHour(weekday, targetHour)) continue;

    const candidate = zonedWallTimeToUtc(tz, { year: y, month: m, day: d, hour: targetHour });
    if (candidate.getTime() <= now.getTime()) continue; // must be in the future

    const reason =
      source === "reply_history"
        ? `This venue tends to reply around ${formatHour(targetHour)} local -- scheduling for then.`
        : `Bars catch up on email mid-day; scheduling for ${formatHour(targetHour)} local, off the dinner/service rush.`;

    return {
      sendAt: candidate,
      localHour: targetHour,
      localDay: weekday,
      source,
      isPeakNow,
      reason,
    };
  }

  // Unreachable in practice (a daytime hour always has a valid day within the
  // lookahead), but return a safe fallback rather than throw.
  const fallback = zonedWallTimeToUtc(tz, {
    year: nowParts.year,
    month: nowParts.month,
    day: nowParts.day + 1,
    hour: DEFAULT_TARGET_HOUR,
  });
  return {
    sendAt: fallback,
    localHour: DEFAULT_TARGET_HOUR,
    localDay: getZonedParts(tz, fallback).weekday,
    source: "heuristic",
    isPeakNow,
    reason: "Defaulting to tomorrow late-morning.",
  };
}

/** "11:00 AM" style label for a 0-23 hour. */
function formatHour(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const ampm = hour < 12 ? "AM" : "PM";
  return `${h12}:00 ${ampm}`;
}
