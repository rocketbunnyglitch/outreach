import "server-only";

import { noteActionSuggestions } from "@/db/schema";
import { db } from "@/lib/db";
import { and, eq, inArray } from "drizzle-orm";

export type PendingSuggestion = typeof noteActionSuggestions.$inferSelect;

/**
 * Load all PENDING smart-note suggestions for a given list of note IDs.
 * Returns a Map keyed on note_id for O(1) lookup by the rendering loop.
 */
export async function loadPendingSuggestionsForNotes(
  noteIds: string[],
): Promise<Map<string, PendingSuggestion[]>> {
  if (noteIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(noteActionSuggestions)
    .where(
      and(
        eq(noteActionSuggestions.status, "pending"),
        inArray(noteActionSuggestions.noteId, noteIds),
      ),
    );
  const map = new Map<string, PendingSuggestion[]>();
  for (const r of rows) {
    const list = map.get(r.noteId) ?? [];
    list.push(r);
    map.set(r.noteId, list);
  }
  return map;
}
