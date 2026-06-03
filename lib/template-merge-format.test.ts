import {
  canonicalRoleLabels,
  crawlsCountLabel,
  dayPartLabel,
  eventDayName,
  formatEventDate,
  guestCount,
  joinAnd,
  openSlotsLabel,
  payRateLabel,
  roleLabel,
  shortDateLabel,
} from "@/lib/template-merge-format";
import { describe, expect, it } from "vitest";

describe("date formatting (UTC-pinned)", () => {
  it("formats the full event date", () => {
    expect(formatEventDate("2026-10-31")).toBe("Saturday, October 31");
  });
  it("formats the day name", () => {
    expect(eventDayName("2026-10-31")).toBe("Saturday");
  });
  it("formats the short date label", () => {
    expect(shortDateLabel("2026-10-29")).toBe("Thursday, Oct 29");
  });
});

describe("role + day-part labels", () => {
  it("maps middle to Participating", () => {
    expect(roleLabel("middle")).toBe("Participating");
    expect(roleLabel("wristband")).toBe("Wristband");
    expect(roleLabel("alt_final")).toBe("Final");
  });
  it("labels day parts", () => {
    expect(dayPartLabel("thursday_night")).toBe("Thursday night");
    expect(dayPartLabel("saturday_day")).toBe("Saturday day");
  });
});

describe("crawl + slot phrasing", () => {
  it("pluralizes crawl counts", () => {
    expect(crawlsCountLabel(1)).toBe("1 crawl");
    expect(crawlsCountLabel(3)).toBe("3 crawls");
  });
  it("orders + dedupes roles canonically", () => {
    expect(canonicalRoleLabels(["final", "middle", "middle", "wristband"])).toEqual([
      "Wristband",
      "Participating",
      "Final",
    ]);
  });
  it("phrases open slots, lowercased with Oxford comma", () => {
    expect(openSlotsLabel(["wristband", "final"])).toBe("wristband and final");
    expect(openSlotsLabel(["wristband", "middle", "final"])).toBe(
      "wristband, participating, and final",
    );
    expect(openSlotsLabel([])).toBe("fully booked");
  });
});

describe("joinAnd", () => {
  it("handles 0/1/2/3 items", () => {
    expect(joinAnd([])).toBe("");
    expect(joinAnd(["a"])).toBe("a");
    expect(joinAnd(["a", "b"])).toBe("a and b");
    expect(joinAnd(["a", "b", "c"])).toBe("a, b, and c");
  });
});

describe("guestCount reduces to a bare count for 'around {{guest_count}}'", () => {
  it("strips leading qualifiers", () => {
    expect(guestCount("about 200")).toBe("200");
    expect(guestCount("around 50")).toBe("50");
  });
  it("keeps ranges", () => {
    expect(guestCount("100-200")).toBe("100-200");
    expect(guestCount("50-80")).toBe("50-80");
    expect(guestCount("30-50, depending")).toBe("30-50");
  });
  it("extracts the total from a verbose phrase", () => {
    expect(guestCount("around 20 split across stops, steady flow - total ~50")).toBe("50");
  });
});

describe("payRateLabel", () => {
  it("formats whole + fractional dollars, blank when zero", () => {
    expect(payRateLabel(2500, "CAD")).toBe("$25/hr CAD");
    expect(payRateLabel(2550, "USD")).toBe("$25.50/hr USD");
    expect(payRateLabel(0, "CAD")).toBe("");
  });
});
