import { describe, expect, it } from "vitest";
import {
  type VenueEligibilityInput,
  decideEligibility,
  domainOf,
  mapWithConcurrency,
} from "./enrichment-eligibility";

const base: VenueEligibilityInput = {
  email: null,
  alternateEmails: [],
  websiteUrl: "https://somebar.com",
  lastAttempt: null,
};

describe("decideEligibility", () => {
  it("skips has_email when a primary email exists", () => {
    expect(decideEligibility({ ...base, email: "x@somebar.com" })).toEqual({
      eligible: false,
      reason: "has_email",
    });
  });

  it("skips has_email when alternate emails exist", () => {
    expect(decideEligibility({ ...base, alternateEmails: ["y@somebar.com"] })).toEqual({
      eligible: false,
      reason: "has_email",
    });
  });

  it("skips no_website when website is null/blank", () => {
    expect(decideEligibility({ ...base, websiteUrl: null }).eligible).toBe(false);
    expect(decideEligibility({ ...base, websiteUrl: "   " })).toEqual({
      eligible: false,
      reason: "no_website",
    });
  });

  it("skips already_attempted and surfaces the last attempt", () => {
    const lastAttempt = { at: "2026-06-01T00:00:00Z", status: "tier1_failed_no_emails" };
    expect(decideEligibility({ ...base, lastAttempt })).toEqual({
      eligible: false,
      reason: "already_attempted",
      lastAttempt,
    });
  });

  it("is eligible with website, no email, no prior attempt", () => {
    expect(decideEligibility(base)).toEqual({ eligible: true });
  });

  it("checks has_email before no_website (priority order)", () => {
    expect(decideEligibility({ ...base, email: "x@somebar.com", websiteUrl: null })).toEqual({
      eligible: false,
      reason: "has_email",
    });
  });
});

describe("mapWithConcurrency", () => {
  it("preserves order and never exceeds the limit", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it("handles an empty list", async () => {
    expect(await mapWithConcurrency([], 5, async () => 1)).toEqual([]);
  });
});

describe("domainOf", () => {
  it("strips scheme + www and lower-cases", () => {
    expect(domainOf("https://www.SomeBar.com/contact")).toBe("somebar.com");
    expect(domainOf("somebar.com")).toBe("somebar.com");
    expect(domainOf(null)).toBeNull();
    expect(domainOf("   ")).toBeNull();
  });
});
