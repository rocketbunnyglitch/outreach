import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Nav parity guard (operator report 2026-06-11: "worklist is not
 * showing on mobile along with probably some other tabs").
 *
 * side-nav.tsx and mobile-section-nav.tsx each keep their own SECTIONS
 * list; 15 routes added to the desktop nav over recent weeks never made
 * it into the mobile strips, so those pages were unreachable on phones.
 * This test fails the build the moment the two lists drift again.
 */

function hrefsOf(file: string): Set<string> {
  const src = readFileSync(join(__dirname, "..", "app", "(admin)", "_components", file), "utf8");
  return new Set([...src.matchAll(/href: "([^"]+)"/g)].map((m) => m[1] as string));
}

describe("desktop/mobile nav parity", () => {
  it("every side-nav route exists in the mobile nav", () => {
    const side = hrefsOf("side-nav.tsx");
    const mobile = hrefsOf("mobile-section-nav.tsx");
    const missing = [...side].filter((h) => !mobile.has(h));
    expect(missing).toEqual([]);
  });

  it("every mobile route exists in the side nav (no orphan mobile-only links)", () => {
    const side = hrefsOf("side-nav.tsx");
    const mobile = hrefsOf("mobile-section-nav.tsx");
    const missing = [...mobile].filter((h) => !side.has(h));
    expect(missing).toEqual([]);
  });
});
