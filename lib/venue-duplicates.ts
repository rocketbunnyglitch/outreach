/**
 * Duplicate venue detection.
 *
 * When an operator is about to create a venue, we check whether the engine
 * already has anything similar. Trigram similarity catches:
 *   "Drake Hotel" vs "The Drake Hotel"
 *   "Lansons Tap" vs "Lansons Tap & Brewery"
 *   "Coda" vs "Coda Lounge"
 *
 * pg_trgm's `similarity` function returns 0..1. We surface anything ≥ 0.4
 * which empirically catches near-duplicates without flooding the operator
 * with unrelated matches.
 *
 * The migration in 0004_pg_trgm.sql creates the GIN indexes that make
 * this fast on large venue tables.
 */

import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export interface VenueDuplicate {
  id: string;
  name: string;
  address: string | null;
  cityId: string;
  cityName: string;
  /** 0..1, higher = more similar. */
  nameSimilarity: number;
  /** 0..1, higher = more similar; 0 if no address given. */
  addressSimilarity: number;
  /** Highest similarity score, used for sorting + thresholding. */
  bestScore: number;
  /** Whether DNC flag is set — even if similar, operator probably shouldn't recreate. */
  doNotContact: boolean;
}

/**
 * Find venues that might be duplicates of a candidate (name + optional
 * address). Returns at most `limit` matches above the similarity threshold,
 * sorted by best score descending.
 *
 * If cityId is supplied, restricts the search to that city — duplicates
 * with the same name in different cities are usually legitimately different
 * venues (chain restaurants, etc.).
 */
export async function findVenueDuplicates(opts: {
  candidateName: string;
  candidateAddress?: string | null;
  cityId?: string | null;
  threshold?: number;
  limit?: number;
}): Promise<VenueDuplicate[]> {
  const {
    candidateName,
    candidateAddress = null,
    cityId = null,
    threshold = 0.4,
    limit = 8,
  } = opts;

  if (candidateName.trim().length < 2) return [];

  // Address similarity is OR'd into the match — if either is highly
  // similar, surface it. GREATEST() lets the trigram index do its job on
  // whichever expression matches.
  const rows = await db.execute<{
    id: string;
    name: string;
    address: string | null;
    city_id: string;
    city_name: string;
    name_sim: number;
    address_sim: number;
    do_not_contact: boolean;
  }>(sql`
    SELECT
      v.id,
      v.name,
      v.address,
      v.city_id,
      c.name AS city_name,
      similarity(v.name, ${candidateName}) AS name_sim,
      COALESCE(similarity(v.address, ${candidateAddress ?? ""}), 0) AS address_sim,
      v.do_not_contact
    FROM venues v
    INNER JOIN cities c ON c.id = v.city_id
    WHERE v.archived_at IS NULL
      ${cityId ? sql`AND v.city_id = ${cityId}` : sql``}
      AND (
        similarity(v.name, ${candidateName}) >= ${threshold}
        ${candidateAddress ? sql`OR similarity(v.address, ${candidateAddress}) >= ${threshold}` : sql``}
      )
    ORDER BY GREATEST(
      similarity(v.name, ${candidateName}),
      COALESCE(similarity(v.address, ${candidateAddress ?? ""}), 0)
    ) DESC
    LIMIT ${limit}
  `);

  // db.execute returns either an array or { rows: [...] } depending on driver.
  // Normalize without using  (biome rule).
  type Row = {
    id: string;
    name: string;
    address: string | null;
    city_id: string;
    city_name: string;
    name_sim: number;
    address_sim: number;
    do_not_contact: boolean;
  };
  const list: Row[] = Array.isArray(rows)
    ? (rows as unknown as Row[])
    : ((rows as unknown as { rows: Row[] }).rows ?? []);

  return list.map((r) => {
    const nameSim = Number(r.name_sim);
    const addressSim = Number(r.address_sim);
    return {
      id: r.id,
      name: r.name,
      address: r.address,
      cityId: r.city_id,
      cityName: r.city_name,
      nameSimilarity: nameSim,
      addressSimilarity: addressSim,
      bestScore: Math.max(nameSim, addressSim),
      doNotContact: r.do_not_contact,
    };
  });
}
