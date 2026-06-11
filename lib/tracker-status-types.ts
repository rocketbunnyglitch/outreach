/**
 * Client-safe tracker status types + presentation constants.
 *
 * Split from `lib/tracker-status.ts` (which is `import "server-only"`
 * because it runs SQL) so that client components — the dashboard
 * tracker table, the city sheet header, etc. — can import the types
 * and label/tone maps without pulling the server-only marker into the
 * client bundle and breaking the build.
 *
 * If you add a new server-side helper that uses these types, import
 * the types from THIS file in the server module, not the other way
 * around. The arrow of dependency is always: tracker-status.ts (server,
 * uses DB) → tracker-status-types.ts (pure, no I/O).
 */

export type CityStatusPill =
  | "complete"
  | "outreach"
  | "need_1_venue"
  | "need_2_venues"
  | "need_3_venues"
  | "to_be_cancelled"
  | "cancelled";

export type SlotKind = "wristband" | "middle_pair" | "middle_1" | "middle_2" | "final";

export interface CityNeedSummary {
  cityCampaignId: string;
  statusPill: CityStatusPill;
  openSlotCount: number;
  /** Aggregated slot pills across all crawls for this city. */
  slots: SlotKind[];
  crawlBreakdown: CrawlNeed[];
}

export interface CrawlNeed {
  /** The event id this crawl maps to — target for the per-crawl
      status override. */
  eventId: string;
  /** Composite key — same day_part + crawl_number identifies a crawl */
  dayPart: string;
  crawlNumber: number;
  /** The crawl's own eventStatus (planned/confirmed/…); editable
      inline from the expanded tracker row. */
  status: "planned" | "confirmed" | "contract_signed" | "completed" | "cancelled";
  needsWristband: boolean;
  needsMiddle1: boolean;
  needsMiddle2: boolean;
  needsFinal: boolean;
  /**
   * True when this crawl HAS a final-venue slot (standard format).
   * False when it doesn't (day_party format = wristband + 2 middles
   * only). Distinguished from needsFinal: needsFinal=false can mean
   * "slot exists and is filled" OR "slot doesn't exist at all". The
   * tracker need-bar uses hasFinalSlot to decide whether to render
   * the 4th segment at all — day crawls render only 3 segments.
   *
   * Sourced from events.required_final_count > 0 in tracker-status.ts.
   */
  hasFinalSlot: boolean;
  /** Tickets sold for this specific crawl across its venue_events.
   *  The tracker displays raw COUNTS (operator request 2026-06-11) —
   *  the old derived salesCents (tickets x $30) is gone. */
  ticketsSold: number;
  /**
   * Shipping status of THIS crawl's wristband-role venue (from the
   * wristbands table). null = no wristband row yet. Drives the per-crawl
   * wristband indicator: red (not shipped: pending/ready_to_ship/issue/null),
   * yellow (shipped), green (delivered).
   */
  wristbandStatus: "pending" | "ready_to_ship" | "shipped" | "delivered" | "issue" | null;
  /**
   * Slot-1 host kind for this crawl. Drives a per-crawl host icon
   * shown beside the wristband icon in the dashboard breakdown:
   *   - "internal" → person with down-arrow, blue (in-house host)
   *   - "external" → person with out-arrow, orange (third-party host)
   *   - "none"     → person with strike-through, grey (no host needed)
   *
   * Sourced from crawl_hosts where slot=1; absent crawl_hosts row
   * means "no host needed" (the operator hasn't picked one OR the
   * crawl genuinely doesn't need one — the icon reads the same).
   */
  hostType: "internal" | "external" | "none";
  /** Per-crawl operator note (events.notes). Edited inline from the
   *  tracker's expanded breakdown row. Empty string when not set. */
  notes: string;
  /** True when at least one cold outreach email has been sent for a
   *  venue tied to this crawl's event. Drives the "grey vs red"
   *  distinction in the dashboard glow visualization — operators
   *  want to see "haven't started" (grey) separately from "started
   *  but nothing booked" (red). */
  outreachStarted: boolean;
  /** Filled-venue count for this crawl (0..4). Cached on the row so
   *  the dashboard glow viz can pick a color without re-deriving
   *  from the needsX booleans. */
  confirmedVenueCount: number;
}

