"use server";

/**
 * Crawl-deliverable mutations — flip status, set notes, assign.
 *
 * Each action is a small upsert: deliverables rows are created
 * lazily the first time an operator interacts. Until then the
 * UI shows the implicit 'pending' default from the loader.
 */

import { crawlDeliverables } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { withAuditContext } from "@/lib/db";
import { logger } from "@/lib/logger";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

type DeliverableType =
  | "social_media_graphics"
  | "staff_sheet"
  | "participant_poster"
  | "wristbands"
  | "week_of_confirmation";

type DeliverableStatus = "pending" | "done" | "n_a";

interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Upsert a deliverable for (venue_event, type). If the row doesn't
 * exist yet, create it with the given status. If it does, update
 * status + audit columns. Optional notes overwrite the existing
 * value (pass null to clear).
 */
export async function setDeliverableStatus(input: {
  venueEventId: string;
  deliverableType: DeliverableType;
  status: DeliverableStatus;
  notes?: string | null;
}): Promise<ActionResult> {
  const { staff } = await requireStaff();
  try {
    await withAuditContext(staff.id, async (tx) => {
      const existing = await tx
        .select({ id: crawlDeliverables.id })
        .from(crawlDeliverables)
        .where(
          and(
            eq(crawlDeliverables.venueEventId, input.venueEventId),
            eq(crawlDeliverables.deliverableType, input.deliverableType),
          ),
        )
        .limit(1);
      if (existing.length > 0) {
        const id = existing[0]?.id;
        if (!id) return;
        await tx
          .update(crawlDeliverables)
          .set({
            status: input.status,
            ...(input.notes !== undefined ? { notes: input.notes } : {}),
            updatedAt: new Date(),
            updatedBy: staff.id,
          })
          .where(eq(crawlDeliverables.id, id));
      } else {
        await tx.insert(crawlDeliverables).values({
          venueEventId: input.venueEventId,
          deliverableType: input.deliverableType,
          status: input.status,
          notes: input.notes ?? null,
          createdBy: staff.id,
          updatedBy: staff.id,
        });
      }
    });
    revalidatePath("/crawl-management");
    return { ok: true };
  } catch (err) {
    logger.error({ err, input }, "[crawl-deliverables] set status failed");
    return { ok: false, error: "Couldn't save." };
  }
}

/**
 * Mark every deliverable for a venue_event as done at once. Useful
 * for "all set for this venue" one-click closeouts. Creates any
 * missing rows on the fly.
 */
export async function markAllDeliverablesDone(input: {
  venueEventId: string;
}): Promise<ActionResult> {
  const { staff } = await requireStaff();
  const types: DeliverableType[] = [
    "social_media_graphics",
    "staff_sheet",
    "participant_poster",
    "wristbands",
    "week_of_confirmation",
  ];
  try {
    await withAuditContext(staff.id, async (tx) => {
      for (const t of types) {
        const existing = await tx
          .select({ id: crawlDeliverables.id })
          .from(crawlDeliverables)
          .where(
            and(
              eq(crawlDeliverables.venueEventId, input.venueEventId),
              eq(crawlDeliverables.deliverableType, t),
            ),
          )
          .limit(1);
        if (existing.length > 0) {
          const id = existing[0]?.id;
          if (!id) continue;
          await tx
            .update(crawlDeliverables)
            .set({ status: "done", updatedAt: new Date(), updatedBy: staff.id })
            .where(eq(crawlDeliverables.id, id));
        } else {
          await tx.insert(crawlDeliverables).values({
            venueEventId: input.venueEventId,
            deliverableType: t,
            status: "done",
            createdBy: staff.id,
            updatedBy: staff.id,
          });
        }
      }
    });
    revalidatePath("/crawl-management");
    return { ok: true };
  } catch (err) {
    logger.error({ err, input }, "[crawl-deliverables] mark all done failed");
    return { ok: false, error: "Couldn't save." };
  }
}
