/**
 * Pure time math for the crawl-night HOURS gantt (no db, no server-only —
 * unit-tested directly).
 *
 * Crawl nights span midnight, so everything is normalized to "crawl
 * minutes": minutes from noon-anchored evening time. 19:30 -> 1170,
 * 23:30 -> 1410, 1:00am -> 1500 (25:00). Convention for BARE numbers in
 * operator-typed ranges ("7:30-10:30", "11:30-2:00"):
 *   - 7..11  -> PM (evening)
 *   - 12     -> midnight (24:00)
 *   - 1..6   -> after midnight
 * Explicit am/pm overrides ("8:30pm", "1am"). End <= start after
 * normalization gets +12h once more (handles "9-12" typed as 9pm-12am).
 */

export interface CrawlSpan {
  /** Minutes since 00:00 of the crawl DAY, may exceed 1440 (past midnight). */
  startMin: number;
  endMin: number;
}

/** "8:30pm" / "11:30" / "9" -> crawl minutes, or null. */
function parseClock(raw: string): number | null {
  const m = raw
    .trim()
    .toLowerCase()
    .match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h < 1 || h > 12 || min > 59) return null;
  const suffix = m[3]?.replace(/\./g, "");

  if (suffix === "pm") {
    if (h !== 12) h += 12; // 8:30pm -> 20:30; 12pm (noon) stays 12 — rare but honest
  } else if (suffix === "am") {
    if (h === 12)
      h = 24; // 12am -> midnight
    else h += 24; // 1am..6am -> past midnight; 7am+ is nonsense for a crawl but harmless
  } else {
    // Bare number: evening convention.
    if (h === 12) h = 24;
    else if (h <= 6) h += 24;
    else h += 12; // 7..11 -> pm
  }
  return h * 60 + min;
}

/** Parse an operator-typed range like "8:30pm-11:30pm" / "11:30-2:00".
 *  Returns null when the text isn't a recognizable range. */
export function parseAgreedHours(text: string | null | undefined): CrawlSpan | null {
  if (!text) return null;
  const m = text.trim().match(/^(.+?)\s*(?:-|–|—|to|until)\s*(.+?)$/i);
  if (!m) return null;
  const start = parseClock(m[1] as string);
  let end = parseClock(m[2] as string);
  if (start == null || end == null) return null;
  // "9-12" already handled by bare rules; if end still <= start, the end is
  // past midnight relative to the start (e.g. "10pm-1" mis-suffixed).
  if (end <= start) end += 12 * 60;
  if (end <= start) return null;
  // Sanity: a slot longer than 12h is a parse artifact, not a booking.
  if (end - start > 12 * 60) return null;
  return { startMin: start, endMin: end };
}

/** Normalize a postgres TIME string ("21:00:00") to crawl minutes —
 *  hours before noon are treated as past midnight. */
export function timeToCrawlMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const m = time.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 12) h += 24;
  return h * 60 + min;
}

/** "8:30 PM" style label from crawl minutes. */
export function crawlMinutesLabel(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const min = minutes % 60;
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return min === 0 ? `${h12} ${ampm}` : `${h12}:${String(min).padStart(2, "0")} ${ampm}`;
}

export interface CoverageGap {
  startMin: number;
  endMin: number;
}

/** Gaps in CONFIRMED coverage between the first and last confirmed bar.
 *  Spans are merged first, so nested/overlapping slots never fake a gap. */
export function findCoverageGaps(spans: CrawlSpan[]): CoverageGap[] {
  if (spans.length < 2) return [];
  const sorted = [...spans].sort((a, b) => a.startMin - b.startMin);
  const gaps: CoverageGap[] = [];
  let coveredUntil = (sorted[0] as CrawlSpan).endMin;
  for (const s of sorted.slice(1)) {
    if (s.startMin > coveredUntil) {
      gaps.push({ startMin: coveredUntil, endMin: s.startMin });
    }
    coveredUntil = Math.max(coveredUntil, s.endMin);
  }
  return gaps;
}
