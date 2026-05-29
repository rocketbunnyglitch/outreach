/**
 * city-name-match — fuzzy match a raw city name (potentially with a
 * region/state hint) against the master cities table.
 *
 * Designed for CSV import where the operator pasted a list like:
 *   Toronto, ON
 *   buffalo,ny
 *   new york (with extra spaces)
 *   sf
 *
 * Decision #026: auto-accept unambiguous matches, surface ambiguous
 * ones for manual review, skip-and-log zero matches.
 *
 * Algorithm
 * ---------
 *   1. Normalize the input — lowercase, collapse whitespace, strip
 *      punctuation. Split on comma to extract an optional region hint.
 *   2. Pass 1 (exact): normalized input matches a city's normalized
 *      name exactly. If a region hint was provided, require that too.
 *      Single result → confidence 'high'.
 *   3. Pass 2 (single Levenshtein-1): exactly one city is within edit
 *      distance 1 of the normalized input. Single result → 'high'.
 *   4. Pass 3 (case-insensitive substring): the normalized input is
 *      a prefix or contained substring of one or more city names.
 *      Single result → 'high'. Multiple → 'ambiguous' (show all
 *      candidates for review).
 *   5. None of the above → 'not_found'.
 *
 * High-confidence matches auto-commit. Ambiguous matches surface as
 * a per-row review panel ("Accept this suggestion" or "Pick another").
 * Not-found rows are listed at the bottom of the import preview so
 * the operator knows what wasn't imported.
 *
 * This module is pure / no DB — the candidate list is passed in from
 * the caller. That keeps it client-bundle-safe (CLAUDE.md §12.2)
 * AND fast to test.
 */

export interface CityCandidate {
  id: string;
  name: string;
  region: string | null;
}

export type MatchConfidence = "high" | "ambiguous" | "not_found";

export interface MatchResult {
  /** What the operator wrote. Preserved for the review UI. */
  rawInput: string;
  confidence: MatchConfidence;
  /** When 'high', the single best match. When 'ambiguous', the top 5. */
  candidates: CityCandidate[];
  /** For diagnostic UI ('matched on exact', 'matched on Levenshtein-1'). */
  matchedOn?: "exact" | "exact_region" | "levenshtein_1" | "substring";
}

/**
 * Normalize for comparison: lowercase, trim, collapse internal
 * whitespace, strip punctuation. Keeps letters, digits, and the
 * single space.
 *
 *   "  New  York,  NY  " → "new york"
 *   "Mt. Vernon"         → "mt vernon"
 */
