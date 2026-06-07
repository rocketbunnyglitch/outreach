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
  /** True => someone pushed through; log overrideReasonToLog on the send. */
  overrideApplied: boolean;
  /** True => a non-admin pushed the override through (extra-flagged in logs). */
  overrideByNonAdmin: boolean;
  errorMessage?: string;
  overrideReasonToLog?: string;
}

export function decideCadenceGate(input: CadenceGateInput): CadenceGateDecision {
  // Within the floors -> nothing to do.
  if (input.floor.allowed) {
    return { blocked: false, overrideApplied: false, overrideByNonAdmin: false };
  }

  const reason = input.floor.reason ?? "This venue is at its cadence floor.";
  const trimmed = (input.overrideReason ?? "").trim();

  // Policy (operator decision): the cadence "wait rule" is a good default but
  // ANYONE may override it with a reason -- the override is always flagged
  // (the reason is persisted on the send event). Non-admin overrides are
  // marked distinctly so they stand out in the audit trail.
  if (trimmed.length > 0) {
    const byNonAdmin = !input.isAdmin;
    const reasonToLog = byNonAdmin ? `[non-admin override] ${trimmed}` : trimmed;
    return {
      blocked: false,
      overrideApplied: true,
      overrideByNonAdmin: byNonAdmin,
      overrideReasonToLog: reasonToLog,
    };
  }

  // No reason supplied -> hard-block. Tell them a reason unlocks it (and that
  // overrides are recorded).
  return {
    blocked: true,
    overrideApplied: false,
    overrideByNonAdmin: false,
    errorMessage: `${reason} Provide an override reason to send anyway -- overrides are logged.`,
  };
}
