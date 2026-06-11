/**
 * Duplicate venue detection — v2 (CRM plan D1).
 *
 * Layered matching, strongest first:
 *   1. HARD KEYS (exact, normalized): phone E.164, email (lowercased),
 *      website domain (host minus www). A hard-key hit is near-certain —
 *      two venues sharing a phone number are the same bar or the same
 *      owner. (google_place_id needs no matcher: the column has a UNIQUE
 *      constraint, so a place-id duplicate cannot even be created.)
 *   2. TRIGRAM similarity on name/address within the same city — catches
 *      "Drake Hotel" vs "The Drake Hotel" (threshold 0.4, pg_trgm GIN
 *      indexes from migration 0004).
 *
 * Decisions are remembered (venue_duplicate_decisions, migration 0138):
 * when `subjectVenueId` is passed, pairs a human already ruled
 * not_duplicate / same_org are filtered out — no re-warning, ever.
 */

import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export interface VenueDuplicate {
  id: string;
  name: string;
  address: string | null;
  cityId: string;
  cityName: string;
  /** 0..1, higher = more similar. 1 for hard-key matches. */
  nameSimilarity: number;
  /** 0..1, higher = more similar; 0 if no address given. */
  addressSimilarity: number;
  /** Highest similarity score, used for sorting + thresholding. */
  bestScore: number;
  /** Why this surfaced, operator-readable ("same phone number",
   *  "similar name"). Hard keys rank above trigram. */
  matchReasons: string[];
  /** Whether DNC flag is set — even if similar, operator probably shouldn't recreate. */
  doNotContact: boolean;
}

/** "https://www.TheDrake.com/path" -> "thedrake.com"; null when unparseable. */
export function normalizeWebsiteDomain(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  try {
    const host = new URL(url.includes("://") ? url : `https://${url}`).hostname.toLowerCase();
    const stripped = host.replace(/^www\./, "");
    return stripped.includes(".") ? stripped : null;
  } catch {
    return null;
  }
}

type Row = {
  id: string;
  name: string;
  address: string | null;
  city_id: string;
  city_name: string;
  name_sim: number;
  address_sim: number;
  do_not_contact: boolean;
  phone_match: boolean;
  email_match: boolean;
  domain_match: boolean;
};

function rowsOf(res: unknown): Row[] {
  return Array.isArray(res)
    ? (res as unknown as Row[])
    : ((res as unknown as { rows: Row[] }).rows ?? []);
}

/**
 * Find venues that might be duplicates of a candidate. Hard-key matches
 * (phone/email/domain) surface regardless of city; trigram matches are
 * restricted to `cityId` when supplied (same-name venues in different
 * cities are usually legitimately different — chains).
 *
 * `subjectVenueId`: when checking an EXISTING venue (the venue-page
 * Duplicates card), excludes the venue itself and every pair a human
 * already ruled on.
 */
export async function findVenueDuplicates(opts: {
  candidateName: string;
  candidateAddress?: string | null;
  candidatePhoneE164?: string | null;
  candidateEmail?: string | null;
  candidateWebsiteUrl?: string | null;
  cityId?: string | null;
  subjectVenueId?: string | null;
  threshold?: number;
  limit?: number;
}): Promise<VenueDuplicate[]> {
  const {
    candidateName,
    candidateAddress = null,
    cityId = null,
    subjectVenueId = null,
    threshold = 0.4,
    limit = 8,
  } = opts;
  const phone = opts.candidatePhoneE164?.trim() || null;
  const email = opts.candidateEmail?.trim().toLowerCase() || null;
  const domain = normalizeWebsiteDomain(opts.candidateWebsiteUrl);

  if (candidateName.trim().length < 2 && !phone && !email && !domain) return [];

  const rows = rowsOf(
    await db.execute(sql`
      SELECT
        v.id,
        v.name,
        v.address,
        v.city_id,
        c.name AS city_name,
        similarity(v.name, ${candidateName}) AS name_sim,
        COALESCE(similarity(v.address, ${candidateAddress ?? ""}), 0) AS address_sim,
        v.do_not_contact,
        (${phone}::text IS NOT NULL AND v.phone_e164 = ${phone}) AS phone_match,
        (${email}::text IS NOT NULL AND lower(v.email) = ${email}) AS email_match,
        (${domain}::text IS NOT NULL AND
          regexp_replace(lower(COALESCE(v.website_url, '')), '^https?://(www\\.)?', '')
            LIKE ${domain ? `${domain}%` : " "}) AS domain_match
      FROM venues v
      INNER JOIN cities c ON c.id = v.city_id
      WHERE v.archived_at IS NULL
        ${subjectVenueId ? sql`AND v.id <> ${subjectVenueId}` : sql``}
        AND (
          (${phone}::text IS NOT NULL AND v.phone_e164 = ${phone})
          OR (${email}::text IS NOT NULL AND lower(v.email) = ${email})
          OR (${domain}::text IS NOT NULL AND
              regexp_replace(lower(COALESCE(v.website_url, '')), '^https?://(www\\.)?', '')
                LIKE ${domain ? `${domain}%` : " "})
          OR (
            ${cityId ? sql`v.city_id = ${cityId} AND` : sql``}
            (
              similarity(v.name, ${candidateName}) >= ${threshold}
              ${candidateAddress ? sql`OR similarity(v.address, ${candidateAddress}) >= ${threshold}` : sql``}
            )
          )
        )
        ${
          subjectVenueId
            ? sql`AND NOT EXISTS (
                SELECT 1 FROM venue_duplicate_decisions d
                WHERE d.venue_low_id = LEAST(v.id, ${subjectVenueId}::uuid)
                  AND d.venue_high_id = GREATEST(v.id, ${subjectVenueId}::uuid)
              )`
            : sql``
        }
      ORDER BY
        ((${phone}::text IS NOT NULL AND v.phone_e164 = ${phone})
          OR (${email}::text IS NOT NULL AND lower(v.email) = ${email})) DESC,
        GREATEST(
          similarity(v.name, ${candidateName}),
          COALESCE(similarity(v.address, ${candidateAddress ?? ""}), 0)
        ) DESC
      LIMIT ${limit}
    `),
  );

  return rows.map((r) => {
    const nameSim = Number(r.name_sim);
    const addressSim = Number(r.address_sim);
    const matchReasons: string[] = [];
    if (r.phone_match) matchReasons.push("same phone number");
    if (r.email_match) matchReasons.push("same email");
    if (r.domain_match) matchReasons.push("same website domain");
    if (nameSim >= threshold) matchReasons.push("similar name");
    else if (addressSim >= threshold) matchReasons.push("similar address");
    const hardKey = r.phone_match || r.email_match || r.domain_match;
    return {
      id: r.id,
      name: r.name,
      address: r.address,
      cityId: r.city_id,
      cityName: r.city_name,
      nameSimilarity: nameSim,
      addressSimilarity: addressSim,
      bestScore: hardKey ? 1 : Math.max(nameSim, addressSim),
      matchReasons,
      doNotContact: r.do_not_contact,
    };
  });
}
