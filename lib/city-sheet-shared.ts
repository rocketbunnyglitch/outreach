/**
 * city-sheet-shared - client-safe types + pure constants for the
 * city sheet. NO 'server-only', NO db import, so client components
 * (CrawlSlotTable) can import freely. The server-only data loader
 * (loadCitySheet) lives in ./city-sheet-data.
 */

export type SlotRole = "wristband" | "middle" | "final" | "alt_final";

/**
 * Canonical display order of slot roles within a crawl: the night runs
 * wristband (entry) → middles → final → alt-finals. Used to sort slot
 * rows so an added Middle 3 sits among the middles, not after the
 * final. (Keep in sync with the venueRole enum — these are the 4
 * values.)
 */
export const SLOT_ROLE_ORDER: Record<SlotRole, number> = {
  wristband: 0,
  middle: 1,
  final: 2,
  alt_final: 3,
};

export interface SlotRow {
  /** venue_event id; null when the slot is empty (placeholder rendered by UI) */
  venueEventId: string | null;
  role: SlotRole;
  slotPosition: number;
  status: string | null;
  venueId: string | null;
  venueName: string | null;
  venueEmail: string | null;
  venuePhone: string | null;
  venueCapacity: number | null;
  agreedHoursText: string | null;
  drinkSpecials: string | null;
  nightOfContactName: string | null;
  scheduledByStaffId: string | null;
  scheduledByStaffName: string | null;
}

export interface GroupMemberRow {
  memberId: string;
  venueId: string;
  venueName: string;
  venueEmail: string | null;
  venueCapacity: number | null;
  status: string;
  agreedHoursText: string | null;
  drinkSpecials: string | null;
}

export interface CrawlHostRef {
  /** crawl_hosts row id (target for removal). */
  id: string;
  hostId: string;
  name: string;
  type: "internal" | "external";
}

export interface CrawlCard {
  eventId: string;
  dayPart: "thursday_night" | "friday_night" | "saturday_night";
  crawlNumber: number;
  /** Free-text crawl name, e.g. "Downtown loop". Null when unnamed. */
  routeLabel: string | null;
  eventDate: string;
  ticketsSold: number;
  /** Up to 2 assigned hosts (internal/external). Empty = no host. */
  hosts: CrawlHostRef[];
  middleVenueGroupId: string | null;
  middleVenueGroupName: string | null;
  /** Other crawls in this city_campaign sharing this group. */
  middleGroupSharedWith: Array<{ eventId: string; label: string }>;
  /** Group's venues. Empty unless middleVenueGroupId is set. */
  middleGroupMembers: GroupMemberRow[];
  /**
   * Slot rows. When middleVenueGroupId is set, the Middle 1/Middle 2
   * default slots are OMITTED — the group's members render in their
   * place. Wristband + Final + Alt Finals are always slot rows.
   */
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
