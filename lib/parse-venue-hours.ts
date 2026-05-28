/**
 * Venue hours parsing + suggested-call-window helpers.
 *
 * Operator session 11 carryover (call follow-up engine, final piece):
 *   "Venue-hours-aware suggested call window"
 *
 * The venues.hours column (migration 0025) stores free-text opening
 * hours pasted from Google Maps. This module:
 *
 *   1. parseVenueHours(text) — best-effort regex parse → structured
 *      { mon: { open, close } | "closed", ... }. Returns null when
 *      input is empty/unparseable.
 *
 *   2. suggestCallWindow(parsed, now?, venueType?) — picks a
 *      reasonable call window based on opening times. Returns a
 *      short string for inline display.
 *
 * Why best-effort
 * ---------------
 * Google Maps formats vary by locale, by venue, and by whether the
 * operator pastes the "Hours" widget or the table view. Plus
 * special-case entries like "Hours might differ", "Holiday hours",
 * "Open 24 hours", "Closed". We aim to handle the 90% case cleanly
 * and gracefully degrade: when parse fails, suggestCallWindow
 * returns null + the UI hides the hint pill.
 *
 * Why no DB cache (yet)
 * ---------------------
 * The parsed structure could live in a venues.hours_parsed jsonb
 * column. v1 parses on every read — cheap (<100µs on the common
 * input) and means schema migrations don't have to handle parsed
 * state. If perf bites or we want SQL queries over hours, a
 * separate migration can add the cache column later.
 */

/** A day's hours. "closed" = explicit closed; null = data missing. */
export type DayHours = { open: string; close: string } | "closed" | null;

export interface ParsedVenueHours {
  mon: DayHours;
  tue: DayHours;
  wed: DayHours;
  thu: DayHours;
  fri: DayHours;
  sat: DayHours;
  sun: DayHours;
  /** True if the source contained "24 hours" / "24/7". */
  open24: boolean;
}

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
type DayKey = (typeof DAY_KEYS)[number];

/**
 * Map any common spelling of a day name to its 3-letter key.
 * Handles: monday, mon, mo, m (rare but seen in compact formats).
 */
const DAY_ALIASES: Record<string, DayKey> = {
  monday: "mon",
  mon: "mon",
  tuesday: "tue",
  tues: "tue",
  tue: "tue",
  wednesday: "wed",
  wed: "wed",
  thursday: "thu",
  thurs: "thu",
  thur: "thu",
  thu: "thu",
  friday: "fri",
  fri: "fri",
  saturday: "sat",
  sat: "sat",
  sunday: "sun",
  sun: "sun",
};

/**
 * Parse a free-text hours blob into structured day-by-day open/close
 * times. Returns null when nothing useful was extracted (caller can
 * fall back to displaying the raw text).
 *
 * Format coverage
 * ---------------
 *   "Monday: 4:00 PM – 2:00 AM"
 *   "Mon 4PM-2AM"
 *   "Monday\t4 PM–2 AM" (tab-separated, Google Maps table view)
 *   "Tuesday: Closed"
 *   "Open 24 hours"   → open24=true
 *   "24/7"            → open24=true
 *   Day ranges ("Mon-Fri 4PM-2AM") expanded across each day in range
 *
 * Times normalized to HH:MM 24-hour, but values past midnight (e.g.
 * close at 2 AM) are emitted as 24+H — "26:00" means 2 AM next day.
 * This matters for the suggested-window heuristic (a 2 AM close means
 * the venue is active, not closed for the evening).
 */
