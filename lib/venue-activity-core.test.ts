import {
  type VenueActivityEntry,
  filterActivity,
  presentTypes,
  sortActivityDesc,
} from "@/lib/venue-activity-core";
import { describe, expect, it } from "vitest";

function entry(over: Partial<VenueActivityEntry> & { id: string }): VenueActivityEntry {
  return {
    type: "note",
    at: "2026-06-01T00:00:00Z",
    atLabel: "Jun 1",
    title: "x",
    ...over,
  };
}

describe("sortActivityDesc", () => {
  it("orders newest first", () => {
    const out = sortActivityDesc([
      entry({ id: "a", at: "2026-01-01T00:00:00Z" }),
      entry({ id: "b", at: "2026-03-01T00:00:00Z" }),
      entry({ id: "c", at: "2026-02-01T00:00:00Z" }),
    ]);
    expect(out.map((e) => e.id)).toEqual(["b", "c", "a"]);
  });

  it("is stable for equal timestamps", () => {
    const out = sortActivityDesc([
      entry({ id: "a", at: "2026-01-01T00:00:00Z" }),
      entry({ id: "b", at: "2026-01-01T00:00:00Z" }),
    ]);
    expect(out.map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("filterActivity", () => {
  const data = [
    entry({ id: "email1", type: "email" }),
    entry({ id: "call1", type: "call", campaignId: "c1" }),
    entry({ id: "slot1", type: "slot", campaignId: "c1" }),
    entry({ id: "cancel1", type: "cancellation", campaignId: "c2" }),
  ];

  it("returns everything with no filter", () => {
    expect(filterActivity(data)).toHaveLength(4);
  });

  it("filters by type", () => {
    const out = filterActivity(data, { types: ["email", "call"] });
    expect(out.map((e) => e.id).sort()).toEqual(["call1", "email1"]);
  });

  it("filters to a single campaign and drops campaign-less entries", () => {
    const out = filterActivity(data, { campaignId: "c1" });
    expect(out.map((e) => e.id).sort()).toEqual(["call1", "slot1"]);
    // The email (no campaign context) and the c2 cancellation are excluded.
    expect(out.some((e) => e.id === "email1")).toBe(false);
  });

  it("combines type + campaign filters", () => {
    const out = filterActivity(data, { types: ["slot"], campaignId: "c1" });
    expect(out.map((e) => e.id)).toEqual(["slot1"]);
  });
});

describe("presentTypes", () => {
  it("returns distinct types in canonical order", () => {
    const out = presentTypes([
      entry({ id: "1", type: "cancellation" }),
      entry({ id: "2", type: "email" }),
      entry({ id: "3", type: "email" }),
      entry({ id: "4", type: "slot" }),
    ]);
    // canonical order is email < slot < cancellation per ACTIVITY_TYPE_LABEL
    expect(out).toEqual(["email", "slot", "cancellation"]);
  });
});
