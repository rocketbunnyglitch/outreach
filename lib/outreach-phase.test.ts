import { PHASE_LABELS, phaseCapability, phaseGateMessage } from "@/lib/outreach-phase";
import { describe, expect, it } from "vitest";

// Pure phase-model helpers from lib/outreach-phase.ts (no DB / network /
// server-only). These lock in the "higher phase includes lower phase
// capabilities" contract the operator UI relies on for enabling buttons,
// and the gate-tooltip copy.

describe("phaseCapability", () => {
  it("canManualSend is enabled at every phase (1+)", () => {
    expect(phaseCapability.canManualSend(1)).toBe(true);
    expect(phaseCapability.canManualSend(4)).toBe(true);
  });

  it("canBulkQueue requires phase 2+", () => {
    expect(phaseCapability.canBulkQueue(1)).toBe(false);
    expect(phaseCapability.canBulkQueue(2)).toBe(true);
    expect(phaseCapability.canBulkQueue(3)).toBe(true);
  });

  it("canAutoFollowUp requires phase 3+", () => {
    expect(phaseCapability.canAutoFollowUp(2)).toBe(false);
    expect(phaseCapability.canAutoFollowUp(3)).toBe(true);
  });

  it("canAutoTransactional requires phase 4 only", () => {
    expect(phaseCapability.canAutoTransactional(3)).toBe(false);
    expect(phaseCapability.canAutoTransactional(4)).toBe(true);
  });

  it("capabilities are monotonic: a higher phase never loses a lower phase capability", () => {
    const phases = [1, 2, 3, 4] as const;
    for (const cap of Object.values(phaseCapability)) {
      let seenTrue = false;
      for (const p of phases) {
        const allowed = cap(p);
        if (allowed) seenTrue = true;
        // Once a capability turns on at some phase it must stay on for all higher phases.
        if (seenTrue) expect(cap(p)).toBe(true);
      }
    }
  });
});

describe("phaseGateMessage", () => {
  it("returns an empty string when the current phase already meets the requirement", () => {
    expect(phaseGateMessage(2, 2)).toBe("");
    expect(phaseGateMessage(1, 4)).toBe("");
  });

  it("names both the required and current phase labels when gated", () => {
    const msg = phaseGateMessage(3, 1);
    expect(msg).toContain(`Phase 3 (${PHASE_LABELS[3]})`);
    expect(msg).toContain(`Phase 1 (${PHASE_LABELS[1]})`);
  });
});
