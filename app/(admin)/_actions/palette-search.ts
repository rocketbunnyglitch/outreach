"use server";

/**
 * Command palette server search.
 *
 * Single action returning fuzzy matches across the four primary entity
 * types operators jump between: venues, cities, campaigns (city-level
 * and master), and staff. Capped at modest per-type result counts so a
 * one-letter query doesn't fan out into hundreds of rows.
 *
 * Uses pg_trgm for cheap fuzzy matching (extension already enabled by
 * the original 0000_setup migration). Falls back to ILIKE on tables
 * without trigram indexes.
 */

import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sql } from "drizzle-orm";

export interface PaletteSearchResult {
  venues: Array<{ id: string; name: string; cityName: string | null; address: string | null }>;
  cities: Array<{ id: string; name: string; region: string | null }>;
  campaigns: Array<{
    id: string;
    name: string;
    brandName: string;
    isCityCampaign: boolean;
  }>;
  staff: Array<{ id: string; displayName: string; primaryEmail: string }>;
}

const EMPTY_RESULT: PaletteSearchResult = {
  venues: [],
  cities: [],
  campaigns: [],
  staff: [],
};

export async function paletteSearch(query: string): Promise<PaletteSearchResult> {
  await requireStaff();

  const q = query.trim();
  if (q.length < 2) return EMPTY_RESULT;

  // Loose ILIKE pattern — wrap with %...% on both sides. pg_trgm
  // indexes would be a perf win but a simple ILIKE is already <10ms
  // on the data scales we operate at (low thousands of venues).
  const pattern = `%${q.replace(/[%_]/g, "\\$&")}%`;

  type VenueRow = {
    id: string;
    name: string;
    city_name: string | null;
    address: string | null;
  };
  type CityRow = { id: string; name: string; region: string | null };
  type CampaignRow = {
    id: string;
    name: string;
    brand_name: string;
    is_city_campaign: boolean;
  };
  type StaffRow = { id: string; display_name: string; primary_email: string };

  // Per-query error logging (CLAUDE.md §12.4 fix).
  //
  // Previous shape ran all 4 db.execute calls inside Promise.all and
  // surrounded the whole batch in a single catch at the action level,
  // which collapsed individual failures into EMPTY_RESULT. That meant
  // if e.g. the campaign UNION query broke (it did — see palette fix
  // commit 726dc55), Cmd+K would silently return zero campaign results
  // forever and no error would surface.
  //
  // The wrapper below tags each query with its source name and logs
  // any failure individually before returning [] for that source.
  // Other sources still succeed. Operators see partial results but
  // engineers see the actual error in logs.
  async function tagAndCatch<T>(name: string, run: () => Promise<unknown>): Promise<T[]> {
    try {
      const result = await run();
      return Array.isArray(result) ? (result as T[]) : ((result as { rows: T[] }).rows ?? []);
    } catch (err) {
      logger.error({ err, source: name, query: q }, "palette-search subquery failed");
      return [];
    }
  }

  const [venuesResult, citiesResult, campaignsResult, staffResult] = await Promise.all([
    tagAndCatch<VenueRow>("venues", () =>
      db.execute<VenueRow>(sql`
      SELECT v.id::text, v.name, c.name AS city_name, v.address
      FROM venues v
      LEFT JOIN cities c ON c.id = v.city_id
      WHERE v.archived_at IS NULL
        AND (
          v.name ILIKE ${pattern}
          OR v.address ILIKE ${pattern}
          OR v.email ILIKE ${pattern}
          OR v.phone_e164 ILIKE ${pattern}
        )
      ORDER BY similarity(v.name, ${q}) DESC NULLS LAST, v.name
      LIMIT 8
    `),
    ),
    tagAndCatch<CityRow>("cities", () =>
      db.execute<CityRow>(sql`
      SELECT id::text, name, region
      FROM cities
      WHERE archived_at IS NULL
        AND (name ILIKE ${pattern} OR region ILIKE ${pattern})
      ORDER BY name
      LIMIT 5
    `),
    ),
    tagAndCatch<CampaignRow>("campaigns", () =>
      db.execute<CampaignRow>(sql`
      (
        SELECT
          cc.id::text,
          c.name AS name,
          ob.display_name AS brand_name,
          true AS is_city_campaign
        FROM city_campaigns cc
        LEFT JOIN cities c ON c.id = cc.city_id
        LEFT JOIN campaigns cm ON cm.id = cc.campaign_id
        LEFT JOIN outreach_brands ob ON ob.id = cm.outreach_brand_id
        WHERE cc.status != 'cancelled'
          AND (c.name ILIKE ${pattern} OR ob.display_name ILIKE ${pattern})
        ORDER BY c.name
        LIMIT 4
      )
      UNION ALL
      (
        SELECT
          cm.id::text,
          cm.name,
          ob.display_name AS brand_name,
          false AS is_city_campaign
        FROM campaigns cm
        LEFT JOIN outreach_brands ob ON ob.id = cm.outreach_brand_id
        WHERE cm.archived_at IS NULL
          AND (cm.name ILIKE ${pattern} OR ob.display_name ILIKE ${pattern})
        ORDER BY cm.name
        LIMIT 4
      )
    `),
    ),
    tagAndCatch<StaffRow>("staff", () =>
      db.execute<StaffRow>(sql`
      SELECT id::text, display_name, primary_email
      FROM staff_members
      WHERE archived_at IS NULL
        AND status = 'active'
        AND (display_name ILIKE ${pattern} OR primary_email ILIKE ${pattern})
      ORDER BY display_name
      LIMIT 5
    `),
    ),
  ]);

  // tagAndCatch already normalizes to T[] (handles both the array
  // shape and the { rows: T[] } shape). Direct .map below.
  return {
    venues: venuesResult.map((v) => ({
      id: v.id,
      name: v.name,
      cityName: v.city_name,
      address: v.address,
    })),
    cities: citiesResult.map((c) => ({
      id: c.id,
      name: c.name,
      region: c.region,
    })),
    campaigns: campaignsResult.map((c) => ({
      id: c.id,
      name: c.name,
      brandName: c.brand_name,
      isCityCampaign: c.is_city_campaign,
    })),
    staff: staffResult.map((s) => ({
      id: s.id,
      displayName: s.display_name,
      primaryEmail: s.primary_email,
    })),
  };
}
