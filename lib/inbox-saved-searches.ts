import "server-only";

/**
 * Saved searches — per-operator pinned inbox queries.
 *
 * The UI in InboxFilterBar renders a dropdown next to the search
 * input. Click an entry to load its query string into the search
 * box; click "save current" to persist whatever's currently
 * typed. Edit/delete/reorder happens from the dropdown's manage
 * sublist.
 *
 * Phase B.2 of the email-system audit.
 */

import { inboxSavedSearches } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export interface SavedSearch {
  id: string;
  label: string;
  queryText: string;
  sortOrder: number | null;
}

/** Load every saved search for the calling operator, ordered for
 *  the dropdown. NULL sort_order entries land at the end. */
export async function loadSavedSearches(userId: string): Promise<SavedSearch[]> {
  const rows = await db
    .select({
      id: inboxSavedSearches.id,
      label: inboxSavedSearches.label,
      queryText: inboxSavedSearches.queryText,
      sortOrder: inboxSavedSearches.sortOrder,
    })
    .from(inboxSavedSearches)
    .where(eq(inboxSavedSearches.userId, userId))
    .orderBy(inboxSavedSearches.sortOrder, inboxSavedSearches.label);
  return rows;
}

// =========================================================================
// Server actions
// =========================================================================

const LABEL_MAX = 80;
const QUERY_MAX = 500;

interface ActionResult {
  ok: boolean;
  error?: string;
}

export async function createSavedSearch(input: {
  label: string;
  queryText: string;
}): Promise<ActionResult> {
  const { staff } = await requireStaff();
  const label = input.label.trim().slice(0, LABEL_MAX);
  const queryText = input.queryText.trim().slice(0, QUERY_MAX);
  if (!label) return { ok: false, error: "Label required." };
  if (!queryText) return { ok: false, error: "Search query required." };

  try {
    await db.insert(inboxSavedSearches).values({ userId: staff.id, label, queryText });
    revalidatePath("/inbox");
    return { ok: true };
  } catch (err: unknown) {
    // Postgres unique constraint maps to "label already in use."
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "23505"
    ) {
      return { ok: false, error: "You already have a saved search with that name." };
    }
    logger.error({ err }, "[saved-searches] create failed");
    return { ok: false, error: "Couldn't save." };
  }
}

export async function renameSavedSearch(input: {
  id: string;
  label: string;
}): Promise<ActionResult> {
  const { staff } = await requireStaff();
  const label = input.label.trim().slice(0, LABEL_MAX);
  if (!label) return { ok: false, error: "Label required." };

  try {
    const updated = await db
      .update(inboxSavedSearches)
      .set({ label, updatedAt: new Date() })
      .where(and(eq(inboxSavedSearches.id, input.id), eq(inboxSavedSearches.userId, staff.id)))
      .returning({ id: inboxSavedSearches.id });
    if (updated.length === 0) return { ok: false, error: "Search not found." };
    revalidatePath("/inbox");
    return { ok: true };
  } catch (err) {
    logger.error({ err, id: input.id }, "[saved-searches] rename failed");
    return { ok: false, error: "Couldn't rename." };
  }
}

export async function deleteSavedSearch(input: { id: string }): Promise<ActionResult> {
  const { staff } = await requireStaff();
  try {
    const deleted = await db
      .delete(inboxSavedSearches)
      .where(and(eq(inboxSavedSearches.id, input.id), eq(inboxSavedSearches.userId, staff.id)))
      .returning({ id: inboxSavedSearches.id });
    if (deleted.length === 0) return { ok: false, error: "Search not found." };
    revalidatePath("/inbox");
    return { ok: true };
  } catch (err) {
    logger.error({ err, id: input.id }, "[saved-searches] delete failed");
    return { ok: false, error: "Couldn't delete." };
  }
}
