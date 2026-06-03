/**
 * Task -> reference-doc section map (the "curated retrieval" part of Phase 0.4).
 *
 * Pure module: no server-only / DB / network imports, so it is safe to unit
 * test and to import from anywhere. lib/reference-retrieval.ts wraps this with
 * the DB-backed lookup + full-text fallback.
 *
 * Section codes refer to halloween-2026-intl-engine-reference.md and are
 * listed in dependency order (most load-bearing first); when more sections
 * match than topK allows, the earlier ones win.
 */

export type ReferenceTask =
  | "classify_reply"
  | "suggest_response"
  | "pick_template"
  | "compute_turnout"
  | "draft_t17"
  | "draft_t16"
  | "cancellation_response"
  | "host_briefing"
  | "cadence_decision"
  | "free_text_question"
  | "general"; // fallback -- uses full-text search alone

export const TASK_TO_SECTIONS: Record<ReferenceTask, string[]> = {
  classify_reply: ["6.3", "6.4", "8.3", "8.4"],
  suggest_response: ["5", "8.5", "0.1"],
  pick_template: ["7", "8.7", "9.2"],
  compute_turnout: ["5", "5.2", "5.3"],
  draft_t17: ["7.15", "7.15.1", "10.1"],
  draft_t16: ["7.10", "7.16"],
  cancellation_response: ["7.10", "7.16", "7.16.8", "8.3"],
  host_briefing: ["7.13", "7.13.9", "7.14.2"],
  cadence_decision: ["6", "6.2", "6.3", "9.1"],
  free_text_question: ["5", "8.5", "8.6"],
  general: [],
};
