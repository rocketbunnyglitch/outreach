import * as chrono from "chrono-node";

/**
 * Lightweight date detector for cold-outreach remarks.
 *
 * Distinct from lib/smart-notes.ts's extractActionsFromNote, which
 * requires an action VERB (call / email / follow up) before it parses
 * a date. Operators writing quick remarks don't use verbs — they type
 * "wants meeting at 3pm" or "wants a call Tue 7pm". The operator's
 * session-12 feedback: "it's not smart like Fantastical — I put
 * 'wants meeting at 3pm' and it didn't do anything."
 *
 * So this detector fires on ANY future-dated time phrase, no verb
 * required. It returns a single suggestion (the most prominent date)
 * or null.
 *
 * Runs server-side only (chrono stays out of the client bundle). The
 * cold-outreach remarks save action calls this and returns the result
 * to the client, which renders a "Schedule follow-up: <when>" chip.
 */

export interface RemarkFollowUp {
  /** Parsed due time as ISO 8601 (UTC). */
  dueAtIso: string;
  /** Human label for the chip, e.g. "Tue, Jul 8 · 7:00 PM". */
  label: string;
  /** The phrase chrono matched, e.g. "at 3pm" — shown for transparency. */
  matchedText: string;
}

/**
 * Detect a future-dated time phrase in the remark text.
 *
 * @param text     the remark body
 * @param timezone IANA tz for interpreting bare times ("3pm" → 3pm in
 *                 the VENUE's local time, not the server's)
 * @param refDate  reference "now" — injectable for tests
 */
export function detectRemarkFollowUp(
  text: string,
  timezone: string,
  refDate: Date = new Date(),
): RemarkFollowUp | null {
  const trimmed = text.trim();
  if (trimmed.length < 3) return null;

  // chrono parses bare times ("3pm") in the parse reference's
  // timezone. chrono-node 2.x takes the timezone as an OFFSET IN
  // MINUTES (not an IANA string), so we compute the venue's offset
  // at the reference instant and pass it. Without this, "3pm" would
  // resolve to 3pm in the SERVER's timezone (UTC in prod) — wrong
  // for a venue in Toronto or Manila.
  const offsetMinutes = tzOffsetMinutes(timezone, refDate);

  // forwardDate: true → "at 3pm" when it's already 5pm resolves to
  // tomorrow 3pm, not today (past). Matches operator intent: they're
  // scheduling something upcoming.
  const results = chrono.parse(
    trimmed,
    { instant: refDate, timezone: offsetMinutes },
    { forwardDate: true },
  );
  if (results.length === 0) return null;

  // Use the first (most prominent) result. chrono returns them in
  // document order; the first time phrase in a short remark is almost
  // always the intended one.
  const first = results[0];
  if (!first) return null;

  const date = first.start.date();
  if (Number.isNaN(date.getTime())) return null;

  // Guard: ignore matches that resolve to the past (forwardDate
  // usually prevents this, but a fully-specified past date like
  // "Jan 1 2020" could slip through). A follow-up in the past is
  // never useful.
  if (date.getTime() < refDate.getTime() - 60_000) return null;

  // Guard: ignore absurdly far-future matches (chrono sometimes reads
  // a bare number like "200" as a year). Cap at ~2 years out.
  const twoYearsMs = 1000 * 60 * 60 * 24 * 365 * 2;
  if (date.getTime() > refDate.getTime() + twoYearsMs) return null;

  // Build a friendly label in the venue's timezone. If chrono knew the
  // time-of-day (a "3pm" was present), include it; otherwise just the
  // date.
  const knownTime = first.start.isCertain("hour");
  const label = formatLabel(date, timezone, knownTime);

  return {
    dueAtIso: date.toISOString(),
    label,
    matchedText: first.text,
  };
}

function formatLabel(date: Date, timezone: string, withTime: boolean): string {
  try {
    const datePart = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: timezone,
    }).format(date);
    if (!withTime) return datePart;
    const timePart = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone,
    }).format(date);
    return `${datePart} · ${timePart}`;
  } catch {
    // Bad timezone string — fall back to ISO date.
    return date
      .toISOString()
      .slice(0, withTime ? 16 : 10)
      .replace("T", " ");
  }
}

/**
 * UTC offset in minutes for an IANA timezone at a given instant
 * (DST-aware). Positive = ahead of UTC (e.g. Manila +480), negative =
 * behind (e.g. Toronto EDT -240). chrono-node 2.x wants the parse
 * reference timezone as this offset, not an IANA string.
 */
function tzOffsetMinutes(timeZone: string, at: Date): number {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const map: Record<string, string> = {};
    for (const p of dtf.formatToParts(at)) map[p.type] = p.value;
    const asUTC = Date.UTC(
      Number(map.year),
      Number(map.month) - 1,
      Number(map.day),
      Number(map.hour),
      Number(map.minute),
      Number(map.second),
    );
    return Math.round((asUTC - at.getTime()) / 60000);
  } catch {
    return 0; // UTC fallback on bad tz
  }
}
