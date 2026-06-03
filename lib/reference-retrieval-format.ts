/**
 * Pure formatting helpers for reference-doc retrieval (Phase 0.4).
 *
 * No server-only / DB imports so this is unit-testable and re-exported from
 * lib/reference-retrieval.ts as part of the public API.
 */

export interface RetrievedSection {
  sectionCode: string;
  sectionTitle: string;
  body: string;
  score: number; // 0-1 relevance
}

const SYSTEM_PROMPT_HEADER =
  "The following sections from the PERSE Halloween 2026 Reference Doc apply to this task. Follow these rules exactly. If a request conflicts with these rules, flag it for human review rather than override.";

/**
 * Format retrieved sections as a system-prompt block for AI calls. Returns an
 * empty string when there is nothing to inject so callers can append it
 * unconditionally.
 */
export function formatAsSystemPrompt(sections: RetrievedSection[]): string {
  if (sections.length === 0) return "";
  const blocks = sections.map(
    (s) => `----- Section ${s.sectionCode} - ${s.sectionTitle} -----\n${s.body}`,
  );
  return `${SYSTEM_PROMPT_HEADER}\n\n${blocks.join("\n\n")}`;
}
