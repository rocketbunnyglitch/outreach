"use server";

/**
 * Server actions for syncing per-user UI preferences across devices.
 *
 * Reads happen at page-render time via lib/user-preferences directly;
 * this action is for client-initiated writes (the InboxDensityToggle
 * popover firing on each density / reading-pane choice).
 */

import { requireStaff } from "@/lib/auth";
import { type UserPrefs, setUserPreference } from "@/lib/user-preferences";

export async function updateUserPreferences(patch: Partial<UserPrefs>): Promise<{ ok: true }> {
  const { staff } = await requireStaff();
  await setUserPreference(staff.id, patch);
  return { ok: true };
}
