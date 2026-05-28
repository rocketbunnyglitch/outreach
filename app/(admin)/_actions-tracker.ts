"use server";

/**
 * Tracker dashboard inline-edit actions.
 *
 * Three operations the operator can do directly from the row:
 *   - Reassign (change lead_staff_id)
 *   - Edit dashboard note (free text)
 *   - Change city_campaign status pill (planning/active/confirmed/cancelled)
 *
 * Each writes through withAuditContext so audit log captures who changed
 * what on each city × campaign × day.
 */

import { events, cityCampaigns, staffMembers } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const uuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

const reassignSchema = z.object({
  cityCampaignId: uuidSchema,
  leadStaffId: z.union([z.literal("").transform(() => null), uuidSchema]).nullable(),
});

export async function reassignCityCampaign(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = reassignSchema.safeParse({
    cityCampaignId: String(formData.get("cityCampaignId") ?? ""),
    leadStaffId: formData.get("leadStaffId") ?? "",
  });
  if (!parsed.success) return { ok: false, error: "Invalid payload." };
  const { cityCampaignId, leadStaffId } = parsed.data;

  // Verify staffer exists + active when set
  if (leadStaffId) {
    const exists = await db
      .select({ id: staffMembers.id })
      .from(staffMembers)
      .where(and(eq(staffMembers.id, leadStaffId), eq(staffMembers.status, "active")))
      .limit(1);
    if (!exists[0]) return { ok: false, error: "Staffer not found or inactive." };
  }

  try {
    await withAuditContext(staff.id, async (tx) => {
      await tx
        .update(cityCampaigns)
        .set({ leadStaffId, updatedBy: staff.id })
        .where(eq(cityCampaigns.id, cityCampaignId));
    });
    revalidatePath("/");
    return { ok: true, data: { id: cityCampaignId } };
  } catch (err) {
    logger.error({ err }, "reassignCityCampaign failed");
    return { ok: false, error: "Reassign failed." };
  }
}

const noteSchema = z.object({
  cityCampaignId: uuidSchema,
  note: z.string().max(500),
});

export async function updateDashboardNote(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = noteSchema.safeParse({
    cityCampaignId: String(formData.get("cityCampaignId") ?? ""),
    note: String(formData.get("note") ?? ""),
  });
  if (!parsed.success) return { ok: false, error: "Invalid note." };

  try {
    await withAuditContext(staff.id, async (tx) => {
      await tx
        .update(cityCampaigns)
        .set({
          dashboardNote: parsed.data.note || null,
          updatedBy: staff.id,
        })
        .where(eq(cityCampaigns.id, parsed.data.cityCampaignId));
    });
    revalidatePath("/");
    return { ok: true, data: { id: parsed.data.cityCampaignId } };
  } catch (err) {
    logger.error({ err }, "updateDashboardNote failed");
    return { ok: false, error: "Note save failed." };
  }
}

const statusSchema = z.object({
  cityCampaignId: uuidSchema,
  status: z.enum(["planning", "active", "confirmed", "cancelled"]),
});

export async function updateCityCampaignStatus(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = statusSchema.safeParse({
    cityCampaignId: String(formData.get("cityCampaignId") ?? ""),
    status: String(formData.get("status") ?? ""),
  });
  if (!parsed.success) return { ok: false, error: "Invalid status." };

  try {
    await withAuditContext(staff.id, async (tx) => {
      await tx
        .update(cityCampaigns)
        .set({ status: parsed.data.status, updatedBy: staff.id })
        .where(eq(cityCampaigns.id, parsed.data.cityCampaignId));
    });
    revalidatePath("/");
    return { ok: true, data: { id: parsed.data.cityCampaignId } };
  } catch (err) {
    logger.error({ err }, "updateCityCampaignStatus failed");
    return { ok: false, error: "Status update failed." };
  }
}

// =========================================================================
// updateEventStatus — per-crawl status override on the tracker
// =========================================================================
//
// Operators flagged (session 12) that the status override should also
// apply to the expanded crawl rows under a city, not just the city row.
// Each crawl is an `events` row with its own eventStatus.

const eventStatusSchema = z.object({
  eventId: uuidSchema,
  status: z.enum(["planned", "confirmed", "contract_signed", "completed", "cancelled"]),
});

export async function updateEventStatus(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = eventStatusSchema.safeParse({
    eventId: String(formData.get("eventId") ?? ""),
    status: String(formData.get("status") ?? ""),
  });
  if (!parsed.success) return { ok: false, error: "Invalid status." };

  try {
    await withAuditContext(staff.id, async (tx) => {
      await tx
        .update(events)
        .set({ status: parsed.data.status, updatedBy: staff.id })
        .where(eq(events.id, parsed.data.eventId));
    });
    revalidatePath("/");
    return { ok: true, data: { id: parsed.data.eventId } };
  } catch (err) {
    logger.error({ err, eventId: parsed.data.eventId }, "updateEventStatus failed");
    return { ok: false, error: "Status update failed." };
  }
}

const prioritySchema = z.object({
  cityCampaignId: uuidSchema,
  priority: z.coerce.number().int().min(1).max(10),
});

/** Inline-edit the city-campaign priority (1 = highest .. 10 = lowest). */
export async function updateCityCampaignPriority(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = prioritySchema.safeParse({
    cityCampaignId: String(formData.get("cityCampaignId") ?? ""),
    priority: formData.get("priority") ?? "",
  });
  if (!parsed.success) return { ok: false, error: "Priority must be 1-10." };
  const { cityCampaignId, priority } = parsed.data;
  try {
    await withAuditContext(staff.id, async (tx) => {
      await tx
        .update(cityCampaigns)
        .set({ priority, updatedBy: staff.id })
        .where(eq(cityCampaigns.id, cityCampaignId));
    });
    revalidatePath("/");
    return { ok: true, data: { id: cityCampaignId } };
  } catch (err) {
    logger.error({ err }, "updateCityCampaignPriority failed");
    return { ok: false, error: "Priority update failed." };
  }
}
