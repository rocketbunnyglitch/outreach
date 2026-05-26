"use server";

/**
 * Cadence + sequence-state actions for the operator UI.
 *
 * - createCadenceStep / updateCadenceStep / deleteCadenceStep: brand
 *   admin defines the follow-up sequence
 * - stopSequenceManually: operator clicks "Stop sequence" on a venue
 *   page (e.g. after a phone call, before the auto follow-up fires)
 * - markDeclined: operator records the venue declined; halts cadence
 *   across all brands
 */

import { outreachCadenceSteps } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { withAuditContext } from "@/lib/db";
import { type ActionResult, formToObject } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { stopSequence, stopSequencesForVenue } from "@/lib/outreach-sequences";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const uuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

const stepUpsertSchema = z.object({
  outreachBrandId: uuidSchema,
  stepNumber: z.coerce.number().int().min(2).max(10),
  emailTemplateId: uuidSchema,
  delayDays: z.coerce.number().int().min(0).max(90),
  sendHour: z
    .union([z.literal("").transform(() => undefined), z.coerce.number().int().min(0).max(23)])
    .optional(),
});

export async function upsertCadenceStep(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = stepUpsertSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const input = parsed.data;

  try {
    const id = await withAuditContext(staff.id, async (tx) => {
      // Upsert on (brand, step_number)
      const existing = await tx
        .select({ id: outreachCadenceSteps.id })
        .from(outreachCadenceSteps)
        .where(
          and(
            eq(outreachCadenceSteps.outreachBrandId, input.outreachBrandId),
            eq(outreachCadenceSteps.stepNumber, input.stepNumber),
          ),
        )
        .limit(1)
        .then((r) => r[0]);

      if (existing) {
        await tx
          .update(outreachCadenceSteps)
          .set({
            emailTemplateId: input.emailTemplateId,
            delayDays: input.delayDays,
            sendHour: input.sendHour ?? null,
            updatedBy: staff.id,
          })
          .where(eq(outreachCadenceSteps.id, existing.id));
        return existing.id;
      }
      const [row] = await tx
        .insert(outreachCadenceSteps)
        .values({
          outreachBrandId: input.outreachBrandId,
          stepNumber: input.stepNumber,
          emailTemplateId: input.emailTemplateId,
          delayDays: input.delayDays,
          sendHour: input.sendHour ?? null,
          createdBy: staff.id,
          updatedBy: staff.id,
        })
        .returning({ id: outreachCadenceSteps.id });
      return row?.id ?? "";
    });

    revalidatePath(`/brands/outreach/${input.outreachBrandId}`);
    return { ok: true, data: { id } };
  } catch (err) {
    logger.error({ err }, "upsertCadenceStep failed");
    return { ok: false, error: "Failed to save cadence step." };
  }
}

export async function deleteCadenceStep(stepId: string): Promise<ActionResult<void>> {
  const { staff } = await requireStaff();
  try {
    await withAuditContext(staff.id, async (tx) => {
      await tx.delete(outreachCadenceSteps).where(eq(outreachCadenceSteps.id, stepId));
    });
    return { ok: true, data: undefined };
  } catch (err) {
    logger.error({ err }, "deleteCadenceStep failed");
    return { ok: false, error: "Delete failed." };
  }
}

export async function stopSequenceManually(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing id." };

  try {
    await stopSequence({
      sequenceStateId: id,
      reason: "manual",
      staffMemberId: staff.id,
    });
    revalidatePath("/venues");
    return { ok: true, data: { id } };
  } catch (err) {
    logger.error({ err }, "stopSequenceManually failed");
    return { ok: false, error: "Stop failed." };
  }
}

export async function markDeclined(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ stopped: number }>> {
  const { staff } = await requireStaff();
  const venueId = String(formData.get("venueId") ?? "");
  if (!venueId) return { ok: false, error: "Missing venueId." };

  try {
    const stopped = await stopSequencesForVenue({ venueId, reason: "declined" });
    revalidatePath(`/venues/${venueId}`);
    return { ok: true, data: { stopped } };
  } catch (err) {
    logger.error({ err }, "markDeclined failed");
    return { ok: false, error: "Decline action failed." };
  }
}
