/**
 * Today digest loader.
 *
 * Surfaces what needs attention NOW on the dashboard, so the operator
 * opens the app and sees their day mapped out instead of having to
 * page through tables figuring it out.
 *
 * Three buckets:
 *   1. Urgent crawls — events ≤ 14 days away with open slots, sorted
 *      by days_until ASC so the most imminent crisis is at the top
 *   2. Stale follow-ups — cold outreach entries last touched 5+ days
 *      ago that aren't in a terminal status (declined / DNC / etc.)
 *   3. Recent wins — venue_events that moved into confirmed status
 *      in the past 7 days, for momentum + morale
 *
 * One query per bucket, all parallelized via Promise.all. Each bucket
 * caps at 5 rows — the widget is meant to be glance-able, not a
 * second tracker. Operator drills in to see the full list.
 *
 * Scope: the operator's currently-selected campaign (passed in).
 * Without a current campaign, returns empty digest — the dashboard's
 * empty-state copy points them at /campaigns/new.
 */

import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export interface UrgentCrawl {
  eventId: string;
  cityCampaignId: string;
  cityName: string;
  cityRegion: string | null;
  dayPart: string;
  crawlNumber: number;
  eventDate: string;
  daysUntil: number;
  openSlots: number;
}

export interface StaleFollowUp {
  entryId: string;
  cityCampaignId: string;
  venueId: string;
  venueName: string;
  cityName: string;
  status: string;
  daysSinceTouch: number;
  assignedStaffName: string | null;
}

export interface RecentWin {
  venueEventId: string;
  cityCampaignId: string;
  venueName: string;
  cityName: string;
  role: string;
  confirmedAt: string;
  daysAgo: number;
  /** Who owns the win (the venue's "Scheduled by" staffer), or null. */
  winnerName: string | null;
}

export interface TodayDigest {
  urgentCrawls: UrgentCrawl[];
  staleFollowUps: StaleFollowUp[];
  recentWins: RecentWin[];
}

const EMPTY_DIGEST: TodayDigest = {
  urgentCrawls: [],
  staleFollowUps: [],
  recentWins: [],
};

export async function loadTodayDigest(campaignId: string | null): Promise<TodayDigest> {
  if (!campaignId) return EMPTY_DIGEST;

  const [urgentCrawls, staleFollowUps, recentWins] = await Promise.all([
    loadUrgentCrawls(campaignId),
    loadStaleFollowUps(campaignId),
    loadRecentWins(campaignId),
  ]);

  return { urgentCrawls, staleFollowUps, recentWins };
}

async function loadUrgentCrawls(campaignId: string): Promise<UrgentCrawl[]> {
  const result = await db.execute<{
    event_id: string;
    city_campaign_id: string;
    city_name: string;
    city_region: string | null;
    day_part: string;
    crawl_number: number;
    event_date: string;
    days_until: number;
    open_slots: number;
  }>(sql`
    WITH slot_state AS (
      SELECT
        e.id AS event_id,
        cc.id AS city_campaign_id,
        c.name AS city_name,
        c.region AS city_region,
        e.day_part::text AS day_part,
        e.crawl_number,
        e.event_date::text AS event_date,
        (e.event_date - CURRENT_DATE)::int AS days_until,
        COUNT(ve.id) FILTER (
          WHERE ve.status NOT IN ('confirmed', 'contract_signed')
        )::int AS open_slots
      FROM events e
      JOIN city_campaigns cc ON cc.id = e.city_campaign_id
      JOIN cities c ON c.id = cc.city_id
      LEFT JOIN venue_events ve ON ve.event_id = e.id
      WHERE cc.campaign_id = ${campaignId}
        AND cc.archived_at IS NULL
        AND cc.status NOT IN ('cancelled')
        AND e.event_date >= CURRENT_DATE
        AND e.event_date <= CURRENT_DATE + INTERVAL '14 days'
      GROUP BY e.id, cc.id, c.name, c.region, e.day_part, e.crawl_number, e.event_date
    )
    SELECT * FROM slot_state
    WHERE open_slots > 0
    ORDER BY days_until ASC, open_slots DESC
    LIMIT 5
  `);

  type Row = {
    event_id: string;
    city_campaign_id: string;
    city_name: string;
    city_region: string | null;
    day_part: string;
    crawl_number: number;
    event_date: string;
    days_until: number;
    open_slots: number;
  };
  const rows: Row[] = Array.isArray(result)
    ? (result as unknown as Row[])
    : ((result as unknown as { rows: Row[] }).rows ?? []);
  return rows.map((r) => ({
    eventId: r.event_id,
    cityCampaignId: r.city_campaign_id,
    cityName: r.city_name,
    cityRegion: r.city_region,
    dayPart: r.day_part,
    crawlNumber: r.crawl_number,
    eventDate: r.event_date,
    daysUntil: r.days_until,
    openSlots: r.open_slots,
  }));
}

