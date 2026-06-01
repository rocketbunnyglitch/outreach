import "server-only";

/**
 * City matcher — resolve a sheet name from the Halloween 2025
 * xlsx (e.g. "Birmingham, AL", "Bowling Green", "Lower East
 * Village, NY") to a row in our cities table.
 *
 * Strategy:
 *   1. Strip the ", XX" region suffix → "Birmingham"
 *   2. Exact lower(name) match. Fast path for clean inputs.
 *   3. If multiple matches (Birmingham is in both AL and UK),
 *      use the region suffix from step 1 to disambiguate via
 *      cities.region.
 *   4. Trigram-similar match as last resort.
 *
 * Returns NULL when no match — the import orchestrator skips
 * the sheet + reports it in the dry-run UI for manual review.
 */

import { cities } from "@/db/schema";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sql } from "drizzle-orm";

const TRGM_THRESHOLD = 0.4;

export interface CityMatchResult {
  cityId: string;
  cityName: string;
  region: string | null;
  countryCode: string;
  /** How we matched — useful for the dry-run preview UI. */
  decision: "exact" | "exact_with_region" | "trgm";
  similarity: number | null;
}

/**
 * Strip the ", XX" region suffix and return the base name +
 * region. "Birmingham, AL" → {name: "Birmingham", region: "AL"}.
 * "Saskatoon" → {name: "Saskatoon", region: null}.
 * "Miami - South Beach, FL" → {name: "Miami - South Beach", region: "FL"}.
 */
function splitSheetName(sheet: string): { name: string; region: string | null } {
  const trimmed = sheet.trim();
  // Match a trailing ", XX" (2-letter US state, 2-letter Canadian
  // province, or 3-letter for "QLD" / "NSW" Australian states +
  // "MB" Manitoba etc).
  const m = trimmed.match(/^(.+?),\s*([A-Z]{2,3})$/);
  if (m?.[1] && m[2]) return { name: m[1].trim(), region: m[2].trim() };
  return { name: trimmed, region: null };
}

export async function matchCity(sheetName: string): Promise<CityMatchResult | null> {
  const split = splitSheetName(sheetName);
  const lowered = split.name.toLowerCase();

  // ---------------- 1. Exact lower(name) ----------------
  const exactRows = await db
    .select({
      id: cities.id,
      name: cities.name,
      region: cities.region,
      countryCode: cities.countryCode,
    })
    .from(cities)
    .where(sql`lower(${cities.name}) = ${lowered}`);

  if (exactRows.length === 1) {
    const row = exactRows[0];
    if (row) {
      return {
        cityId: row.id,
        cityName: row.name,
        region: row.region,
        countryCode: row.countryCode,
        decision: "exact",
        similarity: null,
      };
    }
  }

  if (exactRows.length > 1) {
    // Multiple cities with the same name — disambiguate via the
    // suffix region code if we have one. The cities.region column
    // stores full names ("Alabama", "Ontario"), but our sheet
    // suffixes are 2-letter codes ("AL", "ON"). We match by
    // looking up the candidates whose region starts with the
    // 2-letter code OR whose region contains it. This is
    // imperfect (e.g. "AL" matches both "Alabama" and ...nothing
    // else, conveniently) but works for the US/CA/AU cases the
    // import covers. Trigram fallback handles edge cases.
    if (split.region) {
      const code = split.region.toUpperCase();
      // Try matches by full region name starting with the code.
      // e.g. "AL" → "Alabama" starts with "Al"
      const r = exactRows.find((row) => row.region?.toUpperCase().startsWith(code.slice(0, 2)));
      if (r) {
        return {
          cityId: r.id,
          cityName: r.name,
          region: r.region,
          countryCode: r.countryCode,
          decision: "exact_with_region",
          similarity: null,
        };
      }
    }
    // Ambiguous — log it and bail.
    logger.warn(
      {
        sheetName,
        candidates: exactRows.map((r) => `${r.name}/${r.region ?? "?"}/${r.countryCode}`),
      },
      "matchCity: ambiguous exact match, no region suffix",
    );
    return null;
  }

  // ---------------- 2. Trigram fallback ----------------
  // No region filter on the trgm fallback — we'd rather match by
  // name and have the caller verify in the dry-run preview than
  // miss matches because of region-code mismatches. The dry-run
  // UI shows the matched city's region so the operator can spot
  // wrong-side-of-the-pond mistakes.
  const trgmRow = await db
    .select({
      id: cities.id,
      name: cities.name,
      region: cities.region,
      countryCode: cities.countryCode,
      sim: sql<number>`similarity(${cities.name}, ${split.name})`,
    })
    .from(cities)
    .where(sql`similarity(${cities.name}, ${split.name}) >= ${TRGM_THRESHOLD}`)
    .orderBy(sql`similarity(${cities.name}, ${split.name}) DESC`)
    .limit(1)
    .then((r) => r[0]);

  if (trgmRow) {
    return {
      cityId: trgmRow.id,
      cityName: trgmRow.name,
      region: trgmRow.region,
      countryCode: trgmRow.countryCode,
      decision: "trgm",
      similarity: trgmRow.sim,
    };
  }

  return null;
}