export function parseVenueHours(input: string | null | undefined): ParsedVenueHours | null {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  const result: ParsedVenueHours = {
    mon: null,
    tue: null,
    wed: null,
    thu: null,
    fri: null,
    sat: null,
    sun: null,
    open24: false,
  };

  // Quick scan for "24 hours" / "24/7" anywhere — short-circuits the
  // common all-day case before line-by-line parsing.
  if (/\b(24\s*hours|24\/7|open all day)\b/i.test(trimmed)) {
    result.open24 = true;
  }

  // Split on newlines OR comma OR semicolon. Some operators paste
  // single-line summaries like "Mon-Fri 4PM-2AM, Sat 12PM-2AM".
  const lines = trimmed
    .split(/[\n;,]/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  for (const line of lines) {
    parseLine(line, result);
  }

  // If nothing was extracted AND no 24-hour flag, return null so the
  // caller falls back to showing the raw text.
  const anyDayParsed = DAY_KEYS.some((d) => result[d] !== null);
  if (!anyDayParsed && !result.open24) return null;

  return result;
}

/**
 * Parse a single hours line and write into the result object.
 * Mutates `result` for performance (called per-line in a loop).
 */
function parseLine(line: string, result: ParsedVenueHours): void {
  const normalized = line.toLowerCase().replace(/[–—]/g, "-");

  // 1. Day range "Mon-Fri 4PM-2AM" — applies same hours to each day.
  const rangeMatch = normalized.match(
    /^(\w{2,9})\s*(?:-|\bto\b|\bthrough\b)\s*(\w{2,9})\s*[:\s]?\s*(.+)$/,
  );
  if (rangeMatch) {
    const [, startName, endName, timesPart] = rangeMatch;
    if (!startName || !endName) return;
    const startKey = DAY_ALIASES[startName];
    const endKey = DAY_ALIASES[endName];
    if (startKey && endKey) {
      const days = expandDayRange(startKey, endKey);
      const times = parseTimesPart(timesPart ?? "");
      for (const d of days) result[d] = times;
      return;
    }
  }

  // 2. Single day "Monday: 4 PM - 2 AM" or "Monday    4 PM - 2 AM"
  const singleMatch = normalized.match(/^(\w{2,9})\s*[:\s]\s*(.+)$/);
  if (singleMatch) {
    const [, dayName, timesPart] = singleMatch;
    if (!dayName) return;
    const dayKey = DAY_ALIASES[dayName];
    if (dayKey) {
      result[dayKey] = parseTimesPart(timesPart ?? "");
    }
  }
}

/** Return the day keys from start through end, wrapping the week. */
function expandDayRange(start: DayKey, end: DayKey): DayKey[] {
  const startIdx = DAY_KEYS.indexOf(start);
  const endIdx = DAY_KEYS.indexOf(end);
  if (startIdx === -1 || endIdx === -1) return [];
  if (startIdx <= endIdx) {
    return DAY_KEYS.slice(startIdx, endIdx + 1);
  }
  // Wrap (e.g. "Fri-Sun" would wrap if listed out of order; unusual)
  return [...DAY_KEYS.slice(startIdx), ...DAY_KEYS.slice(0, endIdx + 1)];
}

/**
 * Parse the times portion of a line ("4 PM - 2 AM", "closed", "24 hours").
 * Returns "closed", null (unparseable), or {open, close} in HH:MM.
 */
function parseTimesPart(input: string): DayHours {
  const s = input.trim();
  if (/^closed\b/i.test(s) || s === "—" || s === "-") return "closed";
  if (/24\s*hours|all day/.test(s)) return { open: "00:00", close: "24:00" };

  // Match "4 PM - 2 AM", "4:30 PM - 2:00 AM", "16:00 - 02:00".
  // The separator already normalized to "-" by parseLine.
  const m = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return null;
  const [, oH, oM, oPeriod, cH, cM, cPeriod] = m;
  if (!oH || !cH) return null;

  const openMinutes = toMinutes(oH, oM, oPeriod);
  let closeMinutes = toMinutes(cH, cM, cPeriod);
  // Past-midnight closes: e.g. open 16:00 close 02:00 → really
  // close at 26:00 (2 AM the next day). Detect and bump.
  if (closeMinutes !== null && openMinutes !== null && closeMinutes <= openMinutes) {
    closeMinutes += 24 * 60;
  }
  if (openMinutes === null || closeMinutes === null) return null;

  return {
    open: formatHHMM(openMinutes),
    close: formatHHMM(closeMinutes),
  };
}

/** Parse "4", "04", "16" + optional ":30" minutes + optional am/pm → mins-since-midnight. */
function toMinutes(
  hStr: string,
  mStr: string | undefined,
  period: string | undefined,
): number | null {
  const h = Number.parseInt(hStr, 10);
  const m = mStr ? Number.parseInt(mStr, 10) : 0;
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  let hour = h;
  if (period) {
    const lower = period.toLowerCase();
    if (lower === "pm" && hour < 12) hour += 12;
    if (lower === "am" && hour === 12) hour = 0;
  }
  return hour * 60 + m;
}

/** Format minutes-since-midnight as "HH:MM" (or "HH:MM" with H >= 24 for past-midnight). */
function formatHHMM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// =========================================================================
// Suggested call window
// =========================================================================

export interface CallWindowSuggestion {
  /** One-line label for inline UI ("Best call: 2-3 PM"). */
  label: string;
  /** Tone hint for the rendering layer. */
  tone: "ok" | "now" | "later" | "unknown";
  /** Longer explanation for tooltip / popover. */
  detail: string;
}

/**
 * Pick a reasonable call window given parsed hours.
 *
 * Heuristic v1
 * ------------
 *   - Look at today's hours (based on the supplied `now`).
 *   - Bar/lounge/club/restaurant venue types:
 *       Best call = 1-2 hours BEFORE opening. Managers are usually
 *       on-site doing prep but not slammed with patrons.
 *   - "Open 24 hours" / no venue type signal:
 *       Default to 2-4 PM local time on a weekday — most-likely-to-
 *       reach-a-manager window.
 *   - Closed today: suggest the next open day's window.
 *   - Currently open (within today's hours): "they're open now —
 *     try calling now".
 *
 * `now` defaults to new Date() so the helper is testable; callers
 * computing this in render should pass the server time at fetch.
 *
 * Returns null when there's nothing useful to suggest (parsed=null,
 * or every day is closed + no venue type).
 */
export function suggestCallWindow(
  parsed: ParsedVenueHours | null,
  now: Date = new Date(),
  venueType?: readonly string[] | null,
): CallWindowSuggestion | null {
  if (!parsed) return null;

  if (parsed.open24) {
    return {
      label: "Best call: 2-3 PM",
      tone: "ok",
      detail: "Venue is open 24/7. Managers are most reachable mid-afternoon (2-4 PM local).",
    };
  }

  // Find today's hours. JS day-of-week 0=Sun, 1=Mon, ..., 6=Sat.
  const todayKey = DAY_KEYS[(now.getDay() + 6) % 7];
  if (!todayKey) return null;
  const today = parsed[todayKey];

  // Currently open?
  if (today && today !== "closed") {
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const openMinutes = hhmmToMinutes(today.open);
    const closeMinutes = hhmmToMinutes(today.close);
    if (openMinutes !== null && closeMinutes !== null) {
      // Open right now → recommend calling now (they're staffed)
      if (nowMinutes >= openMinutes && nowMinutes < closeMinutes) {
        return {
          label: "They're open now — call now",
          tone: "now",
          detail: `Open ${formatTimeLabel(today.open)}–${formatTimeLabel(today.close)} today. Manager is likely on-site.`,
        };
      }
      // Pre-open: suggest 1-2 hours before open
      if (nowMinutes < openMinutes) {
        const callStart = Math.max(0, openMinutes - 120);
        const callEnd = Math.max(callStart + 60, openMinutes - 60);
        return {
          label: `Best call: ${formatRangeLabel(callStart, callEnd)}`,
          tone: "ok",
          detail: `Venue opens at ${formatTimeLabel(today.open)} today. Managers are on-site doing prep 1-2 hours before opening.`,
        };
      }
      // Post-close: suggest tomorrow's window
      // Fall through to next-open-day logic below
    }
  }

  // Closed today (or post-close): find the next open day in the week.
  const nextOpen = findNextOpenDay(parsed, todayKey);
  if (nextOpen) {
    const openMinutes = hhmmToMinutes(nextOpen.day.open);
    if (openMinutes !== null) {
      const callStart = Math.max(0, openMinutes - 120);
      const callEnd = Math.max(callStart + 60, openMinutes - 60);
      const dayLabel = dayKeyLabel(nextOpen.key);
      return {
        label: `Best call ${dayLabel}: ${formatRangeLabel(callStart, callEnd)}`,
        tone: "later",
        detail: `Closed today. Venue opens ${dayLabel} at ${formatTimeLabel(nextOpen.day.open)} — call 1-2 hours before.`,
      };
    }
  }

  // Last resort — venue-type-aware default. Bars/clubs typically
  // open evening; suggest mid-afternoon for managerial reach.
  if (venueType?.some((v) => /bar|club|lounge|restaurant/i.test(v))) {
    return {
      label: "Best call: 2-3 PM",
      tone: "unknown",
      detail:
        "Hours not fully parsed. For bars/restaurants, managers are most reachable mid-afternoon.",
    };
  }

  return null;
}

/** Find the next day (from `from`, exclusive) where the venue is open. */
function findNextOpenDay(
  parsed: ParsedVenueHours,
  from: DayKey,
): { key: DayKey; day: { open: string; close: string } } | null {
  const startIdx = DAY_KEYS.indexOf(from);
  for (let i = 1; i <= 7; i++) {
    const key = DAY_KEYS[(startIdx + i) % 7];
    if (!key) continue;
    const d = parsed[key];
    if (d && d !== "closed") return { key, day: d };
  }
  return null;
}

function hhmmToMinutes(hhmm: string): number | null {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m || !m[1] || !m[2]) return null;
  const h = Number.parseInt(m[1], 10);
  const min = Number.parseInt(m[2], 10);
  if (Number.isNaN(h) || Number.isNaN(min)) return null;
  return h * 60 + min;
}

