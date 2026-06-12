import { warmupRampCap, warmupStatus } from "@/lib/inbox-warmup";
import { describe, expect, it } from "vitest";

const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n));
const start = day(0);

describe("inbox warm-up ramp", () => {
  it("returns the full cap when not warming up (null start)", () => {
    expect(warmupRampCap(null, 30, day(0))).toBe(30);
  });

  it("ramps from a small floor on day one up to the target by week 3", () => {
    expect(warmupRampCap(start, 30, day(0))).toBe(6); // 20% (operator-tuned 2026-06-12)
    expect(warmupRampCap(start, 30, day(3))).toBe(12); // 40%
    expect(warmupRampCap(start, 30, day(7))).toBe(17); // 55% -> round(16.5)=17
    expect(warmupRampCap(start, 30, day(14))).toBe(23); // 75% -> round(22.5)=23
    expect(warmupRampCap(start, 30, day(21))).toBe(30); // 100%
    expect(warmupRampCap(start, 30, day(40))).toBe(30); // stays at target
  });

  it("never exceeds the target cap", () => {
    expect(warmupRampCap(start, 10, day(0))).toBeLessThanOrEqual(10);
    expect(warmupRampCap(start, 10, day(40))).toBe(10);
  });

  it("ignores a future start date (clock skew)", () => {
    expect(warmupRampCap(day(5), 30, day(0))).toBe(30);
  });

  it("reports ramping status", () => {
    expect(warmupStatus(start, 30, day(0)).ramping).toBe(true);
    expect(warmupStatus(start, 30, day(21)).ramping).toBe(false);
    expect(warmupStatus(null, 30, day(0)).ramping).toBe(false);
    expect(warmupStatus(start, 30, day(3)).daysIn).toBe(3);
  });
});
