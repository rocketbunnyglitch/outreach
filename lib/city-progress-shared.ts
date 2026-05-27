/**
 * city-progress-shared — client-safe types + pure helpers for
 * city-campaign progress. NO "server-only", NO db import, so this is
 * safe to import from client components. The server-only data loader
 * (loadCityCampaignProgress) lives in ./city-progress.
 */

export type SlotState = "empty" | "cold" | "warm" | "verbal" | "confirmed" | "declined";

export interface CitySlot {
  /** "wristband" | "middle" | "final" — the operator-facing label uses these. */
  role: "wristband" | "middle" | "final";
  /** 1-indexed position WITHIN the role. wristband always 1, middle 1..N, final 1. */
  position: number;
  state: SlotState;
  /** Populated for non-empty slots. */
  venueName: string | null;
  /** Populated for non-empty slots — drives the next-action display. */
  venueEventId: string | null;
}

export interface CityCrawl {
  eventId: string;
  eventDate: string; // YYYY-MM-DD
  dayPart: string | null;
  crawlNumber: number | null;
  /** Required venue mix for this crawl. Defaults are 1/2/1 but the
      schema allows overrides per event (e.g. 1/3/1 for extended). */
  requiredWristband: number;
  requiredMiddle: number;
  requiredFinal: number;
  slots: CitySlot[];
  /** Days from today to this crawl's event_date. Negative if past. */
  daysUntil: number;
}

export interface CityProgressRow {
  cityCampaignId: string;
  cityName: string;
  cityRegion: string | null;
  priority: number; // 1=highest
  status: string;
  targetVenueCount: number;
  leadStaffName: string | null;
  salesGoalCents: bigint | null;
  /** Each crawl's slot states. Ordered by event_date ASC. */
  crawls: CityCrawl[];
  /** Aggregate pipeline counts (cold-outreach + the venue_events in
      pre-confirmed states), useful for the pipeline-health icon. */
  pipeline: {
    cold: number;
    warm: number;
    verbal: number;
    declined: number;
    /** Total slots open across all upcoming crawls (sum of required
        counts minus confirmed venue_events). */
    openSlots: number;
    /** Total slots required across all upcoming crawls. */
    totalSlots: number;
  };
  /** Days until the soonest upcoming event. null when there are no
      future events. */
  soonestEventDays: number | null;
  risk: CityRisk;
}

export type CityRisk = "low" | "medium" | "high" | "critical";

/** Pipeline health label for the icon next to the city name. */
export type PipelineHealth = "healthy" | "thin" | "weak" | "none";

export function pipelineHealthFor(row: CityProgressRow): PipelineHealth {
  const p = row.pipeline;
  const positive = p.warm + p.verbal;
  if (p.openSlots === 0) return "healthy"; // nothing to do
  if (positive >= p.openSlots * 2) return "healthy";
  if (positive >= p.openSlots) return "thin";
  if (positive + p.cold >= p.openSlots) return "weak";
  return "none";
}
