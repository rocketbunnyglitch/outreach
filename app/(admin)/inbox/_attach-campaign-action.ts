"use server";

/**
 * Server action: attach a city_campaign to a thread. Used by the
 * "Looks like this thread is about X" suggestion chip in
 * ThreadPane.
 *
 * Validates that the chosen city_campaign actually exists and that
 * the thread is on the current user's team (via connected_accounts).
 */

import { cityCampaigns, emailThreads, staffOutreachEmails } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function attachCityCampaignToThread(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ threadId: string; cityCampaignId: string }>> {
  const { staff } = await requireStaff();
  const threadId = String(formData.get("threadId") ?? "");
  const cityCampaignId = String(formData.get("cityCampaignId") ?? "");
  if (!UUID_RE.test(threadId) || !UUID_RE.test(cityCampaignId)) {
    return { ok: false, error: "Invalid ids." };
  }

  // Defense in depth: confirm the thread is on the user's team.
  const threadRow = await db
    .select({ teamId: staffOutreachEmails.teamId })
    .from(emailThreads)
    .innerJoin(staffOutreachEmails, eq(staffOutreachEmails.id, emailThreads.staffOutreachEmailId))
    .where(eq(emailThreads.id, threadId))
    .limit(1);
  if (!threadRow[0] || threadRow[0].teamId !== staff.teamId) {
    return { ok: false, error: "Thread not found." };
  }

  // Confirm the city_campaign exists. We don't restrict by team
  // (city_campaigns aren't team-scoped in the current schema; a
  // future migration could add team_id if multi-tenant arrives).
  const ccRow = await db
    .select({ id: cityCampaigns.id })
    .from(cityCampaigns)
    .where(eq(cityCampaigns.id, cityCampaignId))
    .limit(1);
  if (!ccRow[0]) return { ok: false, error: "Campaign not found." };

  try {
    await db
      .update(emailThreads)
      .set({ cityCampaignId, updatedBy: staff.id })
      .where(eq(emailThreads.id, threadId));
    revalidatePath(`/inbox/${threadId}`);
    revalidatePath("/inbox");
    return { ok: true, data: { threadId, cityCampaignId } };
  } catch (err) {
    logger.error({ err, threadId, cityCampaignId }, "attachCityCampaignToThread failed");
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not attach campaign.",
    };
  }
}