export const STATUS_PILL_TONE: Record<CityStatusPill, string> = {
  // Complete = every slot across every crawl is filled by a confirmed
  // venue of the matching role. Reads as a solid green "done" badge,
  // distinct from the softer "outreach" green (engine still working).
  complete:
    "bg-emerald-500/20 text-emerald-800 ring-emerald-500/40 dark:bg-emerald-500/20 dark:text-emerald-200",
  outreach:
    "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:bg-emerald-500/15 dark:text-emerald-300",
  // Need 1 → blue (mild, "just one more"). Need 2 → yellow (more
  // urgent). Need 3 → orange (most urgent). Per operator request:
  // "need 1 pill should be blue, need 2 should be yellow, need 3
  // should be orange." The escalation reads as cool → warm → hot
  // and the pills now don't fight with the amber-reserved-for-
  // legitimate-status convention.
  need_1_venue:
    "bg-blue-500/10 text-blue-700 ring-blue-500/30 dark:bg-blue-500/15 dark:text-blue-300",
  need_2_venues:
    "bg-yellow-400/15 text-yellow-800 ring-yellow-400/30 dark:bg-yellow-400/15 dark:text-yellow-200",
  need_3_venues:
    "bg-orange-500/15 text-orange-800 ring-orange-500/30 dark:bg-orange-500/15 dark:text-orange-200",
  // To-be-cancelled = the city_campaign hasn't been hard-cancelled yet
  // but is flagged for cancellation (status='to_be_cancelled'). Amber-
  // tinted so it reads as a warning state, NOT the terminal grey of a
  // real cancellation.
  to_be_cancelled:
    "bg-amber-500/15 text-amber-800 ring-amber-500/30 dark:bg-amber-500/15 dark:text-amber-200",
  cancelled: "bg-zinc-500/8 text-zinc-500 ring-zinc-500/15 line-through dark:text-zinc-500",
};

export const STATUS_PILL_LABEL: Record<CityStatusPill, string> = {
  complete: "Complete",
  outreach: "Outreach",
  need_1_venue: "Need 1 venue",
  need_2_venues: "Need 2 venues",
  need_3_venues: "Need 3+ venues",
  to_be_cancelled: "To be cancelled",
  cancelled: "Cancelled",
};

/**
 * Slot pills — tuned amber-400 → orange-500 → red-500 so when all three
 * line up they read as ONE continuous gradient bar, not three stickers.
 */
export const SLOT_PILL_TONE: Record<SlotKind, string> = {
  wristband: "bg-amber-400 text-amber-950 shadow-sm shadow-amber-400/30",
  middle_1: "bg-orange-500 text-orange-50 shadow-sm shadow-orange-500/30",
  middle_2: "bg-orange-500 text-orange-50 shadow-sm shadow-orange-500/30",
  middle_pair: "bg-orange-500 text-orange-50 shadow-sm shadow-orange-500/30",
  final: "bg-red-500 text-red-50 shadow-sm shadow-red-500/30",
};

/**
 * Long-form labels used in tooltips and accessible labels — the rendered
 * pill text uses SLOT_PILL_LABEL (short) so it can fit on a single line
 * at narrow viewport widths without wrapping or being cropped.
 */
export const SLOT_PILL_LABEL_LONG: Record<SlotKind, string> = {
  wristband: "Wristband",
  middle_1: "Middle 1",
  middle_2: "Middle 2",
  middle_pair: "Middle 1 + 2",
  final: "Final",
};

/**
 * Short pill text. The tracker breakdown line gets very tight on narrower
 * screens — "Wristband · Middle 1 + 2 · Final" wraps onto two lines and
 * breaks the continuous-bar visual. Operator request: abbreviate W / M1 /
 * M2 / F so the line never wraps. The long form lives in
 * SLOT_PILL_LABEL_LONG for tooltips and aria-labels so the meaning is
 * still discoverable.
 */
export const SLOT_PILL_LABEL: Record<SlotKind, string> = {
  wristband: "W",
  middle_1: "M1",
  middle_2: "M2",
  middle_pair: "M1+2",
  final: "F",
};

