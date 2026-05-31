import "server-only";

/**
 * loadCityVenues — every venue in the database for a given city,
 * with its historical slot usage attached.
 *
 * Rendered as a new section below the cold-outreach worksheet so
 * the operator can see at a glance which venues in the market they
 * have a relationship with + what role each one played in past
 * campaigns. Previously-used venues sort to the top.
 *
 * Slot history shape (per venue):
 *   [
 *     { campaignName, eventDate, role: "wristband", slotPosition: 1, status: "confirmed" },
 *     { campaignName, eventDate, role: "middle",    slotPosition: 2, status: "confirmed" },
 *     ...
 *   ]
 * Sorted newest first. Capped at 5 entries per venue to keep the
 * payload bounded; the UI truncates the visible list to ~3 and
 * shows "+N more" for the rest.
 *
 * Performance:
 *   - One SELECT for the city's venues
 *   - One SELECT joining venue_events → events → city_campaigns →
 *     campaigns to fetch the slot history for those venues
 *   - O(venues_in_city) memory, no N+1.
 *
 * Returns at most 500 venues — a city with more than that is
 * extremely rare. The UI shows a "Showing first 500" hint if the
 * cap is hit so the operator knows to filter.
 */

import {
  events,
  campaigns,
  cityCampaigns,
  coldOutreachEntries,
  venueEvents,
  venues,
} from "@/db/schema";
import { db } from "@/lib/db";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

const MAX_VENUES = 500;
const MAX_HISTORY_PER_VENUE = 5;

export interface CityVenueRow {
  venueId: string;
  venueName: string;
  /** Pre-normalized address; may be null when the venue was added
   *  manually without geocoding. */
  address: string | null;
  email: string | null;
  phoneE164: string | null;
  websiteUrl: string | null;
  instagramHandle: string | null;
  capacity: number | null;
  venueType: string[];
  /** Distance from the city's centroid (km, rounded to 1 decimal).
   *  Null when either the venue or the city lacks a geocoded
   *  location. UI uses this to surface the "closer to centre"
   *  bucket for new operators learning a market. */
  distanceKm: number | null;
  /** Most recent slot history. Sorted newest first. Capped at
   *  MAX_HISTORY_PER_VENUE entries. */
  slotHistory: SlotHistoryEntry[];
  /** True when the venue already has an active cold-outreach row
   *  in THIS city_campaign. Drives the "Add to cold outreach"
   *  button — it's hidden when already added. */
  inThisCampaign: boolean;
  /** True for any venue.do_not_contact=true. UI dims those rows
   *  + suppresses the "Add" button regardless of campaign state. */
  doNotContact: boolean;
}

export interface SlotHistoryEntry {
  campaignName: string;
  campaignSlug: string | null;
  eventDate: string; // YYYY-MM-DD
  /** Standardized role label for display: "Wristband", "Middle 2",
   *  "Final", "Alt Final 1", etc. */
  roleLabel: string;
  /** Raw role enum value so the UI can color-code if it wants. */
  role: string;
  status: string;
}

/**
 * Format role + slot_position into a friendly label.
 */
function formatRoleLabel(role: string, slotPosition: number | null): string {
  switch (role) {
    case "wristband":
      return "Wristband";
    case "middle":
      return slotPosition ? `Middle ${slotPosition}` : "Middle";
    case "final":
      return "Final";
    case "alt_final":
      return slotPosition ? `Alt Final ${slotPosition}` : "Alt Final";
    default:
      return role;
  }
}

