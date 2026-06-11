import "server-only";

/**
 * Data-quality center loader (CRM plan D2): the weekly hygiene sweep.
 *
 * Each check is one cheap aggregate query that answers "how many rows
 * are in this bad state, and where do I go to fix them". The page
 * renders count + sample rows + a deep link to the fixing surface —
 * data quality work happens on the existing surfaces (venue page,
 * city sheet), not in some parallel editor that would drift.
 *
 * Checks (all scoped to non-archived rows):
 *   1. Contactless venues with ACTIVE outreach — no email AND no phone
 *      but a live cold entry (we're "reaching out" to a black hole).
 *   2. Venues missing google_place_id (no canonical identity — dedupe
 *      + maps are blind to them).
 *   3. Cities with no IANA timezone (breaks call windows + send-time
 *      math for every venue in them).
 *   4. Impossible slot assignments: confirmed venue_events whose venue
 *      sits in a DIFFERENT city than the crawl's city-campaign.
 *   5. Same email on multiple venues (one inbox answering for several
 *      "venues" usually means duplicates or a venue group).
 *   6. Confirmed future slots owned by deactivated staff.
 */

import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export interface DataQualityCheck {
  key: string;
  title: string;
  /** What's wrong + why it matters, one operator-readable line. */
  why: string;
  count: number;
  /** Up to 5 example rows: label + deep link. */
  samples: Array<{ label: string; href: string }>;
  /** Where the whole class gets fixed. */
  fixHref: string;
  fixLabel: string;
}

type CountRow = { n: number };
type SampleRow = { id: string; label: string };

function rowsOf<T>(res: unknown): T[] {
  return Array.isArray(res) ? (res as T[]) : ((res as { rows?: T[] }).rows ?? []);
}

async function check(args: {
  key: string;
  title: string;
  why: string;
  countSql: ReturnType<typeof sql>;
  sampleSql: ReturnType<typeof sql>;
  hrefFor: (id: string) => string;
  fixHref: string;
  fixLabel: string;
}): Promise<DataQualityCheck> {
  const [countRes, sampleRes] = await Promise.all([
    db.execute(args.countSql),
    db.execute(args.sampleSql),
  ]);
  const count = Number(rowsOf<CountRow>(countRes)[0]?.n ?? 0);
  const samples = rowsOf<SampleRow>(sampleRes).map((r) => ({
    label: r.label,
    href: args.hrefFor(r.id),
  }));
  return { ...args, count, samples };
}

