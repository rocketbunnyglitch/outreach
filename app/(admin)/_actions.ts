"use server";

/**
 * Admin-shell server actions. Used by chrome components (nav, user menu).
 */

import { signOut } from "@/auth";
import { staffMembers } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { clearCurrentCampaignCookie, setCurrentCampaignCookie } from "@/lib/current-campaign";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}

/**
 * Switch the current campaign. Called from the dropdown in the top nav.
 * The form sends `campaignId` (or the literal "_clear" to forget the
 * selection).
 */
export async function switchCurrentCampaign(formData: FormData): Promise<void> {
  const raw = String(formData.get("campaignId") ?? "").trim();
  if (raw === "_clear" || raw === "") {
    await clearCurrentCampaignCookie();
  } else {
    await setCurrentCampaignCookie(raw);
  }
  // Refresh every admin route — most pages display per-campaign data.
  revalidatePath("/", "layout");
}

/**
 * Set the current campaign + navigate to its operations dashboard.
 *
 * Used by the city-sheet breadcrumb ("< Campaign name"). Operators
 * flagged (session 12) that this back-link went to the campaign SETUP
 * page (/campaigns/[id]); it should return to that campaign's OPS
 * DASHBOARD (/) instead. Since the dashboard scopes by the
 * current-campaign cookie, we set the cookie to this campaign, then
 * redirect to /.
 */
export async function goToCampaignDashboard(formData: FormData): Promise<void> {
  const raw = String(formData.get("campaignId") ?? "").trim();
  if (raw) {
    await setCurrentCampaignCookie(raw);
  }
  redirect("/");
}

/**
 * Update the current staffer's IANA timezone. Surfaces dates/times in
 * the operator's local zone across the app — see CityTime for the
 * canonical consumer.
 *
 * Validation: we only accept timezones that Intl.DateTimeFormat
 * recognizes. No allow-list — the universe of IANA timezones is huge
 * and updates regularly; relying on the runtime keeps us aligned with
 * whatever browsers + Node consider valid.
 */
export async function setStaffTimezone(timezone: string): Promise<{ ok: boolean; error?: string }> {
  const { staff } = await requireStaff();
  try {
    // Validate by feeding it to Intl. Throws RangeError if unknown.
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    return { ok: false, error: "That doesn't look like a valid timezone." };
  }
  try {
    await db.update(staffMembers).set({ timezone }).where(eq(staffMembers.id, staff.id));
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    logger.error({ err, staffId: staff.id, timezone }, "setStaffTimezone failed");
    return { ok: false, error: "Couldn't save your timezone." };
  }
}
