import "server-only";

/**
 * User preferences — read + upsert helpers for the user_preferences
 * table. See migration 0060 / db/schema/user-preferences.ts.
 *
 * The InboxDensityToggle component reads via getUserPreferences on
 * mount (server-side, via a server action) and writes via
 * upsertUserPreferences when the operator changes a setting. The
 * local localStorage cache stays as a no-flicker hint between
 * navigations, but the table is the source of truth.
 *
 * Returns null when the user has no preferences row yet — caller
 * should fall back to defaults.
 */

import { userPreferences } from "@/db/schema";
import { db } from "@/lib/db";
import { eq, sql } from "drizzle-orm";

export type InboxDensity = "compact" | "default" | "comfortable";
export type ReadingPanePosition = "right" | "bottom" | "none";

export interface UserPrefs {
  inboxDensity: InboxDensity | null;
  inboxReadingPane: ReadingPanePosition | null;
}

export async function getUserPreferences(userId: string): Promise<UserPrefs | null> {
  const [row] = await db
    .select({
      inboxDensity: userPreferences.inboxDensity,
      inboxReadingPane: userPreferences.inboxReadingPane,
    })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  if (!row) return null;
  return {
    inboxDensity: (row.inboxDensity as InboxDensity | null) ?? null,
    inboxReadingPane: (row.inboxReadingPane as ReadingPanePosition | null) ?? null,
  };
}

/**
 * Upsert a single preference key. We don't take the whole UserPrefs
 * object because callers usually change one toggle at a time —
 * touching both at once would risk overwriting a setting the user
 * just changed on a different device between reads.
 *
 * Use ON CONFLICT DO UPDATE so first-time callers don't need a
 * separate INSERT path.
 */
export async function setUserPreference(userId: string, patch: Partial<UserPrefs>): Promise<void> {
  // Validate enum values defensively — the action is callable from
  // the client.
  const density = isInboxDensity(patch.inboxDensity ?? null) ? patch.inboxDensity : undefined;
  const pane = isReadingPanePosition(patch.inboxReadingPane ?? null)
    ? patch.inboxReadingPane
    : undefined;
  if (density === undefined && pane === undefined) return;

  await db
    .insert(userPreferences)
    .values({
      userId,
      inboxDensity: density ?? null,
      inboxReadingPane: pane ?? null,
    })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: {
        ...(density !== undefined ? { inboxDensity: density ?? null } : {}),
        ...(pane !== undefined ? { inboxReadingPane: pane ?? null } : {}),
        updatedAt: sql`NOW()`,
      },
    });
}

function isInboxDensity(v: unknown): v is InboxDensity | null {
  return v === null || v === "compact" || v === "default" || v === "comfortable";
}

function isReadingPanePosition(v: unknown): v is ReadingPanePosition | null {
  return v === null || v === "right" || v === "bottom" || v === "none";
}
