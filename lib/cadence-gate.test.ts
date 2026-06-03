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

  it("hard-blocks a non-admin at the floor", () => {
    const d = decideCadenceGate({ floor: blockedFloor, isAdmin: false, overrideReason: "please" });
    expect(d.blocked).toBe(true);
    expect(d.overrideApplied).toBe(false);
    expect(d.errorMessage).toContain("Ask an admin");
  });

  it("admin override with a reason goes through and logs the reason", () => {
    const d = decideCadenceGate({
      floor: blockedFloor,
      isAdmin: true,
      overrideReason: "  venue asked us to follow up  ",
    });
    expect(d.blocked).toBe(false);
    expect(d.overrideApplied).toBe(true);
    expect(d.overrideReasonToLog).toBe("venue asked us to follow up");
  });

  it("admin without a reason is still blocked (told how to override)", () => {
    const d = decideCadenceGate({ floor: blockedFloor, isAdmin: true, overrideReason: "" });
    expect(d.blocked).toBe(true);
    expect(d.overrideApplied).toBe(false);
    expect(d.errorMessage).toContain("override reason");
  });
});
