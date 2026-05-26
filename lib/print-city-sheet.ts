/**
 * Print city sheet loader.
 *
 * Returns the everything-on-one-page view of a city campaign for the
 * physical handout / save-as-PDF flow. Distinct from loadCitySheet
 * because the print view needs venue addresses + night-of contact
 * phones that the interactive sheet doesn't surface inline.
 *
 * One DB query per concern, parallelized:
 *   1. City + campaign + lead-staff metadata
 *   2. All confirmed/contract_signed venue_events for this city
 *      campaign, joined with venues for address + phone + capacity
 *
 * Returns null when the city_campaign id doesn't resolve — page
 * calls notFound() in that case.
 */

import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export interface PrintVenueRow {
  venueEventId: string;
  eventId: string;
  eventDate: string;
  dayPart: string;
  crawlNumber: number;
  role: string;
  slotPosition: number;
  status: string;
  venueName: string;
  venueAddress: string | null;
  venuePhone: string | null;
  venueCapacity: number | null;
  agreedHoursText: string | null;
  drinkSpecials: string | null;
  nightOfContactName: string | null;
  nightOfContactPhone: string | null;
  notes: string | null;
}

export interface PrintCrawl {
  eventId: string;
  eventDate: string;
  dayPart: string;
  crawlNumber: number;
  ticketsSold: number;
  venues: PrintVenueRow[];
}

export interface PrintCitySheet {
  cityCampaignId: string;
  cityName: string;
  cityRegion: string | null;
  campaignName: string;
  leadStaffName: string | null;
  leadStaffPhone: string | null;
  dashboardNote: string | null;
  /** Date stamp at top — first crawl date in the city campaign. */
  earliestCrawlDate: string | null;
  crawls: PrintCrawl[];
  totals: {
    crawlCount: number;
    confirmedVenueCount: number;
    totalTicketsSold: number;
  };
}