export function normalizeCityName(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[.,;:!?()'"\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Compute Levenshtein distance with an early-exit bail.
 *
 * For our use we only care about distance ≤ 1, so we early-out when
 * the running minimum row value exceeds 1. This makes the function
 * effectively O(n) when comparing a typed name against many cities,
 * which matters for CSVs of 50+ rows × 1000 cities = 50k comparisons.
 *
 * Inputs assumed already normalized (caller's responsibility).
 */
function levenshteinAtMost(a: string, b: string, maxDistance: number): number {
  if (a === b) return 0;
  const aLen = a.length;
  const bLen = b.length;
  if (Math.abs(aLen - bLen) > maxDistance) return maxDistance + 1;
  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;

  let prev = new Array(bLen + 1);
  let curr = new Array(bLen + 1);
  for (let j = 0; j <= bLen; j++) prev[j] = j;

  for (let i = 1; i <= aLen; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= bLen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1, // insertion
        prev[j] + 1, // deletion
        prev[j - 1] + cost, // substitution
      );
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    // Early exit: if the entire row is already > maxDistance, the
    // final cell will be too.
    if (rowMin > maxDistance) return maxDistance + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[bLen];
}

/**
 * Parse a raw input line into { name, regionHint }.
 *
 *   "Toronto, ON"   → { name: 'toronto', regionHint: 'on' }
 *   "buffalo,ny"    → { name: 'buffalo', regionHint: 'ny' }
 *   "Chicago"       → { name: 'chicago', regionHint: null }
 */
function parseInput(raw: string): { name: string; regionHint: string | null } {
  const cleaned = normalizeCityName(raw);
  // Look for the FIRST comma after the city name. The original raw
  // may have had a comma; the normalize step turned commas into spaces,
  // so we re-check the raw string for a comma position.
  const commaIdx = raw.indexOf(",");
  if (commaIdx === -1) return { name: cleaned, regionHint: null };
  const nameOnly = normalizeCityName(raw.slice(0, commaIdx));
  const regionPart = normalizeCityName(raw.slice(commaIdx + 1));
  if (!regionPart) return { name: nameOnly, regionHint: null };
  return { name: nameOnly, regionHint: regionPart };
}

/**
 * Match a raw line against the candidate cities. Pure function — call
 * once per CSV row, with the same `cities` list each time.
 */
export function matchCity(rawInput: string, cities: CityCandidate[]): MatchResult {
  const { name, regionHint } = parseInput(rawInput);
  if (!name) return { rawInput, confidence: "not_found", candidates: [] };

  const normalizedCities = cities.map((c) => ({
    candidate: c,
    nameNorm: normalizeCityName(c.name),
    regionNorm: c.region ? normalizeCityName(c.region) : null,
  }));

  // Pass 1: exact match
  const exactMatches = normalizedCities.filter((c) => c.nameNorm === name);
  if (exactMatches.length === 1) {
    const [only] = exactMatches;
    if (only) {
      return {
        rawInput,
        confidence: "high",
        candidates: [only.candidate],
        matchedOn: "exact",
      };
    }
  }
  if (exactMatches.length > 1 && regionHint) {
    // Multiple Springfields — region disambiguates
    const withRegion = exactMatches.filter(
      (c) => c.regionNorm === regionHint || c.regionNorm?.startsWith(regionHint),
    );
    if (withRegion.length === 1) {
      const [only] = withRegion;
      if (only) {
        return {
          rawInput,
          confidence: "high",
          candidates: [only.candidate],
          matchedOn: "exact_region",
        };
      }
    }
    if (withRegion.length > 1) {
      return {
        rawInput,
        confidence: "ambiguous",
        candidates: withRegion.slice(0, 5).map((c) => c.candidate),
        matchedOn: "exact_region",
      };
    }
    // Region hint didn't help — surface ALL the exact-name matches for review
    return {
      rawInput,
      confidence: "ambiguous",
      candidates: exactMatches.slice(0, 5).map((c) => c.candidate),
      matchedOn: "exact",
    };
  }
  if (exactMatches.length > 1) {
    return {
      rawInput,
      confidence: "ambiguous",
      candidates: exactMatches.slice(0, 5).map((c) => c.candidate),
      matchedOn: "exact",
    };
  }

  // Pass 2: Levenshtein distance ≤ 1
  const levenMatches = normalizedCities.filter((c) => levenshteinAtMost(c.nameNorm, name, 1) <= 1);
  if (levenMatches.length === 1) {
    const [only] = levenMatches;
    if (only) {
      return {
        rawInput,
        confidence: "high",
        candidates: [only.candidate],
        matchedOn: "levenshtein_1",
      };
    }
  }
  if (levenMatches.length > 1) {
    return {
      rawInput,
      confidence: "ambiguous",
      candidates: levenMatches.slice(0, 5).map((c) => c.candidate),
      matchedOn: "levenshtein_1",
    };
  }

  // Pass 3: substring (input contained in city name)
  const substrMatches = normalizedCities.filter((c) => c.nameNorm.includes(name));
  if (substrMatches.length === 1) {
    const [only] = substrMatches;
    if (only) {
      return {
        rawInput,
        confidence: "high",
        candidates: [only.candidate],
        matchedOn: "substring",
      };
    }
  }
  if (substrMatches.length > 1 && substrMatches.length <= 5) {
    return {
      rawInput,
      confidence: "ambiguous",
      candidates: substrMatches.map((c) => c.candidate),
      matchedOn: "substring",
    };
  }
  return { rawInput, confidence: "not_found", candidates: [] };
}

/**
 * Parse a CSV-ish input into rows. Lenient — accepts:
 *   - One city name per line
 *   - `name, priority` (priority becomes the per-row priority)
 *   - `name, region, priority` (region appended to name for matching)
 *   - Empty lines skipped
 *   - Header row optional — we don't enforce one
 *
 * The 'priority' column is opt-in. If a row has 2 columns, the second
 * is treated as priority if it's a number 1-10, else as region.
 *
 * Returns an array of { line, priority, eventDate, crawlNumber } — when
 * a token in YYYY-MM-DD form is present in the row, the parser switches
 * to extended mode and also extracts the crawl number (1-9) if a
 * matching token follows the date. The `line` is always the
 * city-name-bearing prefix passed to matchCity().
 *
 * Supported layouts (per line):
 *   City                          — legacy
 *   City, Region                  — legacy
 *   City, Priority                — legacy
 *   City, Region, Priority        — legacy
 *   City, Priority, Date          — new (extended)
 *   City, Priority, Date, Crawl   — new (extended)
 *   City, Region, Priority, Date  — new (extended, region preserved)
 *   City, Region, Priority, Date, Crawl
 *
 * Tab-separated input also works because we split on either tab or comma.
 */
export function parseBulkCityCsv(input: string): Array<{
  line: string;
  priority: number | null;
  eventDate: string | null;
  crawlNumber: number | null;
}> {
  const rows: Array<{
    line: string;
    priority: number | null;
    eventDate: string | null;
    crawlNumber: number | null;
  }> = [];
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  for (const rawLine of input.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Accept comma OR tab as a separator so spreadsheet copy-paste works.
    const parts = trimmed.split(/[,\t]/).map((s) => s.trim());

    if (parts.length === 1) {
      rows.push({ line: trimmed, priority: null, eventDate: null, crawlNumber: null });
      continue;
    }

    // Find a date token. If present, parse the row in extended mode.
    const dateIdx = parts.findIndex((p) => DATE_RE.test(p));

    if (dateIdx !== -1) {
      const eventDate = parts[dateIdx] ?? null;
      // After the date, an optional crawl number (single digit 1-9).
      let crawlNumber: number | null = null;
      const after = parts.slice(dateIdx + 1);
      if (after.length > 0 && after[0] && /^[1-9]$/.test(after[0])) {
        crawlNumber = Number.parseInt(after[0], 10);
      }
      // Before the date, a priority (1-10) MAY sit at the last position
      // — strip it off if so. Everything remaining is the city + region.
      const before = parts.slice(0, dateIdx);
      let priority: number | null = null;
      if (before.length >= 2) {
        const last = before[before.length - 1] ?? "";
        const n = Number.parseInt(last, 10);
        if (Number.isFinite(n) && n >= 1 && n <= 10 && /^\d{1,2}$/.test(last)) {
          priority = n;
          before.pop();
        }
      }
      const line = before.join(", ");
      rows.push({ line, priority, eventDate, crawlNumber });
      continue;
    }

    // Legacy path — no date in the row. Last part: is it a number 1-10?
    const last = parts[parts.length - 1] ?? "";
    const asInt = Number.parseInt(last, 10);
    const lastIsPriority =
      Number.isFinite(asInt) && asInt >= 1 && asInt <= 10 && /^\d{1,2}$/.test(last);

    if (lastIsPriority) {
      const linePart = parts.slice(0, -1).join(", ");
      rows.push({ line: linePart, priority: asInt, eventDate: null, crawlNumber: null });
    } else {
      rows.push({ line: trimmed, priority: null, eventDate: null, crawlNumber: null });
    }
  }
  return rows;
}
