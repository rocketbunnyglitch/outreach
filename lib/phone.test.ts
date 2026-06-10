import { describe, expect, it } from "vitest";
import { isE164, toE164 } from "./phone";

describe("toE164", () => {
  it("normalizes bare NANP 10-digit", () => {
    expect(toE164("(416) 555-1234")).toBe("+14165551234");
    expect(toE164("416-555-1234")).toBe("+14165551234");
  });

  it("normalizes 11-digit starting with 1", () => {
    expect(toE164("1 416 555 1234")).toBe("+14165551234");
  });

  it("keeps international + numbers", () => {
    expect(toE164("+44 20 7946 0958")).toBe("+442079460958");
    expect(toE164("+14165551234")).toBe("+14165551234");
  });

  it("strips trailing extensions instead of folding them into the number", () => {
    expect(toE164("416-555-1234 x202")).toBe("+14165551234");
    expect(toE164("416-555-1234 ext. 12")).toBe("+14165551234");
    expect(toE164("(416) 555-1234 extension 9")).toBe("+14165551234");
    expect(toE164("416-555-1234 #4")).toBe("+14165551234");
  });

  it("returns empty for empty-ish input", () => {
    expect(toE164(null)).toBe("");
    expect(toE164(undefined)).toBe("");
    expect(toE164("  ")).toBe("");
    expect(toE164("n/a")).toBe("");
  });

  it("returns empty (never a bogus number) for un-normalizable input", () => {
    expect(toE164("555-1234")).toBe(""); // 7-digit local
    expect(toE164("123456789")).toBe(""); // 9-digit legacy garbage
    expect(toE164("4165551234 4165551234")).toBe(""); // double-pasted, 20 digits
    expect(toE164("+0123456789")).toBe(""); // leading zero after +
  });
});

describe("isE164", () => {
  it("accepts valid", () => {
    expect(isE164("+14165551234")).toBe(true);
    expect(isE164("+442079460958")).toBe(true);
  });
  it("rejects invalid", () => {
    expect(isE164("4165551234")).toBe(false);
    expect(isE164("+0165551234")).toBe(false);
    expect(isE164("+1234")).toBe(false);
  });
});
