import { extractEmailAddress, parseEmailHeader, parseEmailList } from "@/lib/email-address";
import { describe, expect, it } from "vitest";

// Pure RFC 5322-style header parsing. No DB / network -- safe to import
// directly. These lock in the documented behavior of lib/email-address.ts
// (the parsing rules that drive venue matching + duplicate detection).

describe("parseEmailHeader", () => {
  it("parses a display-name + angle-bracket address and lowercases the addr", () => {
    expect(parseEmailHeader("Mike Smith <INFO@Venue.com>")).toEqual({
      email: "info@venue.com",
      name: "Mike Smith",
    });
  });

  it("parses a bare address with no display name", () => {
    expect(parseEmailHeader("info@venue.com")).toEqual({
      email: "info@venue.com",
      name: null,
    });
  });

  it("strips surrounding quotes from a display name that itself contains a comma", () => {
    expect(parseEmailHeader('"VC, ALL" <vc-all@firm.com>')).toEqual({
      email: "vc-all@firm.com",
      name: "VC, ALL",
    });
  });

  it("returns null email for non-address input and for empty/nullish input", () => {
    expect(parseEmailHeader("not an email")).toEqual({ email: null, name: null });
    expect(parseEmailHeader("")).toEqual({ email: null, name: null });
    expect(parseEmailHeader(null)).toEqual({ email: null, name: null });
    expect(parseEmailHeader(undefined)).toEqual({ email: null, name: null });
  });
});

describe("parseEmailList", () => {
  it("splits a multi-recipient list and normalizes each address", () => {
    expect(parseEmailList("Mike <a@x.com>, Bryle <b@y.com>")).toEqual(["a@x.com", "b@y.com"]);
  });

  it("does not split on a comma inside a quoted display name", () => {
    expect(parseEmailList('"Last, First" <a@x.com>, plain@y.com')).toEqual([
      "a@x.com",
      "plain@y.com",
    ]);
  });

  it("lowercases, dedupes, and drops malformed entries", () => {
    expect(parseEmailList("a@x.com, A@X.COM, junk")).toEqual(["a@x.com"]);
  });

  it("returns an empty array for nullish input", () => {
    expect(parseEmailList(null)).toEqual([]);
    expect(parseEmailList(undefined)).toEqual([]);
  });
});

describe("extractEmailAddress", () => {
  it("returns just the normalized address, or null when unparsable", () => {
    expect(extractEmailAddress("Mike <Mike@X.com>")).toBe("mike@x.com");
    expect(extractEmailAddress("garbage")).toBeNull();
  });
});