export async function loadPrintCitySheet(cityCampaignId: string): Promise<PrintCitySheet | null> {
  const [metaResult, venuesResult] = await Promise.all([
    db.execute<{
      city_name: string;
      city_region: string | null;
      campaign_name: string;
      lead_staff_name: string | null;
      lead_staff_phone: string | null;
      dashboard_note: string | null;
    }>(sql`
      SELECT
        c.name AS city_name,
        c.region AS city_region,
        cm.name AS campaign_name,
        sm.display_name AS lead_staff_name,
        sm.quo_line_e164_override AS lead_staff_phone,
        cc.dashboard_note
      FROM city_campaigns cc
      JOIN cities c ON c.id = cc.city_id
      JOIN campaigns cm ON cm.id = cc.campaign_id
      LEFT JOIN staff_members sm ON sm.id = cc.lead_staff_id
      WHERE cc.id = ${cityCampaignId}
    `),
    db.execute<{
      venue_event_id: string;
      event_id: string;
      event_date: string;
      day_part: string;
      crawl_number: number;
      role: string;
      slot_position: number;
      status: string;
      venue_name: string;
      venue_address: string | null;
      venue_phone: string | null;
      venue_capacity: number | null;
      agreed_hours_text: string | null;
      drink_specials: string | null;
      night_of_contact_name: string | null;
      night_of_contact_phone: string | null;
      notes: string | null;
      tickets_sold: number;
    }>(sql`
      SELECT
        ve.id AS venue_event_id,
        e.id AS event_id,
        e.event_date::text AS event_date,
        e.day_part::text AS day_part,
        e.crawl_number,
        ve.role::text AS role,
        COALESCE(ve.slot_position, 1) AS slot_position,
        ve.status::text AS status,
        v.name AS venue_name,
        v.address AS venue_address,
        v.phone_e164 AS venue_phone,
        v.capacity AS venue_capacity,
        ve.agreed_hours_text,
        ve.drink_specials,
        ve.night_of_contact_name,
        ve.night_of_contact_phone_e164 AS night_of_contact_phone,
        ve.notes,
        COALESCE(e.ticket_sales_count, 0) AS tickets_sold
      FROM events e
      LEFT JOIN venue_events ve ON ve.event_id = e.id
        AND ve.status IN ('confirmed','contract_signed')
      LEFT JOIN venues v ON v.id = ve.venue_id
      WHERE e.city_campaign_id = ${cityCampaignId}
      ORDER BY e.event_date ASC,
               e.day_part ASC,
               e.crawl_number ASC,
               CASE ve.role::text
                 WHEN 'wristband' THEN 1
                 WHEN 'middle' THEN 2
                 WHEN 'final' THEN 3
                 WHEN 'alt_final' THEN 4
                 ELSE 5
               END,
               COALESCE(ve.slot_position, 1) ASC
    `),
  ]);

  type MetaRow = {
    city_name: string;
    city_region: string | null;
    campaign_name: string;
    lead_staff_name: string | null;
    lead_staff_phone: string | null;
    dashboard_note: string | null;
  };
  const metaRows: MetaRow[] = Array.isArray(metaResult)
    ? (metaResult as unknown as MetaRow[])
    : ((metaResult as unknown as { rows: MetaRow[] }).rows ?? []);
  const meta = metaRows[0];
  if (!meta) return null;

  type VenueRow = {
    venue_event_id: string;
    event_id: string;
    event_date: string;
    day_part: string;
    crawl_number: number;
    role: string;
    slot_position: number;
    status: string;
    venue_name: string | null;
    venue_address: string | null;
    venue_phone: string | null;
    venue_capacity: number | null;
    agreed_hours_text: string | null;
    drink_specials: string | null;
    night_of_contact_name: string | null;
    night_of_contact_phone: string | null;
    notes: string | null;
    tickets_sold: number;
  };
  const venueRows: VenueRow[] = Array.isArray(venuesResult)
    ? (venuesResult as unknown as VenueRow[])
    : ((venuesResult as unknown as { rows: VenueRow[] }).rows ?? []);

  // Group by event
  const byEvent = new Map<string, PrintCrawl>();
  for (const r of venueRows) {
    if (!byEvent.has(r.event_id)) {
      byEvent.set(r.event_id, {
        eventId: r.event_id,
        eventDate: r.event_date,
        dayPart: r.day_part,
        crawlNumber: r.crawl_number,
        ticketsSold: r.tickets_sold,
        venues: [],
      });
    }
    // venue_name null means the LEFT JOIN matched the event but no confirmed
    // venues exist yet for that event — skip the row but keep the crawl.
    if (r.venue_name && r.venue_event_id) {
      byEvent.get(r.event_id)?.venues.push({
        venueEventId: r.venue_event_id,
        eventId: r.event_id,
        eventDate: r.event_date,
        dayPart: r.day_part,
        crawlNumber: r.crawl_number,
        role: r.role,
        slotPosition: r.slot_position,
        status: r.status,
        venueName: r.venue_name,
        venueAddress: r.venue_address,
        venuePhone: r.venue_phone,
        venueCapacity: r.venue_capacity,
        agreedHoursText: r.agreed_hours_text,
        drinkSpecials: r.drink_specials,
        nightOfContactName: r.night_of_contact_name,
        nightOfContactPhone: r.night_of_contact_phone,
        notes: r.notes,
      });
    }
  }

  const crawls = Array.from(byEvent.values()).sort((a, b) => {
    if (a.eventDate !== b.eventDate) return a.eventDate < b.eventDate ? -1 : 1;
    if (a.dayPart !== b.dayPart) return a.dayPart < b.dayPart ? -1 : 1;
    return a.crawlNumber - b.crawlNumber;
  });

  const confirmedVenueCount = crawls.reduce((a, c) => a + c.venues.length, 0);
  const totalTicketsSold = crawls.reduce((a, c) => a + c.ticketsSold, 0);

  return {
    cityCampaignId,
    cityName: meta.city_name,
    cityRegion: meta.city_region,
    campaignName: meta.campaign_name,
    leadStaffName: meta.lead_staff_name,
    leadStaffPhone: meta.lead_staff_phone,
    dashboardNote: meta.dashboard_note,
    earliestCrawlDate: crawls[0]?.eventDate ?? null,
    crawls,
    totals: {
      crawlCount: crawls.length,
      confirmedVenueCount,
      totalTicketsSold,
    },
  };
}
