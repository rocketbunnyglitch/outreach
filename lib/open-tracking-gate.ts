/**
 * Open-tracking hard-gate (warm-only). The SINGLE source of truth for whether
 * an outbound email may carry an open-tracking pixel.
 *
 * Policy (mirrors the send-safety boundary in lib/send-mode-gate.ts):
 *   - Open tracking is permitted ONLY on WARM threads -- the venue has already
 *     replied at least once (thread direction is 'inbound' or 'mixed').
 *   - It is NEVER permitted on COLD / no-reply sends ('outbound' or null).
 *     Open-pixels are a spam-filter fingerprint that wreck cold inbox
 *     placement (CLAUDE.md 8.8 / DECISIONS #011). On an engaged thread the
 *     deliverability risk is low.
 *   - Only venue recipients are tracked; host/internal/system operational mail
 *     is never tracked.
 *
 * Pure + dependency-free (no db, no "server-only") so it is unit-tested
 * directly and can be the single gate every other layer calls. Opens are a
 * SOFT signal -- this gate decides visibility only and must NEVER be used to
 * drive cadence, relationship flags, or sends.
 */

export interface OpenTrackingGateInput {
  /** email_threads.direction -- 'inbound' | 'outbound' | 'mixed' | null. */
  threadDirection: string | null | undefined;
  /** Send recipient type; only 'venue' (or unset) is eligible. */
  recipientType?: string | null;
}

/**
 * True ONLY when the thread is warm (the venue has replied) and the recipient
 * is a venue. Cold / outbound-only / unknown threads -> false, always.
 */
export function shouldTrackOpens(input: OpenTrackingGateInput): boolean {
  // Operational (host/internal/system) mail is never tracked.
  if (input.recipientType && input.recipientType !== "venue") return false;
  // Warm-only: the thread must already carry inbound (a reply from the venue).
  return input.threadDirection === "mixed" || input.threadDirection === "inbound";
}
