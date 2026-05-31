"use server";

/**
 * Server actions for syncing per-user UI preferences across devices.
 *
 * Reads happen at page-render time via lib/user-preferences directly;
 * this action is for client-initiated writes (the InboxDensityToggle
 * popover firing on each density / reading-pane choice).
 */

import { requireStaff } from "@/lib/auth";
import {
  type UserPrefs,
  setInboxAccountFilterForCampaign,
  setUserPreference,
} from "@/lib/user-preferences";

export async function updateUserPreferences(patch: Partial<UserPrefs>): Promise<{ ok: true }> {
  const { staff } = await requireStaff();
  await setUserPreference(staff.id, patch);
  return { ok: true };
}

/**
 * Persist the AccountSwitcher's per-campaign visibility selection.
 * Server-validated against the operator's identity; the client
 * passes the campaign key + selected ids.
 *
 * Empty arrays clear the entry for that campaign (next read falls
 * back to "every account I can see").
 */
export async function saveInboxAccountFilter(input: {
  campaignKey: string;
  accountIds: string[];
}): Promise<{ ok: true }> {
  const { staff } = await requireStaff();
  await setInboxAccountFilterForCampaign(staff.id, input.campaignKey, input.accountIds);
  return { ok: true };
}