export async function loadDataQuality(): Promise<DataQualityCheck[]> {
  const checks = await Promise.all([
    check({
      key: "contactless_active",
      title: "Active outreach to unreachable venues",
      why: "No email AND no phone, but a live cold-outreach entry — staff are 'working' a venue nobody can actually reach.",
      countSql: sql`
        SELECT count(DISTINCT v.id)::int AS n
        FROM venues v
        JOIN cold_outreach_entries e ON e.venue_id = v.id AND e.archived_at IS NULL
        WHERE v.archived_at IS NULL AND v.email IS NULL AND v.phone_e164 IS NULL
      `,
      sampleSql: sql`
        SELECT DISTINCT v.id::text AS id, v.name AS label
        FROM venues v
        JOIN cold_outreach_entries e ON e.venue_id = v.id AND e.archived_at IS NULL
        WHERE v.archived_at IS NULL AND v.email IS NULL AND v.phone_e164 IS NULL
        LIMIT 5
      `,
      hrefFor: (id) => `/venues/${id}`,
      fixHref: "/venues",
      fixLabel: "Enrich or archive",
    }),
    check({
      key: "missing_place_id",
      title: "Venues without a Google place id",
      why: "No canonical identity — the duplicate checker and map have nothing exact to match on.",
      countSql: sql`
        SELECT count(*)::int AS n FROM venues
        WHERE archived_at IS NULL AND google_place_id IS NULL
      `,
      sampleSql: sql`
        SELECT id::text AS id, name AS label FROM venues
        WHERE archived_at IS NULL AND google_place_id IS NULL
        ORDER BY updated_at DESC LIMIT 5
      `,
      hrefFor: (id) => `/venues/${id}`,
      fixHref: "/venues",
      fixLabel: "Enrich",
    }),
    check({
      key: "city_no_tz",
      title: "Cities without a timezone",
      why: "Call windows, send-time optimization and 'currently open?' checks silently fall back to server time for every venue in the city.",
      countSql: sql`
        SELECT count(*)::int AS n FROM cities
        WHERE archived_at IS NULL AND (timezone IS NULL OR timezone = '')
      `,
      sampleSql: sql`
        SELECT id::text AS id, name AS label FROM cities
        WHERE archived_at IS NULL AND (timezone IS NULL OR timezone = '')
        LIMIT 5
      `,
      hrefFor: () => "/cities",
      fixHref: "/cities",
      fixLabel: "Set timezone",
    }),
    check({
      key: "cross_city_slot",
      title: "Confirmed slots in the wrong city",
      why: "A confirmed venue whose master record sits in a different city than the crawl — either the venue's city is wrong or the wrong venue was confirmed.",
      countSql: sql`
        SELECT count(*)::int AS n
        FROM venue_events ve
        JOIN venues v ON v.id = ve.venue_id
        JOIN events e ON e.id = ve.event_id
        JOIN city_campaigns cc ON cc.id = e.city_campaign_id
        WHERE ve.status = 'confirmed' AND v.city_id <> cc.city_id
          AND e.event_date >= now()::date
      `,
      sampleSql: sql`
        SELECT ve.id::text AS id, v.name || ' on ' || e.event_date AS label
        FROM venue_events ve
        JOIN venues v ON v.id = ve.venue_id
        JOIN events e ON e.id = ve.event_id
        JOIN city_campaigns cc ON cc.id = e.city_campaign_id
        WHERE ve.status = 'confirmed' AND v.city_id <> cc.city_id
          AND e.event_date >= now()::date
        LIMIT 5
      `,
      hrefFor: (id) => `/events?venueEvent=${id}`,
      fixHref: "/events",
      fixLabel: "Review slots",
    }),
    check({
      key: "shared_email",
      title: "Same email on multiple venues",
      why: "One inbox answering for several venues usually means duplicates or one org — rule them on the venue page (merge / same org).",
      countSql: sql`
        SELECT count(*)::int AS n FROM (
          SELECT lower(email) FROM venues
          WHERE archived_at IS NULL AND email IS NOT NULL
          GROUP BY lower(email) HAVING count(*) > 1
        ) dupes
      `,
      sampleSql: sql`
        SELECT min(id::text) AS id,
               lower(email) || ' (' || count(*) || ' venues)' AS label
        FROM venues
        WHERE archived_at IS NULL AND email IS NOT NULL
        GROUP BY lower(email) HAVING count(*) > 1
        ORDER BY count(*) DESC LIMIT 5
      `,
      hrefFor: (id) => `/venues/${id}`,
      fixHref: "/venues",
      fixLabel: "Rule duplicates",
    }),
    check({
      key: "deactivated_owner",
      title: "Future confirmed slots owned by deactivated staff",
      why: "The venue relationship has no living owner — reassign before the venue emails someone who no longer works here.",
      countSql: sql`
        SELECT count(*)::int AS n
        FROM venue_events ve
        JOIN users u ON u.id = ve.our_contact_staff_id
        JOIN events e ON e.id = ve.event_id
        WHERE ve.status = 'confirmed' AND u.status <> 'active'
          AND e.event_date >= now()::date
      `,
      sampleSql: sql`
        SELECT ve.id::text AS id,
               v.name || ' (owner ' || u.display_name || ')' AS label
        FROM venue_events ve
        JOIN venues v ON v.id = ve.venue_id
        JOIN users u ON u.id = ve.our_contact_staff_id
        JOIN events e ON e.id = ve.event_id
        WHERE ve.status = 'confirmed' AND u.status <> 'active'
          AND e.event_date >= now()::date
        LIMIT 5
      `,
      hrefFor: () => "/admin/workload",
      fixHref: "/admin/workload",
      fixLabel: "Reassign",
    }),
  ]);

  // Dirty checks first, clean ones sink (and render collapsed).
  return checks.sort((a, b) => b.count - a.count);
}
