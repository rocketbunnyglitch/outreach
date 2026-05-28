"use server";

/**
 * /admin/goals server actions.
 *
 * Per decision #025: the ticket-sales-count target is ADMIN-ONLY.
 * Outreach staff see operational goals (target_cities_scheduled,
 * max_priority_for_scheduling) on the regular campaign edit form.
 * The financial target lives here so it doesn't leak into outreach
 * visibility.
 */

import { campaigns } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { withAuditContext } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const updateSchema = z.object({
  campaignId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  /**
   * Empty string clears the goal (sets the column to NULL). A non-
   * empty value must be a positive integer; we cap at 1M tickets to
   * catch fat-finger entries (real campaign targets are in the
   * 100-50,000 range).
   */
  targetTicketSalesCount: z
    .union([z.literal("").transform(() => null), z.coerce.number().int().min(0).max(1_000_000)])
    .optional(),
});

/**
 * Update the ticket-sales-count goal for one campaign. Admin-only.
 * Form-based so the page can use a plain <form action={...}> with
 * progressive enhancement.
 */
export async function updateCampaignTicketSalesGoal(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ campaignId: string }>> {
  const { staff } = await requireAdmin();

  const parsed = updateSchema.safeParse({
    campaignId: formData.get("campaignId"),
    targetTicketSalesCount: formData.get("targetTicketSalesCount") ?? "",
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const { campaignId, targetTicketSalesCount } = parsed.data;

  try {
    await withAuditContext(staff.id, async (tx) => {
      await tx
        .update(campaigns)
        .set({
          targetTicketSalesCount: targetTicketSalesCount ?? null,
          updatedBy: staff.id,
        })
        .where(eq(campaigns.id, campaignId));
    });
    revalidatePath("/admin/goals");
    return { ok: true, data: { campaignId } };
  } catch (err) {
    logger.error({ err, campaignId }, "updateCampaignTicketSalesGoal failed");
    return { ok: false, error: "Couldn't save the goal." };
  }
}
