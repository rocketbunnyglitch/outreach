import { readinessFromRow } from "@/lib/event-readiness-core";
import { describe, expect, it } from "vitest";

const D = new Date("2026-10-01T00:00:00Z");

function row(over: Partial<Parameters<typeof readinessFromRow>[0]> = {}) {
  return {
    venueEventId: "ve1",
    confirmedAt: D,
    twoWeekEmailSentAt: null,
    oneWeekEmailSentAt: null,
    threeDayCallCompletedAt: null,
    floorStaffCallCompletedAt: null,
    floorStaffCallAttempts: 0,
    daysToEvent: null,
    ...over,
  };
}

describe("readinessFromRow -- steps + status", () => {
  it("all five steps done -> ready", () => {
    const r = readinessFromRow(
      row({
        twoWeekEmailSentAt: D,
        oneWeekEmailSentAt: D,
        threeDayCallCompletedAt: D,
        floorStaffCallCompletedAt: D,
      }),
    );
    expect(r.status).toBe("ready");
    expect(r.doneCount).toBe(5);
    expect(r.blocker).toBe(false);
  });

  it("nothing done -> not_started", () => {
    const r = readinessFromRow(row({ confirmedAt: null }));
    expect(r.status).toBe("not_started");
    expect(r.doneCount).toBe(0);
  });

  it("some done, no blocker -> on_track", () => {
    const r = readinessFromRow(row({ twoWeekEmailSentAt: D, daysToEvent: 20 }));
    expect(r.status).toBe("on_track");
  });
});

describe("readinessFromRow -- V2 blocker [P1-2]", () => {
  it("confirmed, not briefed, 2 days out -> blocker + at_risk", () => {
    const r = readinessFromRow(row({ daysToEvent: 2 }));
    expect(r.blocker).toBe(true);
    expect(r.status).toBe("at_risk");
    expect(r.blockerReason).toContain("2d out");
  });

  it("confirmed, not briefed, 0 days out (today) -> blocker, reason says today", () => {
    const r = readinessFromRow(row({ daysToEvent: 0 }));
    expect(r.blocker).toBe(true);
    expect(r.blockerReason).toContain("today");
  });

  it("briefed -> never a blocker even inside the window", () => {
    const r = readinessFromRow(row({ floorStaffCallCompletedAt: D, daysToEvent: 1 }));
    expect(r.blocker).toBe(false);
  });

  it("outside the 4-day window -> no blocker", () => {
    const r = readinessFromRow(row({ daysToEvent: 5 }));
    expect(r.blocker).toBe(false);
  });

  it("unknown daysToEvent (null) -> no blocker (only block on a known near date)", () => {
    const r = readinessFromRow(row({ daysToEvent: null, floorStaffCallAttempts: 5 }));
    expect(r.blocker).toBe(false);
  });

  it("3+ attempts inside window -> blocker reason mentions attempts", () => {
    const r = readinessFromRow(row({ daysToEvent: 3, floorStaffCallAttempts: 4 }));
    expect(r.blocker).toBe(true);
    expect(r.blockerReason).toContain("4 attempts");
    expect(r.status).toBe("at_risk");
  });

  it("3+ attempts with unknown date -> at_risk (escalation) but not a hard blocker", () => {
    const r = readinessFromRow(row({ daysToEvent: null, floorStaffCallAttempts: 3 }));
    expect(r.status).toBe("at_risk");
    expect(r.blocker).toBe(false);
  });
});
