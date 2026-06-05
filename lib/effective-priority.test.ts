import { computeEffectivePriority } from "@/lib/effective-priority";
import { describe, expect, it } from "vitest";

describe("computeEffectivePriority", () => {
  it("outside the 21-day window, effective == static (pivot inactive)", () => {
    const r = computeEffectivePriority({ staticPriority: 1, ticketsSold: 0, daysToEvent: 30 });
    expect(r.effective).toBe(1);
    expect(r.pivotActive).toBe(false);
  });

  // Reference-doc 1.6 LOCKED example: Toronto Prio 1, 0 sold, 14 days -> eff 3.
  it("zero sales at day -14 drags down 2 tiers", () => {
    const r = computeEffectivePriority({ staticPriority: 1, ticketsSold: 0, daysToEvent: 14 });
    expect(r.effective).toBe(3);
    expect(r.pivotActive).toBe(true);
  });

  // Reference-doc 1.6 LOCKED example: Detroit Prio 4, 35 sold, 14 days -> eff 2.
  it("35 sales at day -14 boosts up 2 tiers", () => {
    const r = computeEffectivePriority({ staticPriority: 4, ticketsSold: 35, daysToEvent: 14 });
    expect(r.effective).toBe(2);
    expect(r.pivotActive).toBe(true);
  });

  it("100 sales at day -7 boosts up 2 tiers", () => {
    const r = computeEffectivePriority({ staticPriority: 6, ticketsSold: 100, daysToEvent: 7 });
    expect(r.effective).toBe(4);
    expect(r.pivotActive).toBe(true);
  });

  it("21-30 sales is a single-tier boost", () => {
    const r = computeEffectivePriority({ staticPriority: 5, ticketsSold: 25, daysToEvent: 10 });
    expect(r.effective).toBe(4);
  });

  it("zero sales at 15-21 days is a single-tier drag", () => {
    const r = computeEffectivePriority({ staticPriority: 5, ticketsSold: 0, daysToEvent: 18 });
    expect(r.effective).toBe(6);
  });

  it("clamps a boost at the top of the range (priority 1 stays 1)", () => {
    const r = computeEffectivePriority({ staticPriority: 1, ticketsSold: 100, daysToEvent: 14 });
    expect(r.effective).toBe(1);
    // The boost fired even though clamping absorbed it.
    expect(r.pivotActive).toBe(true);
  });

  it("clamps a drag at the bottom of the range (priority 10 stays 10)", () => {
    const r = computeEffectivePriority({ staticPriority: 10, ticketsSold: 0, daysToEvent: 5 });
    expect(r.effective).toBe(10);
  });

  it("modest sales (1-20) inside the window do not change the tier", () => {
    const r = computeEffectivePriority({ staticPriority: 5, ticketsSold: 12, daysToEvent: 10 });
    expect(r.effective).toBe(5);
    expect(r.pivotActive).toBe(false);
  });
});
