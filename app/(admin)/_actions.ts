"use server";

/**
 * Admin-shell server actions. Used by chrome components (nav, user menu).
 */

import { signOut } from "@/auth";
import { clearCurrentCampaignCookie, setCurrentCampaignCookie } from "@/lib/current-campaign";
import { revalidatePath } from "next/cache";

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
