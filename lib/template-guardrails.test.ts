import { describe, expect, it } from "vitest";
import { checkTemplateCopy, templateCopyIsClean } from "./template-guardrails";

const KEYS = [
  "venue_name",
  "contact_first_name",
  "company_name",
  "signature_block",
  "guest_count",
  "turnout_quote_current",
  "venue_nights_summary",
  "event_date",
];

describe("checkTemplateCopy", () => {
  it("passes clean, merge-field-correct copy", () => {
    const body =
      "Hey {{contact_first_name}}, we'd love {{venue_name}} for {{venue_nights_summary}}.\n{{signature_block}}";
    expect(checkTemplateCopy("Partner with {{venue_name}}", body, KEYS)).toEqual([]);
    expect(templateCopyIsClean("hi", body, KEYS)).toBe(true);
  });

  it("flags a hallucinated merge field", () => {
    const v = checkTemplateCopy("x", "Hi {{venue_owner_name}}, {{signature_block}}", KEYS);
    expect(v.map((x) => x.code)).toContain("unknown_merge_field");
  });

  it("flags an unresolved [??field??] marker", () => {
    const v = checkTemplateCopy("x", "Expecting [??guest_count??] guests.", KEYS);
    expect(v.some((x) => x.code === "unresolved_merge")).toBe(true);
  });

  it("flags a hardcoded outreach brand name/domain", () => {
    expect(
      checkTemplateCopy("x", "Reach us at hello@events-perse.com", KEYS).some(
        (x) => x.code === "hardcoded_brand",
      ),
    ).toBe(true);
    expect(
      checkTemplateCopy("x", "This is Frightcrawlco reaching out", KEYS).some(
        (x) => x.code === "hardcoded_brand",
      ),
    ).toBe(true);
  });

  it("flags a literal turnout figure but allows the merge field", () => {
    expect(
      checkTemplateCopy("x", "We expect about 200 people.", KEYS).some(
        (x) => x.code === "hardcoded_turnout",
      ),
    ).toBe(true);
    expect(
      checkTemplateCopy("x", "We're projecting 150 guests for your slot.", KEYS).some(
        (x) => x.code === "hardcoded_turnout",
      ),
    ).toBe(true);
    // The correct form must NOT trip it.
    expect(
      checkTemplateCopy("x", "We're projecting {{guest_count}} for your slot.", KEYS).some(
        (x) => x.code === "hardcoded_turnout",
      ),
    ).toBe(false);
  });

  it("does not mistake times/dates for turnout", () => {
    const body = "We run 7:30 PM to 2:00 AM on Thursday, October 29th. {{signature_block}}";
    expect(checkTemplateCopy("x", body, KEYS)).toEqual([]);
  });
});
