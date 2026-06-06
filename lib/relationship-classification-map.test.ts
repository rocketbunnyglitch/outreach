import {
  RELATIONSHIP_AUTO_ACT_CONFIDENCE,
  RELATIONSHIP_BAD_AUTO_CLEAR_DAYS,
  relationshipActionForClassification,
} from "@/lib/relationship-classification-map";
import { describe, expect, it } from "vitest";

describe("relationshipActionForClassification", () => {
  it("unsubscribe @0.95 -> set_bad with +365 day auto-clear", () => {
    const r = relationshipActionForClassification("unsubscribe", 0.95);
    expect(r.action).toBe("set_bad");
    expect(r.autoClearDays).toBe(365);
    expect(r.autoClearDays).toBe(RELATIONSHIP_BAD_AUTO_CLEAR_DAYS);
  });

  it("unsubscribe @0.8 -> none (below the 0.9 auto-act floor)", () => {
    const r = relationshipActionForClassification("unsubscribe", 0.8);
    expect(r.action).toBe("none");
    expect(r.autoClearDays).toBeUndefined();
  });

  it("interested @0.95 -> ensure_neutral", () => {
    const r = relationshipActionForClassification("interested", 0.95);
    expect(r.action).toBe("ensure_neutral");
  });

  it("warm @0.95 -> ensure_neutral", () => {
    const r = relationshipActionForClassification("warm", 0.95);
    expect(r.action).toBe("ensure_neutral");
  });

  it("confirmed @0.95 -> ensure_neutral (NEVER good)", () => {
    const r = relationshipActionForClassification("confirmed", 0.95);
    expect(r.action).toBe("ensure_neutral");
    // No action path ever yields a 'good'-setting result.
    expect(r.action).not.toBe("set_bad");
  });

  it("decline @0.95 -> none (cadence-level, not relationship bad)", () => {
    const r = relationshipActionForClassification("decline", 0.95);
    expect(r.action).toBe("none");
  });

  it("cancelled_by_them @0.95 -> none (never auto-punished)", () => {
    const r = relationshipActionForClassification("cancelled_by_them", 0.95);
    expect(r.action).toBe("none");
  });

  it("stalled_warm @0.95 -> none (cadence-level stop only)", () => {
    const r = relationshipActionForClassification("stalled_warm", 0.95);
    expect(r.action).toBe("none");
  });

  it("question @0.95 -> none (operator handles)", () => {
    const r = relationshipActionForClassification("question", 0.95);
    expect(r.action).toBe("none");
  });

  it("positive labels below the floor never auto-act", () => {
    for (const label of ["interested", "warm", "confirmed"]) {
      expect(relationshipActionForClassification(label, 0.89).action).toBe("none");
    }
  });

  it("exactly at the floor (0.9) auto-acts", () => {
    expect(
      relationshipActionForClassification("unsubscribe", RELATIONSHIP_AUTO_ACT_CONFIDENCE).action,
    ).toBe("set_bad");
    expect(
      relationshipActionForClassification("interested", RELATIONSHIP_AUTO_ACT_CONFIDENCE).action,
    ).toBe("ensure_neutral");
  });

  it("unknown / unexpected labels -> none", () => {
    expect(relationshipActionForClassification("callback_requested", 0.99).action).toBe("none");
    expect(relationshipActionForClassification("auto_reply", 0.99).action).toBe("none");
    expect(relationshipActionForClassification("spam", 0.99).action).toBe("none");
    expect(relationshipActionForClassification("totally_made_up", 0.99).action).toBe("none");
  });
});
