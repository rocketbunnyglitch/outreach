import "server-only";

/**
 * Event-day readiness summary (Phase 3.13). [ReferenceDoc 7.14.3]
 *
 * A small read helper that rolls the per-venue_event prep timestamps into a
 * single readiness DTO for the worklist briefing-call surface. It reports which
 * lifecycle steps are done vs pending and a single status label so the operator
 * can see at a glance whether a confirmed venue is actually ready for the night.
 *
 * Pure-ish: one indexed read by venue_event id, no writes. Steps are derived
 * from the venue_events checkpoint timestamps the cascade / lifecycle / calls
 * populate:
 *   - confirmed_at                 -> "Confirmed"
 *   - two_week_email_sent_at       -> "2-week email"
 *   - one_week_email_sent_at       -> "1-week email"
 *   - three_day_call_completed_at  -> "3-day call"
 *   - floor_staff_call_completed_at-> "Floor staff briefed"
 *
 * floor_staff_call_attempts is surfaced (not a step) so the caller can show the
 * 3+-attempt escalation state next to the readiness pill.
 */

import { venueEvents } from "@/db/schema";
import { db } from "@/lib/db";
import { eq } from "drizzle-orm";

export type ReadinessStepKey =
  | "confirmed"
  | "two_week_email"
  | "one_week_email"
  | "three_day_call"
  | "floor_staff_briefed";

export interface ReadinessStep {
  key: ReadinessStepKey;
  label: string;
  done: boolean;
}

/** Overall label: ready (all done), on_track (some pending), at_risk (briefing
 *  not done + 3+ attempts), not_started (nothing done). */
export type ReadinessStatus = "ready" | "on_track" | "at_risk" | "not_started";

export interface EventReadiness {
  venueEventId: string;
  status: ReadinessStatus;
  /** Short human label for the pill (e.g. "Ready", "On track", "At risk"). */
  statusLabel: string;
  steps: ReadinessStep[];
  doneCount: number;
  totalCount: number;
  floorStaffCallAttempts: number;
}

const STEP_LABELS: Record<ReadinessStepKey, string> = {
  confirmed: "Confirmed",
  two_week_email: "2-week email",
  one_week_email: "1-week email",
  three_day_call: "3-day call",
  floor_staff_briefed: "Floor staff briefed",
};

const STATUS_LABELS: Record<ReadinessStatus, string> = {
  ready: "Ready",
  on_track: "On track",
  at_risk: "At risk",
  not_started: "Not started",
};

/** Escalation threshold for floor-staff call attempts (3+). */
export const FLOOR_STAFF_ESCALATION_ATTEMPTS = 3;

/**
 * Compute the readiness DTO from a row already in hand (no DB read). Exposed so
 * the worklist loader -- which already selects these columns -- can build the
 * pill without a second query per row.
 */
export function readinessFromRow(row: {
  venueEventId: string;
  confirmedAt: Date | string | null;
  twoWeekEmailSentAt: Date | string | null;
  oneWeekEmailSentAt: Date | string | null;
  threeDayCallCompletedAt: Date | string | null;
  floorStaffCallCompletedAt: Date | string | null;
  floorStaffCallAttempts: number;
}): EventReadiness {
  const steps: ReadinessStep[] = [
    { key: "confirmed", label: STEP_LABELS.confirmed, done: row.confirmedAt != null },
    {
      key: "two_week_email",
      label: STEP_LABELS.two_week_email,
      done: row.twoWeekEmailSentAt != null,
    },
    {
      key: "one_week_email",
      label: STEP_LABELS.one_week_email,
      done: row.oneWeekEmailSentAt != null,
    },
    {
      key: "three_day_call",
      label: STEP_LABELS.three_day_call,
      done: row.threeDayCallCompletedAt != null,
    },
    {
      key: "floor_staff_briefed",
      label: STEP_LABELS.floor_staff_briefed,
      done: row.floorStaffCallCompletedAt != null,
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const totalCount = steps.length;
  const briefed = row.floorStaffCallCompletedAt != null;
  const attempts = row.floorStaffCallAttempts ?? 0;

  let status: ReadinessStatus;
  if (doneCount === totalCount) status = "ready";
  else if (!briefed && attempts >= FLOOR_STAFF_ESCALATION_ATTEMPTS) status = "at_risk";
  else if (doneCount === 0) status = "not_started";
  else status = "on_track";

  return {
    venueEventId: row.venueEventId,
    status,
    statusLabel: STATUS_LABELS[status],
    steps,
    doneCount,
    totalCount,
    floorStaffCallAttempts: attempts,
  };
}

/** Read the venue_event row and compute its readiness DTO. Null when missing. */
export async function computeEventReadiness(venueEventId: string): Promise<EventReadiness | null> {
  const [row] = await db
    .select({
      venueEventId: venueEvents.id,
      confirmedAt: venueEvents.confirmedAt,
      twoWeekEmailSentAt: venueEvents.twoWeekEmailSentAt,
      oneWeekEmailSentAt: venueEvents.oneWeekEmailSentAt,
      threeDayCallCompletedAt: venueEvents.threeDayCallCompletedAt,
      floorStaffCallCompletedAt: venueEvents.floorStaffCallCompletedAt,
      floorStaffCallAttempts: venueEvents.floorStaffCallAttempts,
    })
    .from(venueEvents)
    .where(eq(venueEvents.id, venueEventId))
    .limit(1);
  if (!row) return null;
  return readinessFromRow(row);
}