async function loadStaleFollowUps(campaignId: string): Promise<StaleFollowUp[]> {
  const result = await db.execute<{
    entry_id: string;
    city_campaign_id: string;
    venue_id: string;
    venue_name: string;
    city_name: string;
    status: string;
    days_since_touch: number;
    assigned_staff_name: string | null;
  }>(sql`
    SELECT
      coe.id AS entry_id,
      coe.city_campaign_id,
      v.id AS venue_id,
      v.name AS venue_name,
      c.name AS city_name,
      coe.status::text AS status,
      (EXTRACT(EPOCH FROM (NOW() - coe.last_touch_at)) / 86400)::int AS days_since_touch,
      sm.display_name AS assigned_staff_name
    FROM cold_outreach_entries coe
    JOIN city_campaigns cc ON cc.id = coe.city_campaign_id
    JOIN cities c ON c.id = cc.city_id
    JOIN venues v ON v.id = coe.venue_id
    LEFT JOIN users sm ON sm.id = coe.assigned_staff_id
    WHERE cc.campaign_id = ${campaignId}
      AND coe.archived_at IS NULL
      AND coe.status IN ('email_sent', 'follow_up_due', 'called', 'voicemail', 'no_answer')
      AND coe.last_touch_at IS NOT NULL
      AND coe.last_touch_at < NOW() - INTERVAL '5 days'
    ORDER BY coe.last_touch_at ASC
    LIMIT 5
  `);

  type Row = {
    entry_id: string;
    city_campaign_id: string;
    venue_id: string;
    venue_name: string;
    city_name: string;
    status: string;
    days_since_touch: number;
    assigned_staff_name: string | null;
  };
  const rows: Row[] = Array.isArray(result)
    ? (result as unknown as Row[])
    : ((result as unknown as { rows: Row[] }).rows ?? []);
  return rows.map((r) => ({
    entryId: r.entry_id,
    cityCampaignId: r.city_campaign_id,
    venueId: r.venue_id,
    venueName: r.venue_name,
    cityName: r.city_name,
    status: r.status,
    daysSinceTouch: r.days_since_touch,
    assignedStaffName: r.assigned_staff_name,
  }));
}

async function loadRecentWins(campaignId: string): Promise<RecentWin[]> {
  const result = await db.execute<{
    venue_event_id: string;
    city_campaign_id: string;
    venue_name: string;
    city_name: string;
    role: string;
    confirmed_at: string;
    days_ago: number;
  }>(sql`
    SELECT
      ve.id AS venue_event_id,
      cc.id AS city_campaign_id,
      v.name AS venue_name,
      c.name AS city_name,
      ve.role::text AS role,
      ve.confirmed_at::text AS confirmed_at,
      (EXTRACT(EPOCH FROM (NOW() - ve.confirmed_at)) / 86400)::int AS days_ago,
      (SELECT u.display_name FROM users u WHERE u.id = ve.our_contact_staff_id) AS winner_name
    FROM venue_events ve
    JOIN events e ON e.id = ve.event_id
    JOIN city_campaigns cc ON cc.id = e.city_campaign_id
    JOIN cities c ON c.id = cc.city_id
    JOIN venues v ON v.id = ve.venue_id
    WHERE cc.campaign_id = ${campaignId}
      AND ve.status IN ('confirmed', 'contract_signed')
      AND ve.confirmed_at IS NOT NULL
      AND ve.confirmed_at > NOW() - INTERVAL '7 days'
    ORDER BY ve.confirmed_at DESC
    LIMIT 5
  `);

  type Row = {
    venue_event_id: string;
    city_campaign_id: string;
    venue_name: string;
    city_name: string;
    role: string;
    confirmed_at: string;
    days_ago: number;
    winner_name: string | null;
  };
  const rows: Row[] = Array.isArray(result)
    ? (result as unknown as Row[])
    : ((result as unknown as { rows: Row[] }).rows ?? []);
  return rows.map((r) => ({
    venueEventId: r.venue_event_id,
    cityCampaignId: r.city_campaign_id,
    venueName: r.venue_name,
    cityName: r.city_name,
    role: r.role,
    confirmedAt: r.confirmed_at,
    daysAgo: r.days_ago,
    winnerName: r.winner_name,
  }));
}
