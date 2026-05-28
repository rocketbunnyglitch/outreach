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
  | "outreach"
  | "need_1_venue"
  | "need_2_venues"
  | "need_3_venues"
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
  /** Tickets sold for this specific crawl across its venue_events */
  ticketsSold: number;
  /** Sales total for this crawl */
  salesCents: number;
}

export const STATUS_PILL_TONE: Record<CityStatusPill, string> = {
  outreach:
    "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:bg-emerald-500/15 dark:text-emerald-300",
  need_1_venue:
    "bg-amber-400/15 text-amber-800 ring-amber-400/30 dark:bg-amber-400/15 dark:text-amber-200",
  need_2_venues:
    "bg-orange-500/15 text-orange-800 ring-orange-500/30 dark:bg-orange-500/15 dark:text-orange-200",
  need_3_venues: "bg-red-500/15 text-red-800 ring-red-500/30 dark:bg-red-500/15 dark:text-red-300",
  cancelled: "bg-zinc-500/8 text-zinc-500 ring-zinc-500/15 line-through dark:text-zinc-500",
};

export const STATUS_PILL_LABEL: Record<CityStatusPill, string> = {
  outreach: "Outreach",
  need_1_venue: "Need 1 venue",
  need_2_venues: "Need 2 venues",
  need_3_venues: "Need 3+ venues",
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

export const SLOT_PILL_LABEL: Record<SlotKind, string> = {
  wristband: "Wristband",
  middle_1: "Middle 1",
  middle_2: "Middle 2",
  middle_pair: "Middle 1 + 2",
  final: "Final",
};
