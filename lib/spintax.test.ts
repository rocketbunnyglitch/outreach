import { countVariations, expandSpintax, hasSpintax, seededRng } from "@/lib/spintax";
import { describe, expect, it } from "vitest";

describe("spintax", () => {
  it("detects spintax only when a pipe group is present", () => {
    expect(hasSpintax("{Hi|Hey} there")).toBe(true);
    expect(hasSpintax("no spintax here")).toBe(false);
    expect(hasSpintax("just {{merge_field}} here")).toBe(false);
  });

  it("expands a flat group to one of its options", () => {
    const out = expandSpintax("{Hi|Hey|Hello} Sam", () => 0);
    expect(out).toBe("Hi Sam");
    expect(expandSpintax("{Hi|Hey|Hello} Sam", () => 0.99)).toBe("Hello Sam");
  });

  it("NEVER touches {{merge_field}} syntax", () => {
    expect(expandSpintax("Hello {{venue_name}}, {great|awesome} spot", () => 0)).toBe(
      "Hello {{venue_name}}, great spot",
    );
    // No spintax at all -> merge fields fully intact.
    expect(expandSpintax("Hi {{first_name}} at {{venue_name}}")).toBe(
      "Hi {{first_name}} at {{venue_name}}",
    );
  });

  it("handles nested groups", () => {
    // rng=0 always picks the first option at each level.
    expect(expandSpintax("{a|b {c|d}}", () => 0)).toBe("a");
    // rng high picks the second option -> "b {c|d}" then "b d".
    expect(expandSpintax("{a|b {c|d}}", () => 0.99)).toBe("b d");
  });

  it("seededRng makes body + html expand identically", () => {
    const tpl = "{Hi|Hey|Hello} there, want to {host|run} a {crawl|night}?";
    const a = expandSpintax(tpl, seededRng(42));
    const b = expandSpintax(tpl, seededRng(42));
    expect(a).toBe(b);
    // Different seed can differ (not guaranteed, but the API is deterministic).
    expect(typeof a).toBe("string");
  });

  it("counts variations (flat = exact product)", () => {
    expect(countVariations("{a|b|c} and {x|y}")).toBe(6);
    expect(countVariations("no groups")).toBe(1);
    expect(countVariations("{{merge}} only")).toBe(1);
  });

  it("leaves text without spintax unchanged", () => {
    expect(expandSpintax("plain text, no braces")).toBe("plain text, no braces");
  });
});
