import "server-only";

/**
 * Resolver override map — pre-computed (sourceCity, sourceVenueName)
 * → correct venueId mappings that the venue resolver consults
 * BEFORE exact/trgm matching.
 *
 * Why this exists
 * ---------------
 * After the initial Halloween 2025 import, the operator ran a
 * Claude-in-Chrome verify pass that found two classes of mistakes:
 *
 *   1. WRONG-MATCH RELINKS (29 cases) — the resolver's trgm
 *      matcher picked the wrong existing venue for an xlsx row
 *      (e.g. matched "Oz New Orleans" to a different "Oz" venue).
 *      The operator created the correct venue + repointed the
 *      cold_outreach_entries.
 *
 *   2. MULTI-MATCH SPLITS (16 cases) — one ambiguous existing
 *      venue actually represented multiple distinct businesses.
 *      The operator created separate venues + repointed.
 *
 * Without the override map, re-running the import would re-fuzzy-
 * match those 45 source rows back to the wrong venues, undoing the
 * fix and backfilling onto the wrong row.
 *
 * The override map (loaded from a per-campaign JSON file) short-
 * circuits the resolver: for any (city, venueName) pair in the
 * map, the resolver returns the override target venueId directly
 * without running exact or trgm matching.
 *
 * Per-campaign: each campaign import passes its own overrides
 * file (e.g. `data/halloween_2025_resolver_overrides.json` for the
 * Halloween 2025 re-run). Phase 2 campaigns (SPD 2026, NYE 2026,
 * legacy 2024/2025) start with empty overrides and accumulate
 * them as verify passes complete.
 *
 * File shape
 * ----------
 *   {
 *     "_doc": "...",
 *     "map":  { "Calgary, AB||LVL Three Bar & Lounge": "uuid", ... },
 *     "rows": [
 *       { sourceCity, sourceVenueName, oldWrongVenueId,
 *         newRightVenueId, newVenueName }, ...
 *     ]
 *   }
 *
 * We build the lookup from `rows` (not `map` keys) to control
 * normalization — sourceCity + sourceVenueName are independent
 * fields in `rows`, so we lower(trim()) each before joining with
 * the `||` separator. The `map` keys use the canonical-case
 * version and could miss matches if the xlsx data drifts.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { logger } from "@/lib/logger";

interface OverrideRow {
  sourceCity: string;
  sourceVenueName: string;
  oldWrongVenueId: string;
  newRightVenueId: string;
  newVenueName: string;
}

interface OverrideFile {
  _doc?: string;
  map?: Record<string, string>;
  rows: OverrideRow[];
}

export interface ResolverOverrides {
  /** Number of overrides loaded. Useful for the dry-run report. */
  size: number;
  /** Returns the target venue id for the given source pair, or null
   *  if no override exists. */
  lookup(sourceCity: string, sourceVenueName: string): string | null;
  /** The raw row for debug / audit output. Useful in the dry-run UI
   *  to show "this venue was redirected by the override map." */
  lookupRow(sourceCity: string, sourceVenueName: string): OverrideRow | null;
}

const EMPTY: ResolverOverrides = {
  size: 0,
  lookup: () => null,
  lookupRow: () => null,
};

/**
 * Normalize a (city, name) pair to a lookup key. Lowercases + trims
 * both sides so the same source row matches regardless of whitespace
 * or case drift between xlsx exports.
 */
function makeKey(city: string, name: string): string {
  return `${city.trim().toLowerCase()}||${name.trim().toLowerCase()}`;
}

/**
 * Load the overrides JSON from disk + return a ready-to-query lookup.
 * Returns the EMPTY singleton when the file doesn't exist (e.g.
 * fresh campaigns that haven't had a verify pass yet) — this means
 * `loadResolverOverrides` is safe to call unconditionally.
 *
 * The file resolution mirrors the import JSON's resolveJsonPath:
 *   1. The supplied absolute path
 *   2. <cwd>/<relative path>
 *   3. <cwd>/../<relative path>  (standalone-build adjacency)
 *
 * Any read or parse error degrades gracefully to EMPTY with a
 * logger.warn — we'd rather skip the override layer than crash the
 * import.
 */
export async function loadResolverOverrides(relativePath: string): Promise<ResolverOverrides> {
  const candidates = [
    relativePath,
    path.join(process.cwd(), relativePath),
    path.join(process.cwd(), "..", relativePath),
    path.join(process.cwd(), ".next", "standalone", relativePath),
  ];

  let resolved: string | null = null;
  for (const c of candidates) {
    try {
      await fs.access(c);
      resolved = c;
      break;
    } catch {
      // try next
    }
  }

  if (!resolved) {
    logger.info(
      { relativePath, tried: candidates },
      "resolver-overrides: no file found — running without overrides",
    );
    return EMPTY;
  }

  let parsed: OverrideFile;
  try {
    const raw = await fs.readFile(resolved, "utf-8");
    parsed = JSON.parse(raw) as OverrideFile;
  } catch (err) {
    logger.warn(
      { err, resolved },
      "resolver-overrides: failed to parse — running without overrides",
    );
    return EMPTY;
  }

  if (!Array.isArray(parsed.rows)) {
    logger.warn({ resolved }, "resolver-overrides: malformed file (no rows array)");
    return EMPTY;
  }

  // Build the normalized lookup map. Use `rows` (not `parsed.map`)
  // so we control normalization — see module docstring.
  const lookup = new Map<string, OverrideRow>();
  for (const row of parsed.rows) {
    if (!row.sourceCity || !row.sourceVenueName || !row.newRightVenueId) continue;
    const key = makeKey(row.sourceCity, row.sourceVenueName);
    lookup.set(key, row);
  }

  logger.info({ resolved, size: lookup.size }, "resolver-overrides: loaded");

  return {
    size: lookup.size,
    lookup(sourceCity, sourceVenueName) {
      const k = makeKey(sourceCity, sourceVenueName);
      return lookup.get(k)?.newRightVenueId ?? null;
    },
    lookupRow(sourceCity, sourceVenueName) {
      const k = makeKey(sourceCity, sourceVenueName);
      return lookup.get(k) ?? null;
    },
  };
}
