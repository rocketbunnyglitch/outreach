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
  /** Email threads matching the query — full-text body search via
   *  the Phase B tsvector + subject/sender ILIKE fallback. Phase G. */
  threads: Array<{
    id: string;
    subject: string | null;
    snippet: string | null;
    venueName: string | null;
    lastMessageAt: Date;
  }>;
  /** Open tasks matching by title or description. Phase G. */
  tasks: Array<{
    id: string;
    title: string;
    targetType: string;
    targetId: string | null;
    dueAt: Date | null;
  }>;
  /** Crawl events matching by city/date. Phase G. */
  events: Array<{
    id: string;
    cityName: string;
    crawlDate: string;
    crawlNumber: number;
    dayPart: string;
  }>;
}

const EMPTY_RESULT: PaletteSearchResult = {
  venues: [],
  cities: [],
  campaigns: [],
  staff: [],
  threads: [],
  tasks: [],
  events: [],
};

export async function paletteSearch(query: string): Promise<PaletteSearchResult> {
  const { staff } = await requireStaff();

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
  type ThreadRow = {
    id: string;
    subject: string | null;
    snippet: string | null;
    venue_name: string | null;
    last_message_at: Date;
  };
  type TaskRow = {
    id: string;
    title: string;
    target_type: string;
    target_id: string | null;
    due_at: Date | null;
  };
  type EventRow = {
    id: string;
    city_name: string;
    event_date: string;
    crawl_number: number;
    day_part: string;
  };

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

  const [
    venuesResult,
    citiesResult,
    campaignsResult,
    staffResult,
    threadsResult,
    tasksResult,
    eventsResult,
  ] = await Promise.all([
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
      FROM users
      WHERE archived_at IS NULL
        AND status = 'active'
        AND (display_name ILIKE ${pattern} OR primary_email ILIKE ${pattern})
      ORDER BY display_name
      LIMIT 5
    `),
    ),
    // Phase G — Email threads. Scoped to the operator's team via
    // connected_accounts.team_id. Uses both ILIKE on subject/snippet
    // AND the full-text tsvector from Phase B (search_tsv) so body
    // hits surface too. Joins venue name for display in results.
    tagAndCatch<ThreadRow>("threads", () =>
      db.execute<ThreadRow>(sql`
      SELECT
        t.id::text,
        t.subject,
        t.snippet,
        v.name AS venue_name,
        t.last_message_at
      FROM email_threads t
      LEFT JOIN venues v ON v.id = t.venue_id
      INNER JOIN connected_accounts ca ON ca.id = t.connected_account_id
      WHERE ca.team_id = ${staff.teamId}
        AND (
          t.subject ILIKE ${pattern}
          OR t.snippet ILIKE ${pattern}
          OR EXISTS (
            SELECT 1 FROM email_messages m
            WHERE m.thread_id = t.id
              AND m.search_tsv @@ websearch_to_tsquery('english', ${q})
          )
        )
      ORDER BY t.last_message_at DESC
      LIMIT 6
    `),
    ),
    // Phase G — Tasks. Team-scoped via the assigned operator's team
    // OR tasks created by the current operator. Open tasks first;
    // recently-completed not surfaced (the palette is for "where do
    // I go" not "what happened recently").
    tagAndCatch<TaskRow>("tasks", () =>
      db.execute<TaskRow>(sql`
      SELECT
        ta.id::text,
        ta.title,
        ta.target_type::text AS target_type,
        ta.target_id::text AS target_id,
        ta.due_at
      FROM tasks ta
      LEFT JOIN users u ON u.id = ta.assigned_staff_id
      WHERE ta.status IN ('pending', 'in_progress')
        AND (u.team_id = ${staff.teamId} OR ta.created_by = ${staff.id})
        AND (ta.title ILIKE ${pattern} OR ta.description ILIKE ${pattern})
      ORDER BY
        CASE WHEN ta.due_at IS NULL THEN 1 ELSE 0 END,
        ta.due_at ASC NULLS LAST
      LIMIT 5
    `),
    ),
    // Phase G — Events. Currently single-tenant (no team_id on
    // outreach_brands; events are visible to every operator).
    // Matches against the city name + the crawl date in YYYY-MM-DD
    // form (so operators can type "2025-11" to find November
    // crawls). Future + recent past — long-past crawls are noise
    // in a palette.
    tagAndCatch<EventRow>("events", () =>
      db.execute<EventRow>(sql`
      SELECT
        e.id::text,
        c.name AS city_name,
        e.event_date::text AS event_date,
        COALESCE(e.crawl_number, 1) AS crawl_number,
        COALESCE(e.day_part::text, 'evening') AS day_part
      FROM events e
      LEFT JOIN city_campaigns cc ON cc.id = e.city_campaign_id
      LEFT JOIN cities c ON c.id = cc.city_id
      WHERE e.archived_at IS NULL
        AND e.event_date >= CURRENT_DATE - INTERVAL '30 days'
        AND (
          c.name ILIKE ${pattern}
          OR e.event_date::text ILIKE ${pattern}
        )
      ORDER BY e.event_date ASC
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
    threads: threadsResult.map((t) => ({
      id: t.id,
      subject: t.subject,
      snippet: t.snippet,
      venueName: t.venue_name,
      lastMessageAt: t.last_message_at,
    })),
    tasks: tasksResult.map((t) => ({
      id: t.id,
      title: t.title,
      targetType: t.target_type,
      targetId: t.target_id,
      dueAt: t.due_at,
    })),
    events: eventsResult.map((e) => ({
      id: e.id,
      cityName: e.city_name,
      crawlDate: e.event_date,
      crawlNumber: e.crawl_number,
      dayPart: e.day_part,
    })),
  };
}
