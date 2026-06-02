import {
  type CityCandidate,
  matchCity,
  normalizeCityName,
  parseBulkCityCsv,
} from "@/lib/city-name-match";
import { describe, expect, it } from "vitest";

// Pure city-matching helpers from lib/city-name-match.ts (no DB / network /
// server-only). These cover the normalization, the multi-pass match
// (exact / region-disambiguated / fuzzy), and the CSV row parser the bulk
// city importer depends on.

describe("normalizeCityName", () => {
  it("lowercases, trims, collapses whitespace, and strips punctuation", () => {
    expect(normalizeCityName("  New  York,  NY  ")).toBe("new york ny");
    expect(normalizeCityName("Mt. Vernon")).toBe("mt vernon");
  });

  it("returns an empty string for whitespace-only input", () => {
    expect(normalizeCityName("   ")).toBe("");
  });
});

describe("matchCity", () => {
  const cities: CityCandidate[] = [
    { id: "1", name: "Toronto", region: "ON" },
    { id: "2", name: "Springfield", region: "IL" },
    { id: "3", name: "Springfield", region: "MO" },
    { id: "4", name: "London", region: "ON" },
  ];

  it("returns a high-confidence exact match for a unique name", () => {
    const result = matchCity("toronto", cities);
    expect(result.confidence).toBe("high");
    expect(result.candidates.map((c) => c.id)).toEqual(["1"]);
    expect(result.matchedOn).toBe("exact");
  });

  it("disambiguates duplicate names using the region hint", () => {
    const result = matchCity("Springfield, MO", cities);
    expect(result.confidence).toBe("high");
    expect(result.candidates.map((c) => c.id)).toEqual(["3"]);
  });

  it("returns ambiguous when a duplicate name has no usable region hint", () => {
    const result = matchCity("Springfield", cities);
    expect(result.confidence).toBe("ambiguous");
    expect(result.candidates.map((c) => c.id).sort()).toEqual(["2", "3"]);
  });

  it("matches a single-character typo via Levenshtein distance 1", () => {
    const result = matchCity("Tornto", cities);
    expect(result.confidence).toBe("high");
    expect(result.candidates.map((c) => c.id)).toEqual(["1"]);
    expect(result.matchedOn).toBe("levenshtein_1");
  });

  it("returns not_found for input with no plausible match", () => {
    const result = matchCity("Zzyzx", cities);
    expect(result.confidence).toBe("not_found");
    expect(result.candidates).toEqual([]);
  });
});

describe("parseBulkCityCsv", () => {
  it("parses a bare city name per line and skips blank lines", () => {
    expect(parseBulkCityCsv("Toronto\n\nBuffalo")).toEqual([
      { line: "Toronto", priority: null, eventDate: null, crawlNumber: null },
      { line: "Buffalo", priority: null, eventDate: null, crawlNumber: null },
    ]);
  });

  it("extracts an event date and trailing crawl number in extended mode", () => {
    const [row] = parseBulkCityCsv("Toronto, 5, 2026-07-04, 2");
    expect(row).toEqual({
      line: "Toronto",
      priority: 5,
      eventDate: "2026-07-04",
      crawlNumber: 2,
    });
  });

  it("accepts tab-separated input", () => {
    const [row] = parseBulkCityCsv("Buffalo\t3");
    expect(row?.line).toBe("Buffalo");
  });
});
