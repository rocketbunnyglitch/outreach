/**
 * All-crawls flat view loader.
 *
 * One row per event in the current campaign — every crawl across every
 * city, every day, every crawl number. Joins city + city_campaign +
 * event + counts of confirmed/lead venue_events for status badges.
 *
 * Used by the /all-crawls page which gives the operator a single
 * scrollable surface to:
 *   • Sort by city / day / sales / status
 *   • Filter by status (e.g. "show me crawls with no Final yet")
 *   • Link to / sync with Eventbrite per crawl
 *   • Bulk-edit (next pass)
 *
 * Performance: one query with grouped subselects for slot counts so
 * the page renders fast even for a 300-crawl campaign.
 */

import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export type CrawlStatusPill = "outreach" | "need_3" | "need_2" | "need_1" | "ready" | "cancelled";

export interface AllCrawlsRow {
  eventId: string;
  cityCampaignId: string;
  cityId: string;
  cityName: string;
  cityRegion: string | null;
  cityCountry: string;
  dayPart: string;
  crawlNumber: number;
  eventDate: string | null;
  ticketsSold: number;
  ticketPriceCents: number | null;
  middleVenueGroupId: string | null;
  middleVenueGroupName: string | null;
  eventbriteEventId: string | null;
  eventbriteUrl: string | null;
  /** Confirmed slot counts — used to render the SLOT status pills. */
  confirmedWristband: number;
  confirmedMiddle: number;
  confirmedFinal: number;
  totalSlots: number;
  /** Open slot count → drives status pill (matches the dashboard logic). */
  openSlots: number;
  cityCampaignStatus: string;
}

