import type { TriggerContext } from "@/db/schema/templates";
import { type ScorableTemplate, pickBest } from "@/lib/template-picker-score";
import { describe, expect, it } from "vitest";

// Fixtures mirror the seeded trigger_contexts (Phase 1.2). The DB-backed
// pickTemplate is covered by an integration check; this exercises the pure
// scorer against the six spec scenarios.
const t = (templateCode: string, triggerContext: TriggerContext): ScorableTemplate => ({
  templateCode,
  name: templateCode,
  triggerContext,
  autoPickPriority: 100,
});

const FIXTURES: ScorableTemplate[] = [
  t("T1", { channel: "cold", stage: "first_touch", event_type: "night", ask_size: "big_open" }),
  t("T2", { channel: "cold", stage: "first_touch", event_type: "day_party" }),
  t("T3", { channel: "warm", stage: "first_touch", prior_relationship: true }),
  t("T4", { stage: "detail", event_type: "night", crawls: "multiple" }),
  t("T5", { stage: "detail", event_type: "night", crawls: "single" }),
  t("T6", { stage: "detail", event_type: "day_party" }),
  t("T7A", { stage: "insert_block", priority: [1, 2, 3] }),
  t("T8", { channel: "cold", stage: "first_touch", ask_size: "small_specific" }),
  t("T9-far", { channel: "post_confirm", stage: "confirmation", min_days_to_event: 21 }),
  t("T9-near", { channel: "post_confirm", stage: "confirmation", max_days_to_event: 21 }),
  t("T10", { channel: "lifecycle", stage: "graphic" }),
  t("T13", {
    channel: "lifecycle",
    stage: "pre_event",
    min_days_to_event: 7,
    max_days_to_event: 14,
  }),
  t("T14", {
    channel: "lifecycle",
    stage: "day_before",
    min_days_to_event: 1,
    max_days_to_event: 7,
  }),
  t("T17", { channel: "post_event" }),
];

const CID = "11111111-1111-4111-8111-111111111111";

describe("pickBest", () => {
  it("cold open for Toronto (Prio 1, 3 crawls, night) picks T1", () => {
    const pick = pickBest(FIXTURES, {
      campaignId: CID,
      cityPriority: 1,
      crawlCount: 3,
      eventType: "night",
      askSize: "big_open",
      isWarmRelationship: false,
    });
    expect(pick?.template.templateCode).toBe("T1");
  });

  it("cold open for a daytime party picks T2", () => {
    const pick = pickBest(FIXTURES, {
      campaignId: CID,
      eventType: "day_party",
      askSize: "big_open",
      isWarmRelationship: false,
    });
    expect(pick?.template.templateCode).toBe("T2");
  });

  it("slot detail for a single-crawl city picks T5", () => {
    const pick = pickBest(FIXTURES, {
      campaignId: CID,
      crawlCount: 1,
      eventType: "night",
    });
    expect(pick?.template.templateCode).toBe("T5");
  });

  it("confirmation 4 weeks out picks T9-far", () => {
    const pick = pickBest(FIXTURES, {
      campaignId: CID,
      lifecycleStep: "confirmation",
      daysToEvent: 28,
    });
    expect(pick?.template.templateCode).toBe("T9-far");
  });

  it("confirmation 1 week out picks T9-near", () => {
    const pick = pickBest(FIXTURES, {
      campaignId: CID,
      lifecycleStep: "confirmation",
      daysToEvent: 7,
    });
    expect(pick?.template.templateCode).toBe("T9-near");
  });

  it("post-event picks T17", () => {
    const pick = pickBest(FIXTURES, { campaignId: CID, lifecycleStep: "post_event" });
    expect(pick?.template.templateCode).toBe("T17");
  });

  it("returns a reason and alternatives for a valid context", () => {
    const pick = pickBest(FIXTURES, {
      campaignId: CID,
      cityPriority: 1,
      crawlCount: 3,
      eventType: "night",
      askSize: "big_open",
    });
    expect(pick?.reason).toContain("T1");
    expect(Array.isArray(pick?.alternatives)).toBe(true);
  });

  it("returns null when nothing matches", () => {
    expect(pickBest([], { campaignId: CID, lifecycleStep: "post_event" })).toBeNull();
    // insert-block-only set: never pickable
    expect(
      pickBest([t("T7A", { stage: "insert_block", priority: [1] })], {
        campaignId: CID,
        cityPriority: 1,
      }),
    ).toBeNull();
  });
});
