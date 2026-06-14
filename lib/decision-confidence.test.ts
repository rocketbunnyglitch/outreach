import { describe, expect, it } from "vitest";
import { confidenceTier, recipientValidityFromZb, scoreDecision } from "./decision-confidence";

describe("scoreDecision", () => {
  it("scores an ideal cold touch high", () => {
    const r = scoreDecision({
      recipientValidity: 1,
      templateConfidence: 1,
      cadenceClarity: 1,
      safetyClear: true,
    });
    expect(r.score).toBe(100);
  });

  it("hard-caps a safety-flagged draft low regardless of other signals", () => {
    const r = scoreDecision({
      recipientValidity: 1,
      templateConfidence: 1,
      cadenceClarity: 1,
      safetyClear: false,
    });
    expect(r.score).toBeLessThanOrEqual(15);
  });

  it("drops with a bad recipient", () => {
    const valid = scoreDecision({
      recipientValidity: 1,
      templateConfidence: 1,
      cadenceClarity: 1,
      safetyClear: true,
    }).score;
    const invalid = scoreDecision({
      recipientValidity: 0,
      templateConfidence: 1,
      cadenceClarity: 1,
      safetyClear: true,
    }).score;
    expect(invalid).toBeLessThan(valid);
  });

  it("factors in low classification confidence on replies", () => {
    const sure = scoreDecision({
      recipientValidity: 1,
      templateConfidence: 1,
      cadenceClarity: 1,
      classificationConfidence: 1,
      safetyClear: true,
    }).score;
    const unsure = scoreDecision({
      recipientValidity: 1,
      templateConfidence: 1,
      cadenceClarity: 1,
      classificationConfidence: 0.2,
      safetyClear: true,
    }).score;
    expect(unsure).toBeLessThan(sure);
  });
});

describe("recipientValidityFromZb", () => {
  it("maps ZB statuses", () => {
    expect(recipientValidityFromZb("valid")).toBe(1);
    expect(recipientValidityFromZb("unknown")).toBe(0.5);
    expect(recipientValidityFromZb("catch-all")).toBe(0.5);
    expect(recipientValidityFromZb(null)).toBe(0.5);
    expect(recipientValidityFromZb("invalid")).toBe(0);
    expect(recipientValidityFromZb("do_not_mail")).toBe(0);
  });
});

describe("confidenceTier", () => {
  it("buckets scores", () => {
    expect(confidenceTier(90)).toBe("high");
    expect(confidenceTier(60)).toBe("medium");
    expect(confidenceTier(30)).toBe("low");
  });
});