export async function loadAllCrawlsForCampaign(campaignId: string): Promise<AllCrawlsRow[]> {
  const result = await db.execute<{
    event_id: string;
    city_campaign_id: string;
    city_id: string;
    city_name: string;
    city_region: string | null;
    city_country: string;
    day_part: string;
    crawl_number: number;
    event_date: string | null;
    tickets_sold: number;
    ticket_price_cents: number | null;
    middle_venue_group_id: string | null;
    middle_venue_group_name: string | null;
    eventbrite_event_id: string | null;
    eventbrite_url: string | null;
    confirmed_wristband: number;
    confirmed_middle: number;
    confirmed_final: number;
    total_slots: number;
    open_slots: number;
    city_campaign_status: string;
  }>(sql`
    WITH slot_agg AS (
      SELECT
        ve.event_id,
        COUNT(*) FILTER (
          WHERE ve.role = 'wristband'
            AND ve.status IN ('confirmed','scheduled','contract_signed')
            AND ve.temporarily_disabled IS NOT TRUE
        )::int AS confirmed_wristband,
        COUNT(*) FILTER (
          WHERE ve.role = 'middle'
            AND ve.status IN ('confirmed','scheduled','contract_signed')
            AND ve.temporarily_disabled IS NOT TRUE
        )::int AS confirmed_middle,
        -- final ONLY (alt_final is a backup, not a primary final -- matches
        -- tracker-status / crawl-matrix / the public lineup, which all count
        -- role='final' only).
        COUNT(*) FILTER (
          WHERE ve.role = 'final'
            AND ve.status IN ('confirmed','scheduled','contract_signed')
            AND ve.temporarily_disabled IS NOT TRUE
        )::int AS confirmed_final,
        COUNT(*)::int AS total_slots,
        COUNT(*) FILTER (
          WHERE ve.status NOT IN ('confirmed','contract_signed')
        )::int AS open_slots
      FROM venue_events ve
      GROUP BY ve.event_id
    )
    SELECT
      e.id AS event_id,
      cc.id AS city_campaign_id,
      c.id AS city_id,
      c.name AS city_name,
      c.region AS city_region,
      c.country_code AS city_country,
      e.day_part::text AS day_part,
      e.crawl_number,
      e.event_date::text AS event_date,
      COALESCE(e.ticket_sales_count, 0)::int AS tickets_sold,
      NULL::int AS ticket_price_cents, -- events has no price column; field is unused in UI
      e.middle_venue_group_id,
      mvg.name AS middle_venue_group_name,
      e.eventbrite_event_id,
      e.eventbrite_url,
      COALESCE(sa.confirmed_wristband, 0) AS confirmed_wristband,
      COALESCE(sa.confirmed_middle, 0) AS confirmed_middle,
      COALESCE(sa.confirmed_final, 0) AS confirmed_final,
      -- total/open are the REQUIRED slot mix per crawl format, NOT a raw
      -- count of attached venue_events. Previously an empty crawl counted
      -- 0 total + 0 open, so it looked "complete" instead of "needs all
      -- its slots". Required counts (required_*_count) already encode the
      -- format (day_party has required_final_count = 0), matching
      -- city-progress.ts. Confirmed is capped per role so over-filling one
      -- role can't drive open_slots negative or mask another empty role.
      (e.required_wristband_count + e.required_middle_count + e.required_final_count)::int AS total_slots,
      GREATEST(
        0,
        (e.required_wristband_count + e.required_middle_count + e.required_final_count)
          - LEAST(COALESCE(sa.confirmed_wristband, 0), e.required_wristband_count)
          - LEAST(
              COALESCE(sa.confirmed_middle, 0),
              e.required_middle_count
            )
          - LEAST(COALESCE(sa.confirmed_final, 0), e.required_final_count)
      )::int AS open_slots,
      cc.status::text AS city_campaign_status
    FROM events e
    JOIN city_campaigns cc ON cc.id = e.city_campaign_id
    JOIN cities c ON c.id = cc.city_id
    LEFT JOIN slot_agg sa ON sa.event_id = e.id
    LEFT JOIN middle_venue_groups mvg ON mvg.id = e.middle_venue_group_id
    WHERE cc.campaign_id = ${campaignId}
      AND e.archived_at IS NULL
      AND cc.archived_at IS NULL
    ORDER BY c.name ASC, e.day_part ASC, e.crawl_number ASC
  `);

  const rows: Array<{
    event_id: string;
    city_campaign_id: string;
    city_id: string;
    city_name: string;
    city_region: string | null;
    city_country: string;
    day_part: string;
    crawl_number: number;
    event_date: string | null;
    tickets_sold: number;
    ticket_price_cents: number | null;
    middle_venue_group_id: string | null;
    middle_venue_group_name: string | null;
    eventbrite_event_id: string | null;
    eventbrite_url: string | null;
    confirmed_wristband: number;
    confirmed_middle: number;
    confirmed_final: number;
    total_slots: number;
    open_slots: number;
    city_campaign_status: string;
  }> = Array.isArray(result)
    ? (result as unknown as Array<{
        event_id: string;
        city_campaign_id: string;
        city_id: string;
        city_name: string;
        city_region: string | null;
        city_country: string;
        day_part: string;
        crawl_number: number;
        event_date: string | null;
        tickets_sold: number;
        ticket_price_cents: number | null;
        middle_venue_group_id: string | null;
        middle_venue_group_name: string | null;
        eventbrite_event_id: string | null;
        eventbrite_url: string | null;
        confirmed_wristband: number;
        confirmed_middle: number;
        confirmed_final: number;
        total_slots: number;
        open_slots: number;
        city_campaign_status: string;
      }>)
    : ((
        result as unknown as {
          rows: Array<{
            event_id: string;
            city_campaign_id: string;
            city_id: string;
            city_name: string;
            city_region: string | null;
            city_country: string;
            day_part: string;
            crawl_number: number;
            event_date: string | null;
            tickets_sold: number;
            ticket_price_cents: number | null;
            middle_venue_group_id: string | null;
            middle_venue_group_name: string | null;
            eventbrite_event_id: string | null;
            eventbrite_url: string | null;
            confirmed_wristband: number;
            confirmed_middle: number;
            confirmed_final: number;
            total_slots: number;
            open_slots: number;
            city_campaign_status: string;
          }>;
        }
      ).rows ?? []);

  return rows.map((r) => ({
    eventId: r.event_id,
    cityCampaignId: r.city_campaign_id,
    cityId: r.city_id,
    cityName: r.city_name,
    cityRegion: r.city_region,
    cityCountry: r.city_country,
    dayPart: r.day_part,
    crawlNumber: r.crawl_number,
    eventDate: r.event_date,
    ticketsSold: r.tickets_sold,
    ticketPriceCents: r.ticket_price_cents,
    middleVenueGroupId: r.middle_venue_group_id,
    middleVenueGroupName: r.middle_venue_group_name,
    eventbriteEventId: r.eventbrite_event_id,
    eventbriteUrl: r.eventbrite_url,
    confirmedWristband: r.confirmed_wristband,
    confirmedMiddle: r.confirmed_middle,
    confirmedFinal: r.confirmed_final,
    totalSlots: r.total_slots,
    openSlots: r.open_slots,
    cityCampaignStatus: r.city_campaign_status,
  }));
}
