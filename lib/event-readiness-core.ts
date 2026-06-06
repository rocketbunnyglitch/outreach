/**
 * Event-day readiness -- PURE core (no db, no "server-only"), so it is
 * unit-tested directly and importable from client components.
 * lib/event-readiness.ts wraps this with the DB read.
 *
 * Rolls the per-venue_event prep checkpoints into a single readiness DTO:
 *   - confirmed_at                  -> "Confirmed"
 *   - two_week_email_sent_at        -> "2-week email"
 *   - one_week_email_sent_at        -> "1-week email"
 *   - three_day_call_completed_at   -> "3-day call"
 *   - floor_staff_call_completed_at -> "Floor staff briefed"
 *
 * V2 readiness BLOCKER (P1-2): a confirmed event inside the 0-4 day window
 * whose floor-staff briefing call is NOT done is flagged `blocker` -- it is
 * blocking event-day readiness and should surface as such on the readiness
 * surface + escalate. floor_staff_call_attempts drives the 3+-attempt
 * "Needs attention" escalation severity.
 */

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

/** Overall label: ready (all done), on_track (some pending), at_risk
 *  (briefing not done + blocker/3+ attempts), not_started (nothing done). */
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
  /** True when this confirmed event is inside the 0-4 day window with the
   *  floor-staff briefing still not done -- a hard event-day-readiness
   *  blocker (P1-2). null daysToEvent (caller didn't supply it) => false. */
  blocker: boolean;
  blockerReason: string | null;
  /** Days until the event, echoed for the UI (null when unknown). */
  daysToEvent: number | null;
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

/** The danger window (days before event) within which an un-briefed
 *  confirmed event is a readiness blocker. */
export const READINESS_BLOCKER_WINDOW_DAYS = 4;

export interface ReadinessRow {
  venueEventId: string;
  confirmedAt: Date | string | null;
  twoWeekEmailSentAt: Date | string | null;
  oneWeekEmailSentAt: Date | string | null;
  threeDayCallCompletedAt: Date | string | null;
  floorStaffCallCompletedAt: Date | string | null;
  floorStaffCallAttempts: number;
  /** Days until the event (negative = past). Omit/null when unknown -- the
   *  blocker is then never raised (we only block on a known near-term date). */
  daysToEvent?: number | null;
}

/**
 * Compute the readiness DTO from a row already in hand (no DB read).
 */
export function readinessFromRow(row: ReadinessRow): EventReadiness {
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
  const confirmed = row.confirmedAt != null;
  const briefed = row.floorStaffCallCompletedAt != null;
  const attempts = row.floorStaffCallAttempts ?? 0;
  const daysToEvent = row.daysToEvent ?? null;

  // V2 readiness blocker: confirmed, not briefed, inside the danger window.
  const inWindow =
    daysToEvent != null && daysToEvent >= 0 && daysToEvent <= READINESS_BLOCKER_WINDOW_DAYS;
  const blocker = confirmed && !briefed && inWindow;
  let blockerReason: string | null = null;
  if (blocker) {
    const dayLabel = daysToEvent === 0 ? "today" : `${daysToEvent}d out`;
    blockerReason =
      attempts >= FLOOR_STAFF_ESCALATION_ATTEMPTS
        ? `Floor-staff briefing not confirmed after ${attempts} attempts -- event ${dayLabel}.`
        : `Floor-staff briefing call still pending -- event ${dayLabel}.`;
  }

  let status: ReadinessStatus;
  if (doneCount === totalCount) status = "ready";
  else if (!briefed && (blocker || attempts >= FLOOR_STAFF_ESCALATION_ATTEMPTS)) status = "at_risk";
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
    blocker,
    blockerReason,
    daysToEvent,
  };
}
