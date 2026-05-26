import "server-only";

/**
 * City sheet data loader.
 *
 * Given a city_campaign id, returns the full operational picture:
 *   - city + campaign + assigned lead staffer
 *   - all crawls (events) grouped by day_part with crawl_number ordering
 *   - per-crawl slot composition: wristband, middle 1, middle 2, final
 *     (each populated from venue_events ordered by slot_position)
 *   - shared middle venue group(s) attached to events on the same day
 *   - venue details for autocomplete (capacity, email, address)
 *   - staff list for "Scheduled by" dropdown
 *
 * One join-heavy query per logical concern, paralleled with Promise.all.
 * Returns plain serializable shapes — no Drizzle row types leak through.
 */

import {
  events,
  campaigns,
  cities,
  cityCampaigns,
  middleVenueGroups,
  staffMembers,
  venueEvents,
  venues,
} from "@/db/schema";
import { db } from "@/lib/db";
import { asc, eq, inArray } from "drizzle-orm";

export type SlotRole = "wristband" | "middle" | "final" | "alt_final";

export interface SlotRow {
  /** venue_event id; null when the slot is empty (placeholder rendered by UI) */
  venueEventId: string | null;
  role: SlotRole;
  slotPosition: number;
  status: string | null;
  venueId: string | null;
  venueName: string | null;
  venueEmail: string | null;
  venueCapacity: number | null;
  agreedHoursText: string | null;
  drinkSpecials: string | null;
  nightOfContactName: string | null;
  scheduledByStaffId: string | null;
  scheduledByStaffName: string | null;
}

export interface CrawlCard {
  eventId: string;
  dayPart: "thursday" | "friday" | "saturday";
  crawlNumber: number;
  eventDate: string;
  ticketsSold: number;
  middleVenueGroupId: string | null;
  middleVenueGroupName: string | null;
  /** Always 4 default slots (wristband, middle 1, middle 2, final), plus extras. */
  slots: SlotRow[];
}

export interface CitySheetData {
  cityCampaignId: string;
  cityId: string;
  cityName: string;
  cityRegion: string | null;
  cityTimezone: string;
  campaignId: string;
  campaignName: string;
  priority: number;
  status: "planning" | "active" | "confirmed" | "cancelled";
  leadStaffId: string | null;
  leadStaffName: string | null;
  dashboardNote: string | null;
  crawls: CrawlCard[];
  staff: Array<{ id: string; displayName: string }>;
}

