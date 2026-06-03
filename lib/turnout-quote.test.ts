import {
  type SalesUpdateArgs,
  initialPitchQuote,
  salesUpdateQuote,
  turnoutMergeFields,
  waveQualifier,
} from "@/lib/turnout-quote";
import { describe, expect, it } from "vitest";

// The wave qualifier text that must appear in every quote [ReferenceDoc 5.1].
const WAVE =
  "in waves or small groups of 5 to 10 people at a time, not all at once - coming through";

describe("initialPitchQuote [ReferenceDoc 5.2]", () => {
  it("Prio 1 wristband quotes 200-300 through the pickup window", () => {
    const q = initialPitchQuote({
      priority: 1,
      slotType: "wristband",
      slotContext: "pickup_window",
    });
    expect(q.startsWith("200-300")).toBe(true);
    expect(q).toContain(WAVE);
    expect(q).toContain("across your pickup window");
  });

  it("Prio 1 final defaults to 100-200 (capacity reactive, 5.5)", () => {
    const q = initialPitchQuote({ priority: 1, slotType: "final", slotContext: "night" });
    expect(q.startsWith("100-200")).toBe(true);
    expect(q).toContain("through the night");
  });

  it("Prio 5 and 6 share the lowest-volume row", () => {
    const five = initialPitchQuote({
      priority: 5,
      slotType: "wristband",
      slotContext: "pickup_window",
    });
    const six = initialPitchQuote({
      priority: 6,
      slotType: "wristband",
      slotContext: "pickup_window",
    });
    expect(five).toBe(six);
    expect(five.startsWith("around 50")).toBe(true);
  });

  it("always carries the wave qualifier", () => {
    for (const priority of [1, 2, 3, 4, 5, 6] as const) {
      for (const slotType of ["wristband", "middle", "final"] as const) {
        const q = initialPitchQuote({ priority, slotType, slotContext: "slot" });
        expect(q).toContain(WAVE);
      }
    }
  });
});

describe("salesUpdateQuote [ReferenceDoc 5.3 + 5.4]", () => {
  const mid = (ticketsSold: number): SalesUpdateArgs => ({
    ticketsSold,
    slotType: "middle",
    slotContext: "slot",
  });

  it("under 20 sold flags honest-slow and quotes 10-20", () => {
    const r = salesUpdateQuote(mid(12));
    expect(r.phrase.startsWith("10-20")).toBe(true);
    expect(r.honestSlowFlag).toBe(true);
  });

  it("80 sold quotes 30-50 with no slow flag", () => {
    const r = salesUpdateQuote(mid(80));
    expect(r.phrase.startsWith("30-50")).toBe(true);
    expect(r.phrase).toContain(WAVE);
    expect(r.honestSlowFlag).toBe(false);
  });

  it("200 sold quotes around 140 (70% of sold)", () => {
    const r = salesUpdateQuote(mid(200));
    expect(r.phrase.startsWith("around 140")).toBe(true);
    expect(r.honestSlowFlag).toBe(false);
  });

  it("always rounds down: 151 sold -> 70% = 105 -> around 105", () => {
    const r = salesUpdateQuote(mid(151));
    expect(r.phrase.startsWith("around 105")).toBe(true);
  });

  it("rounds DOWN at every boundary (5.4)", () => {
    expect(salesUpdateQuote(mid(50)).phrase.startsWith("10-20")).toBe(true);
    expect(salesUpdateQuote(mid(100)).phrase.startsWith("30-50")).toBe(true);
    expect(salesUpdateQuote(mid(150)).phrase.startsWith("around 80")).toBe(true);
  });

  it("wave qualifier is always present", () => {
    for (const sold of [0, 19, 20, 51, 101, 151, 500]) {
      expect(salesUpdateQuote(mid(sold)).phrase).toContain(WAVE);
    }
  });
});

describe("waveQualifier tail adapts to slot context [ReferenceDoc 5.1]", () => {
  it("maps each slot context to its tail clause", () => {
    expect(waveQualifier("pickup_window")).toContain("across your pickup window");
    expect(waveQualifier("slot")).toContain("across your slot");
    expect(waveQualifier("night")).toContain("through the night");
    expect(waveQualifier("afternoon")).toContain("through the afternoon");
  });
});

describe("turnoutMergeFields wiring", () => {
  it("returns turnout_quote and omits sales update when no count", () => {
    const m = turnoutMergeFields({
      priority: 1,
      slotType: "wristband",
      slotContext: "pickup_window",
    });
    expect(m.turnout_quote.startsWith("200-300")).toBe(true);
    expect(m.turnout_quote_sales_update).toBeUndefined();
  });

  it("includes turnout_quote_sales_update when a count is given", () => {
    const m = turnoutMergeFields({
      priority: 1,
      slotType: "middle",
      slotContext: "slot",
      ticketsSold: 80,
    });
    expect(m.turnout_quote_sales_update?.startsWith("30-50")).toBe(true);
  });
});