export async function loadCityVenues(opts: {
  cityId: string;
  /** Pass the current city_campaign id so we can tag which rows
   *  are already added to cold-outreach for it. */
  cityCampaignId: string;
}): Promise<{
  rows: CityVenueRow[];
  totalInCity: number;
  capped: boolean;
}> {
  // -------------------------------------------------------------
  // 1. Total count (for the "X venues in this city" header)
  // -------------------------------------------------------------
  const [countRow] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(venues)
    .where(and(eq(venues.cityId, opts.cityId), isNull(venues.archivedAt)));
  const totalInCity = countRow?.n ?? 0;

  // -------------------------------------------------------------
  // 2. Pull venues — ordered with slot-history venues first via
  //    a subquery that gives a "has history" flag, then alphabetical.
  //    The actual ranking with most-recent-event-first runs in JS
  //    after history is joined (so the UI sees the right order).
  // -------------------------------------------------------------
  const venueRows = await db
    .select({
      venueId: venues.id,
      venueName: venues.name,
      address: venues.address,
      email: venues.email,
      phoneE164: venues.phoneE164,
      websiteUrl: venues.websiteUrl,
      instagramHandle: venues.instagramHandle,
      capacity: venues.capacity,
      venueType: venues.venueType,
      doNotContact: venues.doNotContact,
      // Distance from city centroid in km. Cities.location is a
      // geography(point); we use PostGIS ST_Distance with a cast to
      // geography so the result is in meters → divide by 1000.
      // NULL whenever either point is null.
      distanceKm: sql<number | null>`
        CASE
          WHEN ${venues.location} IS NULL THEN NULL
          ELSE ROUND(
            (ST_Distance(${venues.location},
              (SELECT location FROM cities WHERE id = ${opts.cityId})
            ) / 1000.0)::numeric, 1
          )::float
        END
      `,
    })
    .from(venues)
    .where(and(eq(venues.cityId, opts.cityId), isNull(venues.archivedAt)))
    .orderBy(venues.name)
    .limit(MAX_VENUES);

  if (venueRows.length === 0) {
    return { rows: [], totalInCity, capped: false };
  }

  const venueIds = venueRows.map((v) => v.venueId);

  // -------------------------------------------------------------
  // 3. Slot history — venue_events → events → city_campaigns →
  //    campaigns. We pull the last 5 confirmed/declined entries
  //    per venue (newest first). Includes ALL crawl roles, not
  //    just confirmed, so the operator sees the full footprint.
  //    Cancelled crawls are filtered out (events.cancelled = true).
  // -------------------------------------------------------------
  const historyRows = await db
    .select({
      venueId: venueEvents.venueId,
      eventId: events.id,
      eventDate: events.eventDate,
      eventStatus: events.status,
      role: venueEvents.role,
      slotPosition: venueEvents.slotPosition,
      status: venueEvents.status,
      campaignName: campaigns.name,
      campaignSlug: campaigns.slug,
    })
    .from(venueEvents)
    .innerJoin(events, eq(events.id, venueEvents.eventId))
    .innerJoin(cityCampaigns, eq(cityCampaigns.id, events.cityCampaignId))
    .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
    .where(inArray(venueEvents.venueId, venueIds))
    .orderBy(desc(events.eventDate));

  // -------------------------------------------------------------
  // 4. Cold-outreach entries — already added to THIS campaign?
  //    Single tiny query keyed on city_campaign.
  // -------------------------------------------------------------
  const coldRows = await db
    .select({ venueId: coldOutreachEntries.venueId })
    .from(coldOutreachEntries)
    .where(
      and(
        eq(coldOutreachEntries.cityCampaignId, opts.cityCampaignId),
        isNull(coldOutreachEntries.archivedAt),
      ),
    );
  const addedVenueIds = new Set(coldRows.map((r) => r.venueId));

  // -------------------------------------------------------------
  // 5. Assemble — group history by venue + cap.
  // -------------------------------------------------------------
  const historyByVenue = new Map<string, SlotHistoryEntry[]>();
  for (const h of historyRows) {
    if (h.eventStatus === "cancelled") continue; // skip cancelled crawls
    const existing = historyByVenue.get(h.venueId) ?? [];
    if (existing.length >= MAX_HISTORY_PER_VENUE) continue;
    existing.push({
      campaignName: h.campaignName,
      campaignSlug: h.campaignSlug,
      eventDate: h.eventDate,
      role: h.role,
      roleLabel: formatRoleLabel(h.role, h.slotPosition),
      status: h.status,
    });
    historyByVenue.set(h.venueId, existing);
  }

  const rows: CityVenueRow[] = venueRows.map((v) => ({
    venueId: v.venueId,
    venueName: v.venueName,
    address: v.address,
    email: v.email,
    phoneE164: v.phoneE164,
    websiteUrl: v.websiteUrl,
    instagramHandle: v.instagramHandle,
    capacity: v.capacity,
    venueType: v.venueType ?? [],
    distanceKm: v.distanceKm,
    slotHistory: historyByVenue.get(v.venueId) ?? [],
    inThisCampaign: addedVenueIds.has(v.venueId),
    doNotContact: v.doNotContact,
  }));

  // -------------------------------------------------------------
  // 6. Sort — venues with slot history bubble to top, ordered by
  //    most recent event date. Within "no history" bucket, sort
  //    alphabetically. The UI uses the same array as-is.
  // -------------------------------------------------------------
  rows.sort((a, b) => {
    const aHas = a.slotHistory.length > 0;
    const bHas = b.slotHistory.length > 0;
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (aHas && bHas) {
      // Most recent event first
      const aTop = a.slotHistory[0]?.eventDate ?? "";
      const bTop = b.slotHistory[0]?.eventDate ?? "";
      if (aTop !== bTop) return aTop > bTop ? -1 : 1;
    }
    return a.venueName.localeCompare(b.venueName);
  });

  return {
    rows,
    totalInCity,
    capped: totalInCity > MAX_VENUES,
  };
}
