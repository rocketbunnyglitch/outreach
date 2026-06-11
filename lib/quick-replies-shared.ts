/**
 * Pure helpers shared between the SERVER thread loaders and the CLIENT
 * chips component. No "use client", no server-only — importable from
 * both sides (hotfix 2026-06-11: ThreadPane, a server component,
 * value-imported normalizeQuickReplies from the "use client"
 * QuickReplyChips module; Next's client-reference proxy throws when a
 * client export is CALLED server-side, which crashed thread rendering).
 */

/** Normalize the ai_quick_replies cache across shapes: legacy v1 was a
 *  bare string[]; v2 (learning loop 2026-06-11) is
 *  { v: 2, chips, exampleIds } where exampleIds are the reply_examples
 *  rows that grounded the chips. */
export function normalizeQuickReplies(raw: unknown): { chips: string[]; exampleIds: string[] } {
  if (Array.isArray(raw)) {
    return { chips: raw.filter((c): c is string => typeof c === "string"), exampleIds: [] };
  }
  if (raw && typeof raw === "object" && "chips" in raw) {
    const obj = raw as { chips?: unknown; exampleIds?: unknown };
    return {
      chips: Array.isArray(obj.chips)
        ? obj.chips.filter((c): c is string => typeof c === "string")
        : [],
      exampleIds: Array.isArray(obj.exampleIds)
        ? obj.exampleIds.filter((c): c is string => typeof c === "string")
        : [],
    };
  }
  return { chips: [], exampleIds: [] };
}
