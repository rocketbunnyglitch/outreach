import { type CadenceGateFloor, decideCadenceGate } from "@/lib/cadence-gate";
import { describe, expect, it } from "vitest";

const blockedFloor: CadenceGateFloor = {
  allowed: false,
  reason: "Hard cap of 6 touches reached for this venue this campaign.",
  totalTouchCount: 6,
  hardCapReached: true,
};
const okFloor: CadenceGateFloor = {
  allowed: true,
  totalTouchCount: 1,
  hardCapReached: false,
};

describe("decideCadenceGate [Phase 1.9]", () => {
  it("passes through when the floor allows", () => {
    const d = decideCadenceGate({ floor: okFloor, isAdmin: false, overrideReason: null });
    expect(d.blocked).toBe(false);
    expect(d.overrideApplied).toBe(false);
  });

  it("blocks a non-admin at the floor when they give NO reason", () => {
    const d = decideCadenceGate({ floor: blockedFloor, isAdmin: false, overrideReason: null });
    expect(d.blocked).toBe(true);
    expect(d.overrideApplied).toBe(false);
    expect(d.errorMessage).toContain("override reason");
  });

  it("lets a non-admin override WITH a reason, flagged as non-admin", () => {
    const d = decideCadenceGate({ floor: blockedFloor, isAdmin: false, overrideReason: "please" });
    expect(d.blocked).toBe(false);
    expect(d.overrideApplied).toBe(true);
    expect(d.overrideByNonAdmin).toBe(true);
    expect(d.overrideReasonToLog).toBe("[non-admin override] please");
  });

  it("admin override with a reason goes through and logs the bare reason", () => {
    const d = decideCadenceGate({
      floor: blockedFloor,
      isAdmin: true,
      overrideReason: "  venue asked us to follow up  ",
    });
    expect(d.blocked).toBe(false);
    expect(d.overrideApplied).toBe(true);
    expect(d.overrideByNonAdmin).toBe(false);
    expect(d.overrideReasonToLog).toBe("venue asked us to follow up");
  });

  it("admin without a reason is still blocked (told how to override)", () => {
    const d = decideCadenceGate({ floor: blockedFloor, isAdmin: true, overrideReason: "" });
    expect(d.blocked).toBe(true);
    expect(d.overrideApplied).toBe(false);
    expect(d.errorMessage).toContain("override reason");
  });
});
