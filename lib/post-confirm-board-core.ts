/**
 * Post-confirm board -- PURE core (no db, no "server-only"). Buckets a CONFIRMED
 * venue_event into the single most-relevant outstanding post-confirmation step,
 * so the board reads as a progression: make the graphic -> send the info sheet
 * -> T13 -> T14 -> V2 floor-staff call -> Ready.
 *
 * Assignment is "earliest outstanding step in the sequence": graphic and info
 * sheet are immediate prep (outstanding until done); T13/T14 are time-gated
 * email touches (only "due" when their scheduled send arrives); V2 is the
 * floor-staff call window. A confirmed venue with prep done but nothing
 * currently due and not fully ready lands in "On Track" (nothing is hidden).
 */

export type PostConfirmLane = "graphic" | "sheet" | "t13" | "t14" | "v2" | "on_track" | "ready";

export const POST_CONFIRM_LANES: ReadonlyArray<{ key: PostConfirmLane; label: string }> = [
  { key: "graphic", label: "Graphic Needed" },
  { key: "sheet", label: "Sheet Needed" },
  { key: "t13", label: "T13 Due" },
  { key: "t14", label: "T14 Due" },
  { key: "v2", label: "V2 Call Due" },
  { key: "on_track", label: "On Track" },
  { key: "ready", label: "Ready" },
];

export interface PostConfirmFlags {
  /** social_media_graphics deliverable still pending. */
  needsGraphic: boolean;
  /** No staff info sheet generated yet. */
  needsSheet: boolean;
  /** A T13 draft is due (scheduled_for <= now, not sent). */
  t13Due: boolean;
  /** A T14 draft is due. */
  t14Due: boolean;
  /** Confirmed, inside the 0-4 day window, floor-staff call not done. */
  v2Due: boolean;
  /** Readiness DTO is fully "ready". */
  isReady: boolean;
}

/** Assign the single most-relevant lane (earliest outstanding step). */
export function assignPostConfirmLane(f: PostConfirmFlags): PostConfirmLane {
  if (f.needsGraphic) return "graphic";
  if (f.needsSheet) return "sheet";
  if (f.t13Due) return "t13";
  if (f.t14Due) return "t14";
  if (f.v2Due) return "v2";
  return f.isReady ? "ready" : "on_track";
}

export interface PostConfirmColumn<T> {
  key: PostConfirmLane;
  label: string;
  items: T[];
}

/** Group lane-tagged items into canonical order, including empty lanes. */
export function groupByPostConfirmLane<T extends { lane: PostConfirmLane }>(
  items: T[],
): PostConfirmColumn<T>[] {
  const byKey = new Map<PostConfirmLane, T[]>();
  for (const lane of POST_CONFIRM_LANES) byKey.set(lane.key, []);
  for (const item of items) byKey.get(item.lane)?.push(item);
  return POST_CONFIRM_LANES.map((lane) => ({
    key: lane.key,
    label: lane.label,
    items: byKey.get(lane.key) ?? [],
  }));
}
