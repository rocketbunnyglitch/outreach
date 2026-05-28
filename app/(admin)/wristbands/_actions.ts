"use server";

/**
 * Wristband shipping edits. The /wristbands table is the shipping
 * management surface (operator session-12 P3). One upsert action sets
 * the shipping fields for a wristband-role venue_event, creating the
 * wristbands row on first edit (the "needs setup" case — a confirmed
 * wristband venue_event with no wristbands row yet).
 */

import { wristbands } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { withAuditContext } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

const schema = z.object({
  venueEventId: uuid,
  recipientName: z.string().max(200).optional(),
  recipientPhone: z.string().max(40).optional(),
  shippingAddress: z.string().max(500).optional(),
  carrier: z.string().max(80).optional(),
  trackingNumber: z.string().max(120).optional(),
  quantity: z.coerce.number().int().min(0).max(100000).optional(),
  status: z.enum(["pending", "ready_to_ship", "shipped", "delivered", "issue"]),
});

export async function upsertWristbandShipping(
  input: z.infer<typeof schema>,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid shipping details." };
  const d = parsed.data;

  // Set shipped/delivered timestamps when the status crosses those
  // thresholds (only stamp the first time we see them).
  const now = new Date();

  const fields = {
    recipientName: d.recipientName?.trim() || null,
    recipientPhone: d.recipientPhone?.trim() || null,
    shippingAddress: d.shippingAddress?.trim() || null,
    carrier: d.carrier?.trim() || null,
    trackingNumber: d.trackingNumber?.trim() || null,
    quantity: d.quantity ?? 0,
    status: d.status,
    updatedBy: staff.id,
  };

  try {
    const id = await withAuditContext(staff.id, async (tx) => {
      const existing = await tx
        .select({
          id: wristbands.id,
          shippedAt: wristbands.shippedAt,
          deliveredAt: wristbands.deliveredAt,
        })
        .from(wristbands)
        .where(eq(wristbands.venueEventId, d.venueEventId))
        .limit(1)
        .then((r) => r[0]);

      const stamps: { shippedAt?: Date; deliveredAt?: Date } = {};
      if (d.status === "shipped" && !existing?.shippedAt) stamps.shippedAt = now;
      if (d.status === "delivered") {
        if (!existing?.shippedAt) stamps.shippedAt = now;
        if (!existing?.deliveredAt) stamps.deliveredAt = now;
      }

      if (existing) {
        await tx
          .update(wristbands)
          .set({ ...fields, ...stamps })
          .where(eq(wristbands.id, existing.id));
        return existing.id;
      }
      const [row] = await tx
        .insert(wristbands)
        .values({
          venueEventId: d.venueEventId,
          ...fields,
          ...stamps,
          createdBy: staff.id,
        })
        .returning({ id: wristbands.id });
      return row?.id ?? "";
    });

    revalidatePath("/wristbands");
    return { ok: true, data: { id } };
  } catch (err) {
    logger.error({ err, venueEventId: d.venueEventId }, "upsertWristbandShipping failed");
    return { ok: false, error: "Couldn't save shipping details." };
  }
}
