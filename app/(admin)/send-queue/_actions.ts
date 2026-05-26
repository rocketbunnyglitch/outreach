"use server";

/**
 * Bulk send queue action.
 *
 * Operator selects N venues (already filtered to ones with emails),
 * picks a template + brand + time window, clicks "Queue all". This
 * action:
 *
 *   1. Validates the operator has a connected inbox for the brand
 *   2. Verifies they're at Phase 2+ on the brand (else: error)
 *   3. Computes the schedule via lib/send-spacing
 *   4. Inserts N scheduled_sends rows with status='pending'
 *   5. Returns the batch_id so the operator can view/cancel later
 *
 * The actual sending is the worker's job (lib/send-worker.ts), polled
 * every minute. Worker honors per-inbox caps live — if the queue tries
 * to push 30 sends but the throttle caps at 25, the last 5 stay
 * pending until tomorrow's window.
 */

import { emailTemplates, scheduledSends, staffOutreachEmails, venues } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { listOutreachBrands } from "@/lib/brand-context";
import { db, withAuditContext } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { phaseCapability } from "@/lib/outreach-phase";
import { computeSendSchedule } from "@/lib/send-spacing";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const uuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

const queueBulkSchema = z.object({
  outreachBrandId: uuidSchema,
  emailTemplateId: uuidSchema,
  venueIds: z.string().transform((s) =>
    s
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean),
  ),
  /** ISO datetime — when the first send may go out. */
  windowStart: z.string().datetime(),
  /** ISO datetime — when the last send must go out by. */
  windowEnd: z.string().datetime(),
  /** Optional batch label, free-text. */
  batchLabel: z.string().max(200).optional(),
});

export async function queueBulkSend(
  _prev: unknown,
  formData: FormData,
): Promise<
  ActionResult<{
    batchId: string;
    count: number;
    firstScheduledFor: string;
    lastScheduledFor: string;
    avgGapSeconds: number;
  }>
