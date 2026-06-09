/**
 * Venue lifecycle board -- PURE core (no db, no "server-only"), so the lane
 * mapping + bucketing are unit-tested and client-importable. The DB read lives
 * in lib/pipeline-board.ts.
 *
 * Maps a venue_event's real status (+ event date + readiness) onto a kanban
 * lane. The status enum is the operational pipeline; "Confirmed" then splits
 * into Confirmed / Ready / Completed using the readiness signal + event date,
 * so the board shows where post-confirm work actually stands.
 */

export type LaneKey =
  | "lead"
  | "contacted"
  | "warm"
  | "negotiating"
  | "confirmed"
  | "ready"
  | "completed"
  | "cancelled";

export const LANES: ReadonlyArray<{ key: LaneKey; label: string }> = [
  { key: "lead", label: "Cold Lead" },
  { key: "contacted", label: "Emailed" },
  { key: "warm", label: "Warm Reply" },
  { key: "negotiating", label: "Slot Offered" },
  { key: "confirmed", label: "Confirmed" },
  { key: "ready", label: "Ready" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
];

export interface LaneInput {
  /** venue_events.status enum value. */
  status: string;
  /** Days until the event (negative = past). Null when unknown. */
  daysToEvent: number | null;
  /** Readiness DTO resolved to its terminal "ready" state. */
  readinessReady: boolean;
}

/** Map one venue_event onto a lane. */
export function venueEventToLane(input: LaneInput): LaneKey {
  switch (input.status) {
    case "cancelled":
    case "declined":
      return "cancelled";
    case "lead":
      return "lead";
    case "contacted":
      return "contacted";
    case "interested":
      return "warm";
    case "negotiating":
      return "negotiating";
    case "confirmed":
    case "scheduled":
    case "contract_signed": {
      if (input.daysToEvent != null && input.daysToEvent < 0) return "completed";
      return input.readinessReady ? "ready" : "confirmed";
    }
    default:
      return "lead";
  }
}

export interface Lane<T> {
  key: LaneKey;
  label: string;
  items: T[];
}

/**
 * Group lane-tagged items into the canonical lane order, INCLUDING empty lanes
 * (a kanban shows every column even when empty). Input order within a lane is
 * preserved.
 */
export function groupByLane<T extends { lane: LaneKey }>(items: T[]): Lane<T>[] {
  const byKey = new Map<LaneKey, T[]>();
  for (const lane of LANES) byKey.set(lane.key, []);
  for (const item of items) {
    const bucket = byKey.get(item.lane);
    if (bucket) bucket.push(item);
  }
  return LANES.map((lane) => ({
    key: lane.key,
    label: lane.label,
    items: byKey.get(lane.key) ?? [],
  }));
}
