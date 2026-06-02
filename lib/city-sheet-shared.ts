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
  /**
   * OTHER usages of this slot's venue within the SAME city_campaign --
   * the same venue working a different crawl and/or a different role.
   * Empty when the venue is only used here (or the slot is empty). Drives
   * a "reuse" chip so the operator sees at a glance that a venue is doing
   * double duty (e.g. middle in Fri #1, wristband in Sat #2). Cross-crawl
   * reuse is legitimate in real Halloween ops -- this is informational,
   * not a warning.
   */
  reuse: SlotReuseRef[];
}

export interface SlotReuseRef {
  eventId: string;
  /** Display label for the other crawl, e.g. "Saturday crawl 2". */
  crawlLabel: string;
  role: SlotRole;
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
  /** 1 or 2. Slot 1 is the wristband slot (host-type selector lives there). */
  slot: number;
  /** Per-crawl internal-host capture (host_type='internal'). */
  internalHostName: string | null;
  internalHostHours: string | null;
  internalHostRateCents: number | null;
  /** True when host_type='external' but no external host assigned yet. */
  externalPending: boolean;
}

export interface CrawlCard {
  eventId: string;
  /** Day part for this crawl. NULL means the operator didn't set one
   *  (legacy data, CSV imports, etc.). Surfaces render via
   *  formatDayPart() from tracker-status-types so every enum value
   *  AND null are handled gracefully. Previously typed as only 3
   *  values; that lied to TypeScript and caused "{undefined} crawl 1"
   *  → "crawl 1" rendering bugs for any of the other enum values. */
  dayPart:
    | "thursday_night"
    | "friday_night"
    | "saturday_day"
    | "saturday_night"
    | "sunday_day"
    | "sunday_night"
    | "other"
    | null;
  crawlNumber: number;
  /**
   * Operator-set crawl name. Set via the bulk-rename tool on
   * /tracker or per-event on /crawl-management. When non-null,
   * REPLACES the auto-generated "Saturday crawl N" header in
   * the slot-table title (e.g. operator renames Saturday Crawl 4
   * to "Day Party" → header reads "Day Party" instead).
   *
   * Distinct from routeLabel which is a free-text description
   * (e.g. "Downtown loop") rendered AFTER the title as a quiet
   * subtitle.
   */
  crawlName: string | null;
  /** Free-text crawl description, e.g. "Downtown loop". Null when unset. */
  routeLabel: string | null;
  eventDate: string;
  ticketsSold: number;
  /**
   * Wristband shipping rollup for this crawl, derived from the
   * wristbands row tied to the wristband-role venue_event. Drives the
   * status dot next to an expanded crawl:
   *   - "none":      no wristband venue_event yet (nothing to ship)
   *   - "not_shipped": row exists but not shipped (red)
   *   - "shipped":   shipped, not yet delivered (yellow)
   *   - "received":  delivered (green)
   */
  wristbandShip: "none" | "not_shipped" | "shipped" | "received";
  /** wristband-role venue_event id, for deep-linking the wristband sheet. */
  wristbandVenueEventId: string | null;
  /** Up to 2 assigned hosts (internal/external). Empty = no host. */
  hosts: CrawlHostRef[];
  middleVenueGroupId: string | null;
  middleVenueGroupName: string | null;
  /** Other crawls in this city_campaign sharing this group. */
  middleGroupSharedWith: Array<{ eventId: string; label: string }>;
  /** Group's venues. Empty unless middleVenueGroupId is set. */
  middleGroupMembers: GroupMemberRow[];
  /**
   * Crawl shape (events.crawl_format).
   *   "standard"  — wristband + 2 middles + final (4 venues)
   *   "day_party" — wristband + 2 middles, NO final (3 venues min)
   *
   * Drives slot table layout (defaultSlots in city-sheet-data.ts
   * drops the final default row when day_party) and the
   * crawl-slot-table's hasMinSlots check (day_party needs 3 instead
   * of 4 to count as fully booked).
   */
  crawlFormat: "standard" | "day_party";
  /**
   * Slot rows. When middleVenueGroupId is set, the Middle 1/Middle 2
   * default slots are OMITTED — the group's members render in their
   * place. Wristband + Final + Alt Finals are always slot rows
   * (except: when crawlFormat='day_party', Final is omitted too).
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
