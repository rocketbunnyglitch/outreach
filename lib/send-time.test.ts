import { describe, expect, it } from "vitest";
import {
  type ReplyHistoryPoint,
  bestSendWindow,
  getZonedParts,
  isFavoredDaytimeHour,
  isPeakServiceHour,
  isPeakServiceWindow,
  zonedWallTimeToUtc,
} from "./send-time";

const CHI = "America/Chicago";
const NYC = "America/New_York";
const LA = "America/Los_Angeles";

/** Build an instant from a local wall-clock time in a zone (test helper). */
function at(tz: string, y: number, mo: number, d: number, h: number, mi = 0): Date {
  return zonedWallTimeToUtc(tz, { year: y, month: mo, day: d, hour: h, minute: mi });
}

describe("getZonedParts + zonedWallTimeToUtc round-trip", () => {
  it("round-trips a daytime wall time", () => {
    const inst = at(CHI, 2026, 6, 10, 13, 30);
    const p = getZonedParts(CHI, inst);
    expect(p.year).toBe(2026);
    expect(p.month).toBe(6);
    expect(p.day).toBe(10);
    expect(p.hour).toBe(13);
    expect(p.minute).toBe(30);
  });

  it("computes weekday correctly (2026-06-10 is a Wednesday)", () => {
    const inst = at(CHI, 2026, 6, 10, 12);
    expect(getZonedParts(CHI, inst).weekday).toBe(3); // Wed
  });
});

describe("isPeakServiceHour", () => {
  it("flags Fri 21:00 as peak", () => {
    expect(isPeakServiceHour(5, 21)).toBe(true);
  });
  it("flags Sat 01:00 (spillover of Fri night) as peak", () => {
    expect(isPeakServiceHour(6, 1)).toBe(true);
  });
  it("does NOT flag Wed 21:00 (not a service night)", () => {
    expect(isPeakServiceHour(3, 21)).toBe(false);
  });
  it("does NOT flag Sat 13:00 (weekend daytime is fine)", () => {
    expect(isPeakServiceHour(6, 13)).toBe(false);
  });
});

describe("bestSendWindow heuristic (no history)", () => {
  it("a cold send composed 9pm Friday suggests the next late-morning slot (Sat 11:00)", () => {
    const now = at(CHI, 2026, 6, 12, 21); // 2026-06-12 is a Friday
    const r = bestSendWindow({ cityTimezone: CHI, now });
    expect(r.source).toBe("heuristic");
    expect(r.localHour).toBe(11);
    const p = getZonedParts(CHI, r.sendAt);
    expect(p.weekday).toBe(6); // Saturday
    expect(p.day).toBe(13);
    expect(p.hour).toBe(11);
    expect(r.isPeakNow).toBe(true); // 9pm Friday IS peak service
  });

  it("composed mid-morning on a weekday uses the same day at 11:00", () => {
    const now = at(CHI, 2026, 6, 10, 9); // Wed 09:00
    const r = bestSendWindow({ cityTimezone: CHI, now });
    const p = getZonedParts(CHI, r.sendAt);
    expect(p.day).toBe(10);
    expect(p.hour).toBe(11);
    expect(r.isPeakNow).toBe(false);
  });

  it("composed after the day's slot rolls to the next day", () => {
    const now = at(CHI, 2026, 6, 10, 16); // Wed 16:00, past 11:00
    const r = bestSendWindow({ cityTimezone: CHI, now });
    const p = getZonedParts(CHI, r.sendAt);
    expect(p.day).toBe(11); // Thursday
    expect(p.hour).toBe(11);
  });

  it("never proposes a dead-night or peak hour", () => {
    // sweep many starting points; the chosen hour must always be acceptable
    for (let h = 0; h < 24; h++) {
      const now = at(CHI, 2026, 6, 12, h); // Friday at every hour
      const r = bestSendWindow({ cityTimezone: CHI, now });
      const p = getZonedParts(CHI, r.sendAt);
      expect(isPeakServiceHour(p.weekday, p.hour)).toBe(false);
      expect(p.hour).toBeGreaterThanOrEqual(8);
      expect(p.hour).toBeLessThan(18);
      expect(r.sendAt.getTime()).toBeGreaterThan(now.getTime());
    }
  });
});

describe("bestSendWindow reply-history bias", () => {
  it("a venue with replies clustered at 1pm gets a 1pm slot", () => {
    const now = at(CHI, 2026, 6, 10, 9); // Wed 09:00
    const replyHistory: ReplyHistoryPoint[] = [
      { localHour: 13 },
      { localHour: 13 },
      { localHour: 13 },
      { localHour: 9 },
    ];
    const r = bestSendWindow({ cityTimezone: CHI, now, replyHistory });
    expect(r.source).toBe("reply_history");
    expect(r.localHour).toBe(13);
    expect(getZonedParts(CHI, r.sendAt).hour).toBe(13);
  });

  it("ignores out-of-band reply hours (3am, 9pm) and falls back to heuristic", () => {
    const now = at(CHI, 2026, 6, 10, 9);
    const replyHistory: ReplyHistoryPoint[] = [
      { localHour: 3 },
      { localHour: 23 },
      { localHour: 21 },
    ];
    const r = bestSendWindow({ cityTimezone: CHI, now, replyHistory });
    expect(r.source).toBe("heuristic");
    expect(r.localHour).toBe(11);
  });

  it("requires a minimum number of usable points before trusting history", () => {
    const now = at(CHI, 2026, 6, 10, 9);
    const replyHistory: ReplyHistoryPoint[] = [{ localHour: 13 }, { localHour: 13 }]; // only 2
    const r = bestSendWindow({ cityTimezone: CHI, now, replyHistory });
    expect(r.source).toBe("heuristic");
  });

  it("resolves a tie to the earlier hour", () => {
    const now = at(CHI, 2026, 6, 10, 6);
    const replyHistory: ReplyHistoryPoint[] = [
      { localHour: 14 },
      { localHour: 14 },
      { localHour: 10 },
      { localHour: 10 },
    ];
    const r = bestSendWindow({ cityTimezone: CHI, now, replyHistory });
    expect(r.localHour).toBe(10);
  });
});

describe("timezone independence", () => {
  it("targets 11:00 in the venue's own zone regardless of zone", () => {
    for (const tz of [NYC, LA, CHI]) {
      const now = at(tz, 2026, 6, 12, 21); // Fri 9pm local
      const r = bestSendWindow({ cityTimezone: tz, now });
      expect(getZonedParts(tz, r.sendAt).hour).toBe(11);
      expect(getZonedParts(tz, r.sendAt).weekday).toBe(6); // Saturday
    }
  });
});

describe("isFavoredDaytimeHour", () => {
  it("favors 11:00-14:59, excludes the rest", () => {
    expect(isFavoredDaytimeHour(11)).toBe(true);
    expect(isFavoredDaytimeHour(14)).toBe(true);
    expect(isFavoredDaytimeHour(15)).toBe(false);
    expect(isFavoredDaytimeHour(9)).toBe(false);
    expect(isFavoredDaytimeHour(20)).toBe(false);
  });
});

describe("isPeakServiceWindow", () => {
  it("true at Fri 21:00 local, false at Wed 13:00 local", () => {
    expect(isPeakServiceWindow(CHI, at(CHI, 2026, 6, 12, 21))).toBe(true);
    expect(isPeakServiceWindow(CHI, at(CHI, 2026, 6, 10, 13))).toBe(false);
  });
});
