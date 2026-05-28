"use server";

import { externalHostShipments } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { withAuditContext } from "@/lib/db";
import { logger } from "@/lib/logger";
import { revalidatePath } from "next/cache";
import { z } from "zod";

type ActionResult = { ok: true } | { ok: false; error: string };

const schema = z.object({
  externalHostId: z.string().uuid(),
  cityCampaignId: z.string().uuid(),
  status: z.enum(["pending", "ready_to_ship", "shipped", "delivered", "issue"]),
  trackingNumber: z.string().trim().max(120).optional(),
  wristbandCount: z.number().int().min(0).max(100000).optional(),
});

/**
 * Upsert the wristband shipment for an external host in a city-campaign
 * (one shipment covers all their crawls in that city). Keyed by the
 * (external_host_id, city_campaign_id) unique index.
 */
export async function setExternalHostShipment(input: unknown): Promise<ActionResult> {
  const { staff } = await requireStaff();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid shipment data." };
  const { externalHostId, cityCampaignId, status, trackingNumber, wristbandCount } = parsed.data;
  // Stamp shippedAt the first time it leaves us; clear if rolled back to pending.
  const shippedAt = status === "shipped" || status === "delivered" ? new Date() : null;
  const tracking = trackingNumber && trackingNumber.length > 0 ? trackingNumber : null;
  const count = typeof wristbandCount === "number" ? wristbandCount : null;

  try {
    await withAuditContext(staff.id, async (tx) => {
      await tx
        .insert(externalHostShipments)
        .values({
          externalHostId,
          cityCampaignId,
          status,
          trackingNumber: tracking,
          wristbandCount: count,
          shippedAt,
          createdBy: staff.id,
          updatedBy: staff.id,
        })
        .onConflictDoUpdate({
          target: [externalHostShipments.externalHostId, externalHostShipments.cityCampaignId],
          set: {
            status,
            trackingNumber: tracking,
            wristbandCount: count,
            shippedAt,
            updatedBy: staff.id,
          },
        });
    });
    revalidatePath("/crawl-matrix");
    return { ok: true };
  } catch (err) {
    logger.error({ err }, "setExternalHostShipment failed");
    return { ok: false, error: "Could not save shipment." };
  }
}
