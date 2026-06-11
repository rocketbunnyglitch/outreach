/**
 * Rot math — ONE place for "how long is too long" (CRM plan C2).
 *
 * Pure + client-safe (no db, no server-only): the same thresholds feed
 * the aging-watchdog cron (lib/aging-watchdog.ts) AND the in-place
 * <RotChip> on list rows, so what the watchdog notifies about and what
 * the operator sees on the row can never disagree.
 *
 * Two flavours of rot:
 *   - AGE-based: the thing has been waiting too long (warm reply,
 *     cold entry untouched, pending deliverable, V2 call overdue,
 *     replacement push open). Measured in hours since the trigger.
 *   - WINDOW-based: the thing is undone too close to the event
 *     (wristbands unshipped <14d, no host <7d). Those window constants
 *     live here too so the watchdog + health + chips share them.
 */

export type RotKind =
  | "warm_reply"
  | "cold_outreach"
  | "pending_deliverable"
  | "v2_call"
  | "replacement_push";

export type RotSeverity = "none" | "warn" | "late" | "critical";

interface RotThreshold {
  /** Hours at which the row starts to show rot (amber). */
  warnHours: number;
  /** Hours at which it is clearly late (orange). */
  lateHours: number;
  /** Hours at which the watchdog escalates (red). */
  criticalHours: number;
}

export const ROT_THRESHOLDS: Record<RotKind, RotThreshold> = {
  /** A venue wrote back and is waiting on us. critical == the aging
   *  watchdog's 48h needs-reply rule. */
  warm_reply: { warnHours: 4, lateHours: 24, criticalHours: 48 },
  /** Cold entry emailed / follow-up due with no touch. late == the
   *  watchdog's 10-day stale-cold rule. */
  cold_outreach: { warnHours: 7 * 24, lateHours: 10 * 24, criticalHours: 14 * 24 },
  /** Deliverable (graphic, sheet, poster) sitting pending. */
  pending_deliverable: { warnHours: 3 * 24, lateHours: 7 * 24, criticalHours: 10 * 24 },
  /** V2 confirmation call due and not completed. */
  v2_call: { warnHours: 24, lateHours: 48, criticalHours: 72 },
  /** Emergency replacement push still open — every hour matters. */
  replacement_push: { warnHours: 4, lateHours: 12, criticalHours: 24 },
};

/** Wristbands unshipped inside this many days of the event = rotting.
 *  Shared with the aging watchdog + health score. */
export const WRISTBAND_WINDOW_DAYS = 14;
/** No host inside this many days of the event = rotting. */
export const HOST_WINDOW_DAYS = 7;

export function rotSeverity(kind: RotKind, ageHours: number): RotSeverity {
  const t = ROT_THRESHOLDS[kind];
  if (ageHours >= t.criticalHours) return "critical";
  if (ageHours >= t.lateHours) return "late";
  if (ageHours >= t.warnHours) return "warn";
  return "none";
}

/** Compact age label: 5h, 3d, 2w. Hours under 1 round up to 1h. */
export function formatRotAge(ageHours: number): string {
  const h = Math.max(1, Math.round(ageHours));
  if (h < 48) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
}
