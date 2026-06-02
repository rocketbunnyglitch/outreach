import { formatCountryAbbrev, formatDayPart } from "@/lib/tracker-status-types";
import { describe, expect, it } from "vitest";

// Pure presentation helpers from lib/tracker-status-types.ts (the
// client-safe split with no server-only marker and no DB). These cover
// the day-part label styles + the country-abbrev vernacular mapping that
// the tracker badges depend on.

describe("formatDayPart", () => {
  it("returns the day-of-week label by default", () => {
    expect(formatDayPart("saturday_night")).toBe("Saturday");
    expect(formatDayPart("friday_night")).toBe("Friday");
  });

  it("respects the full and short styles", () => {
    expect(formatDayPart("saturday_night", "full")).toBe("Saturday Night");
    expect(formatDayPart("saturday_night", "short")).toBe("Sat");
  });

  it("uses style-specific fallbacks for nullish input", () => {
    expect(formatDayPart(null)).toBe("Crawl");
    expect(formatDayPart(undefined, "full")).toBe("Crawl");
    expect(formatDayPart("", "short")).toBe("\u2014");
  });

  it("title-cases an unknown enum value rather than returning blank", () => {
    expect(formatDayPart("monday_night")).toBe("Monday Night");
  });
});

describe("formatCountryAbbrev", () => {
  it("maps known ISO codes to the operator vernacular (case-insensitive)", () => {
    expect(formatCountryAbbrev("GB")).toBe("UK");
    expect(formatCountryAbbrev("us")).toBe("USA");
    expect(formatCountryAbbrev("CA")).toBe("CAN");
  });

  it("falls back to the uppercased code for unknown countries, empty for nullish", () => {
    expect(formatCountryAbbrev("fr")).toBe("FR");
    expect(formatCountryAbbrev("")).toBe("");
    expect(formatCountryAbbrev(null)).toBe("");
  });
});