// =========================================================================
// Day-part formatting — centralized so every surface renders the same
// =========================================================================

/** Every value from the day_part DB enum, in chronological-by-week order. */
export type DayPart =
  | "thursday_night"
  | "friday_night"
  | "saturday_day"
  | "saturday_night"
  | "sunday_day"
  | "sunday_night"
  | "other";

/** Full title-case label, e.g. "Saturday Night". Used in crawl headers and
 *  print sheets. The null fallback ("Crawl") matches the operator's mental
 *  model: an unset day_part is "just a crawl on this date." */
export const DAY_PART_LABEL_FULL: Record<DayPart, string> = {
  thursday_night: "Thursday Night",
  friday_night: "Friday Night",
  saturday_day: "Saturday Day",
  saturday_night: "Saturday Night",
  sunday_day: "Sunday Day",
  sunday_night: "Sunday Night",
  other: "Other",
};

/** Short label, e.g. "Saturday". Used inline next to "crawl 1" in the
 *  city-sheet crawl header. The day-part-of-week is what operators
 *  actually say out loud — "Saturday Crawl 1." */
export const DAY_PART_LABEL_DAY: Record<DayPart, string> = {
  thursday_night: "Thursday",
  friday_night: "Friday",
  saturday_day: "Saturday",
  saturday_night: "Saturday",
  sunday_day: "Sunday",
  sunday_night: "Sunday",
  other: "Other",
};

/** 3-letter compact label for grid rows. saturday_day and saturday_night
 *  both render as "Sat" deliberately — the grid groups by day_part value
 *  not by weekday, so two distinct rows can both say "Sat" when both
 *  saturday day-parts have crawls. */
export const DAY_PART_LABEL_SHORT: Record<DayPart, string> = {
  thursday_night: "Thu",
  friday_night: "Fri",
  saturday_day: "Sat",
  saturday_night: "Sat",
  sunday_day: "Sun",
  sunday_night: "Sun",
  other: "Oth",
};

/** Safe formatter — handles every enum value, null, and unknown strings.
 *  Use this everywhere a day_part is displayed so a DB value the type
 *  system doesn't know about (e.g. a future enum addition before the
 *  client is rebuilt) renders as something legible rather than the empty
 *  string + a confusing "crawl 1" with no prefix. */
export function formatDayPart(
  dp: string | null | undefined,
  style: "full" | "day" | "short" = "day",
): string {
  if (!dp) return style === "short" ? "—" : "Crawl";
  const label =
    style === "full"
      ? (DAY_PART_LABEL_FULL as Record<string, string>)[dp]
      : style === "short"
        ? (DAY_PART_LABEL_SHORT as Record<string, string>)[dp]
        : (DAY_PART_LABEL_DAY as Record<string, string>)[dp];
  if (label) return label;
  // Unknown enum value — title-case-replace the underscore as a graceful
  // fallback (e.g. "monday_night" → "Monday Night"). Never returns empty
  // string so the calling component is guaranteed a non-blank label.
  return dp.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// =========================================================================
// Country code → display abbreviation
// =========================================================================

/**
 * Map ISO 3166-1 alpha-2 country codes (CA / US / GB / IE / AU…) to
 * the user-friendly abbreviation operators read in their head.
 *
 *   GB → UK   (vernacular over ISO)
 *   US → USA  (3-letter feels more like a country than 2)
 *   CA → CAN
 *
 * Used by the tracker city-name badge per operator: "the country
 * abbrev needs to be beside the city like London CAN or London UK".
 *
 * Anything not in the map falls through to the original 2-letter
 * code uppercased, so a brand-new country still renders something
 * reasonable. Empty input returns empty string so the caller can
 * decide whether to render the badge at all.
 */
const COUNTRY_DISPLAY_ABBREV: Record<string, string> = {
  CA: "CAN",
  US: "USA",
  GB: "UK",
  IE: "IRE",
  AU: "AUS",
  NZ: "NZL",
  // Add more as the operator's market expands.
};

export function formatCountryAbbrev(code: string | null | undefined): string {
  if (!code) return "";
  const upper = code.toUpperCase();
  return COUNTRY_DISPLAY_ABBREV[upper] ?? upper;
}
