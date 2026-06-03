import { type RetrievedSection, formatAsSystemPrompt } from "@/lib/reference-retrieval-format";
import { TASK_TO_SECTIONS } from "@/lib/reference-retrieval-task-map";
import { describe, expect, it } from "vitest";

// Pure pieces of the Phase 0.4 retrieval helper (curated task map + system
// prompt formatting). The DB-backed retrieveRelevantSections path imports
// server-only + lib/db and is exercised by the scratch-DB integration check,
// not here -- this file stays import-safe per vitest.config.ts.

describe("TASK_TO_SECTIONS", () => {
  it("maps classify_reply to the four curated classification sections", () => {
    expect(TASK_TO_SECTIONS.classify_reply).toEqual(["6.3", "6.4", "8.3", "8.4"]);
  });

  it("maps compute_turnout to the guest-count math sections", () => {
    expect(TASK_TO_SECTIONS.compute_turnout).toEqual(["5", "5.2", "5.3"]);
  });

  it("uses an empty curated list for the general fallback", () => {
    expect(TASK_TO_SECTIONS.general).toEqual([]);
  });
});

describe("formatAsSystemPrompt", () => {
  const sections: RetrievedSection[] = [
    {
      sectionCode: "8.4",
      sectionTitle: "Auto-classification confidence threshold",
      body: "Auto-act at 90% confidence.",
      score: 1,
    },
    {
      sectionCode: "6.3",
      sectionTitle: "Hard cap per campaign",
      body: "5-6 total touches per venue per campaign.",
      score: 1,
    },
  ];

  it("returns an empty string when there are no sections", () => {
    expect(formatAsSystemPrompt([])).toBe("");
  });

  it("includes a guidance header and one labelled block per section", () => {
    const out = formatAsSystemPrompt(sections);
    expect(out).toContain("PERSE Halloween 2026 Reference Doc");
    expect(out).toContain("flag it for human review");
    expect(out).toContain("----- Section 8.4 - Auto-classification confidence threshold -----");
    expect(out).toContain("Auto-act at 90% confidence.");
    expect(out).toContain("----- Section 6.3 - Hard cap per campaign -----");
  });

  it("preserves the given section order", () => {
    const out = formatAsSystemPrompt(sections);
    expect(out.indexOf("Section 8.4")).toBeLessThan(out.indexOf("Section 6.3"));
  });
});