export async function loadCitySheet(cityCampaignId: string): Promise<CitySheetData | null> {
  const header = await db
    .select({
      cc: cityCampaigns,
      city: cities,
      campaign: campaigns,
      leadStaff: staffMembers,
    })
    .from(cityCampaigns)
    .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
    .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
    .leftJoin(staffMembers, eq(staffMembers.id, cityCampaigns.leadStaffId))
    .where(eq(cityCampaigns.id, cityCampaignId))
    .limit(1)
    .then((r) => r[0]);

  if (!header) return null;

  // Events in this city_campaign, ordered for stable crawl display
  const eventRows = await db
    .select({
      id: events.id,
      dayPart: events.dayPart,
      crawlNumber: events.crawlNumber,
      eventDate: events.eventDate,
      ticketsSold: events.ticketSalesCount,
      middleVenueGroupId: events.middleVenueGroupId,
    })
    .from(events)
    .where(eq(events.cityCampaignId, cityCampaignId))
    .orderBy(asc(events.dayPart), asc(events.crawlNumber));

  const eventIds = eventRows.map((e) => e.id);

  // venue_events filled per event
  const veRows =
    eventIds.length > 0
      ? await db
          .select({
            id: venueEvents.id,
            eventId: venueEvents.eventId,
            role: venueEvents.role,
            slotPosition: venueEvents.slotPosition,
            status: venueEvents.status,
            agreedHoursText: venueEvents.agreedHoursText,
            drinkSpecials: venueEvents.drinkSpecials,
            nightOfContactName: venueEvents.nightOfContactName,
            ourContactStaffId: venueEvents.ourContactStaffId,
            venueId: venues.id,
            venueName: venues.name,
            venueEmail: venues.email,
            venueCapacity: venues.capacity,
            staffName: staffMembers.displayName,
          })
          .from(venueEvents)
          .innerJoin(venues, eq(venues.id, venueEvents.venueId))
          .leftJoin(staffMembers, eq(staffMembers.id, venueEvents.ourContactStaffId))
          .where(inArray(venueEvents.eventId, eventIds))
          .orderBy(asc(venueEvents.role), asc(venueEvents.slotPosition))
      : [];

  // Middle venue groups (for label display)
  const groupIds = Array.from(
    new Set(eventRows.map((e) => e.middleVenueGroupId).filter((v): v is string => !!v)),
  );
  const groupRows =
    groupIds.length > 0
      ? await db
          .select({ id: middleVenueGroups.id, name: middleVenueGroups.name })
          .from(middleVenueGroups)
          .where(inArray(middleVenueGroups.id, groupIds))
      : [];
  const groupNameById = new Map(groupRows.map((g) => [g.id, g.name]));

  // Staff for dropdowns
  const staff = await db
    .select({ id: staffMembers.id, displayName: staffMembers.displayName })
    .from(staffMembers)
    .where(eq(staffMembers.status, "active"))
    .orderBy(asc(staffMembers.displayName));

  // Compose crawls with default 4 slots (wristband, middle 1, middle 2, final)
  // plus any extra middles or alt_finals already filled.
  const crawls: CrawlCard[] = eventRows.map((ev) => {
    const ves = veRows.filter((v) => v.eventId === ev.id);

    // Required default slots
    const defaultSlots: Array<{ role: SlotRole; slotPosition: number }> = [
      { role: "wristband", slotPosition: 1 },
      { role: "middle", slotPosition: 1 },
      { role: "middle", slotPosition: 2 },
      { role: "final", slotPosition: 1 },
    ];

    // Pull in extras: any ve with role+position not in defaultSlots
    const extras = ves.filter(
      (v) =>
        !defaultSlots.some((d) => d.role === v.role && d.slotPosition === (v.slotPosition ?? 1)),
    );

    // Stable order: defaults first, then extras grouped by role
    const slots: SlotRow[] = [
      ...defaultSlots.map((d) => {
        const filled = ves.find(
          (v) => v.role === d.role && (v.slotPosition ?? 1) === d.slotPosition,
        );
        return slotRowFrom(filled, d.role, d.slotPosition);
      }),
      ...extras
        .sort(
          (a, b) => a.role.localeCompare(b.role) || (a.slotPosition ?? 0) - (b.slotPosition ?? 0),
        )
        .map((v) => slotRowFrom(v, v.role as SlotRole, v.slotPosition ?? 1)),
    ];

    return {
      eventId: ev.id,
      dayPart: (ev.dayPart as "thursday" | "friday" | "saturday") ?? "saturday",
      crawlNumber: ev.crawlNumber ?? 1,
      eventDate: String(ev.eventDate ?? ""),
      ticketsSold: ev.ticketsSold ?? 0,
      middleVenueGroupId: ev.middleVenueGroupId,
      middleVenueGroupName: ev.middleVenueGroupId
        ? (groupNameById.get(ev.middleVenueGroupId) ?? null)
        : null,
      slots,
    };
  });

  return {
    cityCampaignId: header.cc.id,
    cityId: header.city.id,
    cityName: header.city.name,
    cityRegion: header.city.region,
    cityTimezone: header.city.timezone,
    campaignId: header.campaign.id,
    campaignName: header.campaign.name,
    priority: header.cc.priority ?? 5,
    status: (header.cc.status as CitySheetData["status"]) ?? "planning",
    leadStaffId: header.cc.leadStaffId,
    leadStaffName: header.leadStaff?.displayName ?? null,
    dashboardNote: header.cc.dashboardNote,
    crawls,
    staff,
  };
}

type VenueEventRow = {
  id: string;
  eventId: string;
  role: string;
  slotPosition: number | null;
  status: string;
  agreedHoursText: string | null;
  drinkSpecials: string | null;
  nightOfContactName: string | null;
  ourContactStaffId: string | null;
  venueId: string;
  venueName: string;
  venueEmail: string | null;
  venueCapacity: number | null;
  staffName: string | null;
};

function slotRowFrom(ve: VenueEventRow | undefined, role: SlotRole, position: number): SlotRow {
  if (!ve) {
    return {
      venueEventId: null,
      role,
      slotPosition: position,
      status: null,
      venueId: null,
      venueName: null,
      venueEmail: null,
      venueCapacity: null,
      agreedHoursText: null,
      drinkSpecials: null,
      nightOfContactName: null,
      scheduledByStaffId: null,
      scheduledByStaffName: null,
    };
  }
  return {
    venueEventId: ve.id,
    role,
    slotPosition: position,
    status: ve.status,
    venueId: ve.venueId,
    venueName: ve.venueName,
    venueEmail: ve.venueEmail,
    venueCapacity: ve.venueCapacity,
    agreedHoursText: ve.agreedHoursText,
    drinkSpecials: ve.drinkSpecials,
    nightOfContactName: ve.nightOfContactName,
    scheduledByStaffId: ve.ourContactStaffId,
    scheduledByStaffName: ve.staffName,
  };
}
