/**
 * Pure decision helper for the send-pipeline cadence gate (Phase 1.9).
 *
 * Given a floor-check result (from checkCadenceFloors), whether the sender is
 * an admin, and any override reason they supplied, decide whether the send is
 * blocked, allowed, or pushed through as an admin override. No DB / server-only,
 * so it is unit-testable; lib/compose-send-impl.ts calls it.
 *
 * [ReferenceDoc Section 6] floors block operator-initiated outbound to silent
 * venues; admins can override with a reason, non-admins are hard-blocked.
 */

export interface CadenceGateFloor {
  allowed: boolean;
  reason?: string;
  earliestAllowedAt?: Date;
  totalTouchCount: number;
  hardCapReached: boolean;
}

export interface CadenceGateInput {
  floor: CadenceGateFloor;
  isAdmin: boolean;
  /** Reason the admin typed to override; null/empty = no override requested. */
  overrideReason: string | null;
}

export interface CadenceGateDecision {
  /** True => return a block error to the UI; do NOT send. */
  blocked: boolean;
  /** True => an admin pushed through; log overrideReasonToLog on the send. */
  overrideApplied: boolean;
  errorMessage?: string;
  overrideReasonToLog?: string;
}

export function decideCadenceGate(input: CadenceGateInput): CadenceGateDecision {
  // Within the floors -> nothing to do.
  if (input.floor.allowed) return { blocked: false, overrideApplied: false };

  const reason = input.floor.reason ?? "This venue is at its cadence floor.";
  const trimmed = (input.overrideReason ?? "").trim();

  // Admin with a reason pushes the send through (logged).
  if (input.isAdmin && trimmed.length > 0) {
    return { blocked: false, overrideApplied: true, overrideReasonToLog: trimmed };
  }

  // Otherwise hard-block. Admins get told how to override.
  const suffix = input.isAdmin
    ? " Provide an override reason to send anyway."
    : " Ask an admin to override if this send is necessary.";
  return { blocked: true, overrideApplied: false, errorMessage: reason + suffix };
}
