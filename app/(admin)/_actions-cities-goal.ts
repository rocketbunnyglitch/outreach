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

// =========================================================================
// Target date — the dashboard "TARGET DATE" card uses campaigns.end_date
// as the day the team is racing toward. Same admin-edit pattern as the
// cities goal: the value lives on the campaign row (top-down target),
// the card opens an inline editor on click.
// =========================================================================

const targetDateSchema = z.object({
  campaignId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  // ISO date string (YYYY-MM-DD) from the <input type="date"> element.
  // Constrained to plausible campaign window (today's date can be in the
  // recent past for ongoing campaigns; 5 years out is the upper bound).
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .refine((s) => {
      const d = new Date(`${s}T00:00:00Z`);
      if (Number.isNaN(d.getTime())) return false;
      const earliest = new Date();
      earliest.setFullYear(earliest.getFullYear() - 1);
      const latest = new Date();
      latest.setFullYear(latest.getFullYear() + 5);
      return d >= earliest && d <= latest;
    }, "Date must be within the campaign window."),
});

export async function updateCampaignTargetDate(input: {
  campaignId: string;
  endDate: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { staff } = await requireAdmin();
  const parsed = targetDateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }
  try {
    await withAuditContext(staff.id, async (tx) =>
      tx
        .update(campaigns)
        .set({ endDate: parsed.data.endDate, updatedBy: staff.id })
        .where(eq(campaigns.id, parsed.data.campaignId)),
    );
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    console.error("[updateCampaignTargetDate] failed", { err });
    return { ok: false, error: "Couldn't update the target date." };
  }
}