/** "16:00" → "4 PM". Handles 24+ hours by wrapping to next-day notation. */
function formatTimeLabel(hhmm: string): string {
  const mins = hhmmToMinutes(hhmm);
  if (mins === null) return hhmm;
  return formatMinutesLabel(mins);
}

function formatMinutesLabel(mins: number): string {
  const wrapped = mins % (24 * 60);
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const period = h < 12 ? "AM" : "PM";
  if (m === 0) return `${hour12} ${period}`;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

function formatRangeLabel(startMins: number, endMins: number): string {
  // Compress "2 PM - 3 PM" → "2-3 PM" when both halves share period.
  const startWrap = startMins % (24 * 60);
  const endWrap = endMins % (24 * 60);
  const startPeriod = startWrap < 12 * 60 ? "AM" : "PM";
  const endPeriod = endWrap < 12 * 60 ? "AM" : "PM";
  const sH = Math.floor(startWrap / 60);
  const eH = Math.floor(endWrap / 60);
  if (startPeriod === endPeriod) {
    const s12 = sH % 12 === 0 ? 12 : sH % 12;
    const e12 = eH % 12 === 0 ? 12 : eH % 12;
    return `${s12}-${e12} ${endPeriod}`;
  }
  return `${formatMinutesLabel(startMins)}-${formatMinutesLabel(endMins)}`;
}

function dayKeyLabel(key: DayKey): string {
  const labels: Record<DayKey, string> = {
    mon: "Monday",
    tue: "Tuesday",
    wed: "Wednesday",
    thu: "Thursday",
    fri: "Friday",
    sat: "Saturday",
    sun: "Sunday",
  };
  return labels[key];
}
