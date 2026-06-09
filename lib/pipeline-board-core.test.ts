import { type LaneKey, groupByLane, venueEventToLane } from "@/lib/pipeline-board-core";
import { describe, expect, it } from "vitest";

describe("venueEventToLane", () => {
  it("maps the simple pipeline statuses", () => {
    const base = { daysToEvent: 30, readinessReady: false };
    expect(venueEventToLane({ ...base, status: "lead" })).toBe("lead");
    expect(venueEventToLane({ ...base, status: "contacted" })).toBe("contacted");
    expect(venueEventToLane({ ...base, status: "interested" })).toBe("warm");
    expect(venueEventToLane({ ...base, status: "negotiating" })).toBe("negotiating");
  });

  it("treats declined + cancelled as cancelled", () => {
    expect(venueEventToLane({ status: "declined", daysToEvent: 5, readinessReady: false })).toBe(
      "cancelled",
    );
    expect(venueEventToLane({ status: "cancelled", daysToEvent: 5, readinessReady: false })).toBe(
      "cancelled",
    );
  });

  it("splits confirmed into confirmed / ready / completed", () => {
    // upcoming, not ready -> confirmed
    expect(venueEventToLane({ status: "confirmed", daysToEvent: 10, readinessReady: false })).toBe(
      "confirmed",
    );
    // upcoming, ready -> ready
    expect(venueEventToLane({ status: "confirmed", daysToEvent: 3, readinessReady: true })).toBe(
      "ready",
    );
    // past -> completed (regardless of readiness)
    expect(venueEventToLane({ status: "confirmed", daysToEvent: -2, readinessReady: false })).toBe(
      "completed",
    );
    // contract_signed + scheduled follow the same rules
    expect(
      venueEventToLane({ status: "contract_signed", daysToEvent: 10, readinessReady: true }),
    ).toBe("ready");
    expect(venueEventToLane({ status: "scheduled", daysToEvent: -1, readinessReady: true })).toBe(
      "completed",
    );
  });

  it("falls back to lead for unknown statuses", () => {
    expect(venueEventToLane({ status: "weird", daysToEvent: null, readinessReady: false })).toBe(
      "lead",
    );
  });
});

describe("groupByLane", () => {
  it("returns every lane in canonical order, including empty ones", () => {
    const out = groupByLane<{ id: string; lane: LaneKey }>([
      { id: "a", lane: "confirmed" },
      { id: "b", lane: "lead" },
    ]);
    expect(out.map((l) => l.key)).toEqual([
      "lead",
      "contacted",
      "warm",
      "negotiating",
      "confirmed",
      "ready",
      "completed",
      "cancelled",
    ]);
    expect(out.find((l) => l.key === "lead")?.items.map((i) => i.id)).toEqual(["b"]);
    expect(out.find((l) => l.key === "confirmed")?.items.map((i) => i.id)).toEqual(["a"]);
    expect(out.find((l) => l.key === "warm")?.items).toEqual([]);
  });

  it("preserves input order within a lane", () => {
    const out = groupByLane<{ id: string; lane: LaneKey }>([
      { id: "1", lane: "warm" },
      { id: "2", lane: "warm" },
      { id: "3", lane: "warm" },
    ]);
    expect(out.find((l) => l.key === "warm")?.items.map((i) => i.id)).toEqual(["1", "2", "3"]);
  });
});
