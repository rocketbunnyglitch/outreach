/**
 * Outreach phase model.
 *
 * Per-brand 1-4 lifecycle. The number is meaningful: higher phases
 * include the capabilities of all lower phases. Operator-facing UI
 * checks these capabilities directly via the helpers below — never
 * compares phase numbers inline, because the meaning of a phase number
 * may evolve.
 *
 *   Phase 1 — Draft-assist
 *     - Engine renders templates with merge fields
 *     - Staff reviews + clicks Send manually
 *     - Each click is an individual gate-checked send
 *
 *   Phase 2 — Controlled send
 *     - Phase 1 +
 *     - Staff selects N venues, clicks "Queue all"
 *     - Engine spaces sends across the day (respects throttle + jitter)
 *
 *   Phase 3 — Auto follow-ups
 *     - Phases 1-2 +
 *     - Cold first-touch still manual/controlled
 *     - Follow-up emails (step 2+) fire automatically per cadence
 *     - Stop conditions: reply, bounce, decline, unsubscribe
 *
 *   Phase 4 — Transactional auto
 *     - Phases 1-3 +
 *     - Confirmation cascade sends real emails (poster delivery,
 *       2-week confirm, 1-week confirm, floor-staff brief)
 *     - These bypass cold-send throttling (sendKind: "transactional")
 */

export type OutreachPhase = 1 | 2 | 3 | 4;

export const PHASE_LABELS: Record<OutreachPhase, string> = {
  1: "Draft-assist",
  2: "Controlled send",
  3: "Auto follow-ups",
  4: "Transactional auto",
};

export const PHASE_DESCRIPTIONS: Record<OutreachPhase, string> = {
  1: "Engine renders templates. Staff reviews + sends each email manually. Safe starting point — no automated outbound.",
  2: "Staff picks 20-40 venues. Engine spaces sends across the day with throttle + jitter. Still no auto-replies.",
  3: "Cold sends stay manual. Engine auto-sends follow-ups per cadence and stops on reply / bounce / decline / unsubscribe.",
  4: "Confirmation cascade sends real emails to confirmed venues (poster delivery, 2-week/1-week reminders, floor brief). Cold sends still gated on lower phases.",
};

/**
 * Capability accessors. Use these instead of raw phase numbers so the
 * mapping can evolve without touching every call site.
 */
export const phaseCapability = {
  /** Phase 1+ — operator can use the send composer to send one at a time. */
  canManualSend: (phase: OutreachPhase): boolean => phase >= 1,

  /** Phase 2+ — operator can queue N venues at once with engine-spaced sends. */
  canBulkQueue: (phase: OutreachPhase): boolean => phase >= 2,

  /** Phase 3+ — follow-up emails fire automatically (cold first-touch still manual). */
  canAutoFollowUp: (phase: OutreachPhase): boolean => phase >= 3,

  /**
   * Phase 4+ — confirmation cascade sends real emails instead of just
   * creating tasks. Bypasses cold throttling (transactional sends).
   */
  canAutoTransactional: (phase: OutreachPhase): boolean => phase >= 4,
};

/**
 * UI guard helper — converts a denied capability into a human-readable
 * tooltip for disabled buttons.
 */
export function phaseGateMessage(required: OutreachPhase, current: OutreachPhase): string {
  if (current >= required) return "";
  return `Requires Phase ${required} (${PHASE_LABELS[required]}). This brand is at Phase ${current} (${PHASE_LABELS[current]}). Raise the phase in Brands → Edit when the inbox has proven deliverability.`;
}
