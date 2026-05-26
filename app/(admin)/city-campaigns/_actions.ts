"use server";

/**
 * CityCampaign actions — manage which cities participate in which campaigns,
 * with priority and per-city sales goals.
 */

import { cityCampaigns } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import { type ActionResult, formToObject } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import {
  type CityCampaignCreateInput,
  type CityCampaignUpdateInput,
  cityCampaignCreateSchema,
  cityCampaignUpdateSchema,
} from "@/lib/validation/city-campaigns";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { DatabaseError } from "pg";

function wrapDbError(err: unknown, action: string): ActionResult<never> {
  const dbErr = err as DatabaseError;
  logger.error({ err, action }, "city-campaign action failed");
  if (dbErr?.code === "23505") {
    return {
      ok: false,
      error: "That city is already in this campaign.",
    };
  }
  if (dbErr?.code === "23503") {
    return { ok: false, error: "Referenced city, campaign, or staff not found." };
  }
  return { ok: false, error: "Unexpected database error. See server logs." };
}

export async function addCityToCampaign(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = cityCampaignCreateSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const input: CityCampaignCreateInput = parsed.data;

  try {
    const [row] = await withAuditContext(staff.id, async (tx) =>
      tx
        .insert(cityCampaigns)
        .values({
          cityId: input.cityId,
          campaignId: input.campaignId,
          priority: input.priority,
          targetVenueCount: input.targetVenueCount,
          targetWristbandCount: input.targetWristbandCount,
          targetFinalCount: input.targetFinalCount,
          targetMiddleCount: input.targetMiddleCount,
          salesGoalCents:
            input.salesGoalCents !== undefined ? BigInt(input.salesGoalCents) : undefined,
          leadStaffId: input.leadStaffId ?? null,
          status: input.status ?? "planning",
          createdBy: staff.id,
          updatedBy: staff.id,
        })
        .returning({ id: cityCampaigns.id }),
    );
    if (!row) throw new Error("insert returned no row");
    revalidatePath(`/campaigns/${input.campaignId}`);
    return { ok: true, data: { id: row.id } };
  } catch (err) {
    return wrapDbError(err, "add city to campaign");
  }
}

export async function updateCityCampaign(
  id: string,
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = cityCampaignUpdateSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const input: CityCampaignUpdateInput = parsed.data;

  const patch: Partial<typeof cityCampaigns.$inferInsert> = {
    updatedBy: staff.id,
  };
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.targetVenueCount !== undefined) patch.targetVenueCount = input.targetVenueCount;
  if (input.targetWristbandCount !== undefined)
    patch.targetWristbandCount = input.targetWristbandCount;
  if (input.targetFinalCount !== undefined) patch.targetFinalCount = input.targetFinalCount;
  if (input.targetMiddleCount !== undefined) patch.targetMiddleCount = input.targetMiddleCount;
  if (input.salesGoalCents !== undefined) patch.salesGoalCents = BigInt(input.salesGoalCents);
  if (input.leadStaffId !== undefined) patch.leadStaffId = input.leadStaffId;
  if (input.status !== undefined) patch.status = input.status;

  try {
    await withAuditContext(staff.id, async (tx) =>
      tx.update(cityCampaigns).set(patch).where(eq(cityCampaigns.id, id)),
    );
    revalidatePath(`/city-campaigns/${id}`);
    return { ok: true, data: { id } };
  } catch (err) {
    return wrapDbError(err, "update city campaign");
  }
}

export async function removeCityCampaign(id: string): Promise<void> {
  const { staff } = await requireStaff();
  const result = await db
    .select({ campaignId: cityCampaigns.campaignId })
    .from(cityCampaigns)
    .where(eq(cityCampaigns.id, id))
    .limit(1);
  const cc = result[0];

  await withAuditContext(staff.id, async (tx) =>
    tx.delete(cityCampaigns).where(eq(cityCampaigns.id, id)),
  );
  if (cc?.campaignId) revalidatePath(`/campaigns/${cc.campaignId}`);
  redirect(cc?.campaignId ? `/campaigns/${cc.campaignId}` : "/campaigns");
}
