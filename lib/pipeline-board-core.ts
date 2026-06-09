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

// ===========================================================================
// Drag-to-move + stage gates
// ===========================================================================

/**
 * The status a drop into this lane sets. Only the status-backed pre-confirm
 * lanes + Confirmed are move targets. Ready/Completed are DERIVED (readiness +
 * event date), and Cancelled needs the dedicated cancellation flow -- none are
 * settable by a drag, so they map to null.
 */
const LANE_STATUS: Partial<Record<LaneKey, string>> = {
  lead: "lead",
  contacted: "contacted",
  warm: "interested",
  negotiating: "negotiating",
  confirmed: "confirmed",
};

export function laneToStatus(lane: LaneKey): string | null {
  return LANE_STATUS[lane] ?? null;
}

/** Lanes whose cards can be picked up. Confirmed+ cards are locked on the board
 *  -- un-confirming / cancelling must go through their proper flows. */
export const DRAGGABLE_LANES: ReadonlySet<LaneKey> = new Set<LaneKey>([
  "lead",
  "contacted",
  "warm",
  "negotiating",
]);

/** Lanes a card can be dropped into. */
export const DROP_TARGET_LANES: ReadonlySet<LaneKey> = new Set<LaneKey>([
  "lead",
  "contacted",
  "warm",
  "negotiating",
  "confirmed",
]);

export function isDraggableLane(lane: LaneKey): boolean {
  return DRAGGABLE_LANES.has(lane);
}
export function isDropTarget(lane: LaneKey): boolean {
  return DROP_TARGET_LANES.has(lane);
}

export interface StageGateFields {
  /** Any usable contact: venue email/phone/contact name or night-of contact. */
  hasContact: boolean;
  /** Proposed hours: a slot start time or free-text agreed hours. */
  hasHours: boolean;
}

export interface StageGateResult {
  ok: boolean;
  missing: string[];
}

/**
 * Stage-required-fields gate (Phase 5). Only Confirmed is gated: a venue can't
 * be moved to Confirmed without a contact method AND proposed hours. The
 * earlier pipeline lanes are ungated (you can always walk a lead forward).
 */
export function checkStageGate(targetLane: LaneKey, fields: StageGateFields): StageGateResult {
  if (targetLane !== "confirmed") return { ok: true, missing: [] };
  const missing: string[] = [];
  if (!fields.hasContact) missing.push("a contact (email, phone or contact name)");
  if (!fields.hasHours) missing.push("proposed hours or a slot time");
  return { ok: missing.length === 0, missing };
}
