import { parseAccountIds } from "@/lib/account-filter";
import { describe, expect, it } from "vitest";

// Pure URL-param parser from lib/account-filter.ts (no DB / network /
// server-only). Drives the AccountSwitcher scope on the inbox + thread
// pages. The "no filter" sentinel is undefined; garbage is dropped, never
// thrown, so a stale id can't 500 the page.

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

describe("parseAccountIds", () => {
  it("returns undefined for missing / empty input (the no-filter sentinel)", () => {
    expect(parseAccountIds(undefined)).toBeUndefined();
    expect(parseAccountIds("")).toBeUndefined();
  });

  it("parses a single UUID into a one-element array", () => {
    expect(parseAccountIds(UUID_A)).toEqual([UUID_A]);
  });

  it("parses a comma-separated list and trims surrounding whitespace", () => {
    expect(parseAccountIds(`${UUID_A} , ${UUID_B}`)).toEqual([UUID_A, UUID_B]);
  });

  it("drops malformed entries but keeps the valid ones", () => {
    expect(parseAccountIds(`${UUID_A},not-a-uuid,,${UUID_B}`)).toEqual([UUID_A, UUID_B]);
  });

  it("returns undefined when every entry is malformed", () => {
    expect(parseAccountIds("junk,;,123")).toBeUndefined();
  });

  it("accepts uppercase UUID hex (case-insensitive)", () => {
    const upper = UUID_A.toUpperCase();
    expect(parseAccountIds(upper)).toEqual([upper]);
  });
});