> {
  const { staff } = await requireStaff();

  // formToObject + zod won't handle venueIds correctly — pull manually
  const raw = {
    outreachBrandId: String(formData.get("outreachBrandId") ?? ""),
    emailTemplateId: String(formData.get("emailTemplateId") ?? ""),
    venueIds: String(formData.get("venueIds") ?? ""),
    windowStart: String(formData.get("windowStart") ?? ""),
    windowEnd: String(formData.get("windowEnd") ?? ""),
    batchLabel: String(formData.get("batchLabel") ?? ""),
  };
  const parsed = queueBulkSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const input = parsed.data;

  // Each venue ID must be a real UUID
  const venueIdParse = z.array(uuidSchema).min(1).max(200).safeParse(input.venueIds);
  if (!venueIdParse.success) {
    return { ok: false, error: "Need at least 1 venue ID (max 200)." };
  }
  const venueIds = venueIdParse.data;

  // Brand → phase gate
  const brands = await listOutreachBrands();
  const brand = brands.find((b) => b.id === input.outreachBrandId);
  if (!brand) return { ok: false, error: "Outreach brand not found." };
  const phase = (brand.outreachPhase as 1 | 2 | 3 | 4) ?? 1;
  if (!phaseCapability.canBulkQueue(phase)) {
    return {
      ok: false,
      error: `Bulk queue requires Phase 2 (Controlled send). '${brand.displayName}' is at Phase ${phase}. Raise the phase in Brands → Edit when ready.`,
    };
  }

  // Inbox lookup
  const inbox = await db
    .select()
    .from(staffOutreachEmails)
    .where(
      and(
        eq(staffOutreachEmails.staffMemberId, staff.id),
        eq(staffOutreachEmails.outreachBrandId, input.outreachBrandId),
        eq(staffOutreachEmails.status, "connected"),
      ),
    )
    .limit(1)
    .then((r) => r[0]);

  if (!inbox) {
    return {
      ok: false,
      error:
        "You don't have a connected inbox for this brand. Connect in Settings → Inboxes first.",
    };
  }

  // Template lookup
  const template = await db
    .select()
    .from(emailTemplates)
    .where(
      and(
        eq(emailTemplates.id, input.emailTemplateId),
        eq(emailTemplates.outreachBrandId, input.outreachBrandId),
      ),
    )
    .limit(1)
    .then((r) => r[0]);
  if (!template) return { ok: false, error: "Template not found for this brand." };

  // Venues lookup + email check
  const venueRows = await db
    .select({ id: venues.id, name: venues.name, email: venues.email, dnc: venues.doNotContact })
    .from(venues)
    .where(inArray(venues.id, venueIds));

  const valid = venueRows.filter((v) => v.email && !v.dnc);
  const skipped = venueRows.length - valid.length;
  if (valid.length === 0) {
    return {
      ok: false,
      error: "None of the selected venues have a usable email (missing or DNC).",
    };
  }

  // Compute schedule
  const windowStart = new Date(input.windowStart);
  const windowEnd = new Date(input.windowEnd);
  let schedule: ReturnType<typeof computeSendSchedule>;
  try {
    schedule = computeSendSchedule({
      count: valid.length,
      windowStart,
      windowEnd,
      minSpacingSeconds: inbox.minSecondsBetweenSends,
      // Random jitter equal to ~25% of spacing — natural-looking without
      // shoving sends all to one end of the window
      jitterSeconds: Math.round(inbox.minSecondsBetweenSends * 0.25),
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Scheduling failed.",
    };
  }

  // Generate a batch ID via crypto.randomUUID()
  const batchId = crypto.randomUUID();
  const batchLabel = input.batchLabel || `Batch ${new Date().toLocaleDateString()}`;

  try {
    await withAuditContext(staff.id, async (tx) => {
      await tx.insert(scheduledSends).values(
        valid.map((venue, i) => ({
          staffMemberId: staff.id,
          staffOutreachEmailId: inbox.id,
          outreachBrandId: input.outreachBrandId,
          venueId: venue.id,
          recipientEmail: venue.email as string,
          emailTemplateId: template.id,
          status: "pending" as const,
          scheduledFor: schedule.scheduledTimestamps[i] ?? windowEnd,
          windowStart,
          windowEnd,
          batchId,
          batchLabel,
          createdBy: staff.id,
          updatedBy: staff.id,
        })),
      );
    });

    logger.info(
      {
        batchId,
        count: valid.length,
        skipped,
        staffId: staff.id,
        brandId: input.outreachBrandId,
      },
      "bulk send queued",
    );

    revalidatePath("/send-queue");

    const firstTs = schedule.scheduledTimestamps[0];
    const lastTs = schedule.scheduledTimestamps[schedule.scheduledTimestamps.length - 1];
    return {
      ok: true,
      data: {
        batchId,
        count: valid.length,
        firstScheduledFor: (firstTs ?? windowStart).toISOString(),
        lastScheduledFor: (lastTs ?? windowEnd).toISOString(),
        avgGapSeconds: schedule.avgGapSeconds,
      },
    };
  } catch (err) {
    logger.error({ err }, "queueBulkSend insert failed");
    return { ok: false, error: "Queue insert failed. See server logs." };
  }
}

export async function cancelScheduledSend(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing id." };

  try {
    const result = await withAuditContext(staff.id, async (tx) => {
      const updated = await tx
        .update(scheduledSends)
        .set({ status: "canceled", updatedBy: staff.id })
        .where(and(eq(scheduledSends.id, id), eq(scheduledSends.status, "pending")))
        .returning({ id: scheduledSends.id });
      return updated[0]?.id ?? null;
    });
    if (!result) {
      return { ok: false, error: "Send not found or already in progress." };
    }
    revalidatePath("/send-queue");
    return { ok: true, data: { id: result } };
  } catch (err) {
    logger.error({ err }, "cancelScheduledSend failed");
    return { ok: false, error: "Cancel failed." };
  }
}

export async function cancelScheduledBatch(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ canceled: number }>> {
  const { staff } = await requireStaff();
  const batchId = String(formData.get("batchId") ?? "");
  if (!batchId) return { ok: false, error: "Missing batchId." };

  try {
    const canceled = await withAuditContext(staff.id, async (tx) => {
      const updated = await tx
        .update(scheduledSends)
        .set({ status: "canceled", updatedBy: staff.id })
        .where(and(eq(scheduledSends.batchId, batchId), eq(scheduledSends.status, "pending")))
        .returning({ id: scheduledSends.id });
      return updated.length;
    });
    revalidatePath("/send-queue");
    return { ok: true, data: { canceled } };
  } catch (err) {
    logger.error({ err }, "cancelScheduledBatch failed");
    return { ok: false, error: "Batch cancel failed." };
  }
}
