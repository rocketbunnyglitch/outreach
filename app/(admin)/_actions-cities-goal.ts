"use server";

/**
 * Server actions for the dashboard cities-completed KPI card.
 *
 * The card shows "completed / goal" plus a dotted-arc visual. The goal
 * lives on the campaign row (campaigns.target_cities_scheduled) and is
 * editable inline on the card itself — but only by admins, since it's a
 * top-down target the rest of the team works against.
 */

import { campaigns } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { withAuditContext } from "@/lib/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const schema = z.object({
  campaignId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  goal: z.number().int().min(1).max(500),
});

export async function updateCampaignCitiesGoal(input: {
  campaignId: string;
  goal: number;
}): Promise<{ ok: boolean; error?: string }> {
  const { staff } = await requireAdmin();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  try {
    await withAuditContext(staff.id, async (tx) =>
      tx
        .update(campaigns)
        .set({ targetCitiesScheduled: parsed.data.goal, updatedBy: staff.id })
        .where(eq(campaigns.id, parsed.data.campaignId)),
    );
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    console.error("[updateCampaignCitiesGoal] failed", { err });
    return { ok: false, error: "Couldn't update the goal." };
  }
}
