"use server";

/**
 * Calendar mutations: reschedule (drag-and-drop) + reassign.
 *
 * Both write through the standard withAuditContext path so the audit log
 * captures who moved which task and when. The optimistic-locking
 * version column on tasks prevents concurrent reschedules from
 * overwriting each other.
 *
 * Permission model (v1 — keep simple):
 *   - Any staffer can reschedule their OWN tasks
 *   - Any staffer can reschedule UNASSIGNED tasks (claiming them)
 *   - Reassign requires admin/lead role OR self-reassignment to claim
 *     an unassigned task
 *
 * Future tightening can layer in roles via lib/auth.requireStaff()
 * returning the role; for now staff.role is checked inline.
 */

import { staffMembers, tasks } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import { type ActionResult, formToObject } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const uuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

const rescheduleSchema = z.object({
  taskId: uuidSchema,
  dueAt: z.string().datetime(),
  version: z.coerce.number().int().min(1),
});

export async function rescheduleTask(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = rescheduleSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return { ok: false, error: "Invalid reschedule payload." };
  }
  const { taskId, dueAt, version } = parsed.data;

  try {
    // Permission check — load the task to see who owns it
    const existing = await db
      .select({
        id: tasks.id,
        assignedStaffId: tasks.assignedStaffId,
        version: tasks.version,
      })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1)
      .then((r) => r[0]);

    if (!existing) return { ok: false, error: "Task not found." };

    const staffRole = (staff as { role?: string }).role ?? "outreach";
    const isAdminOrLead = staffRole === "admin" || staffRole === "lead";
    const isOwner = existing.assignedStaffId === staff.id;
    const isUnassigned = !existing.assignedStaffId;

    if (!isAdminOrLead && !isOwner && !isUnassigned) {
      return {
        ok: false,
        error: "You can only reschedule your own tasks unless you're a lead or admin.",
      };
    }

    const result = await withAuditContext(staff.id, async (tx) => {
      const updated = await tx
        .update(tasks)
        .set({
          dueAt: new Date(dueAt),
          updatedBy: staff.id,
        })
        .where(and(eq(tasks.id, taskId), eq(tasks.version, version)))
        .returning({ id: tasks.id });
      return updated[0]?.id ?? null;
    });

    if (!result) {
      return {
        ok: false,
        error: "Task was modified by someone else. Reload the calendar and try again.",
      };
    }

    revalidatePath("/calendar");
    if (existing.assignedStaffId) revalidatePath(`/staff/${existing.assignedStaffId}/calendar`);
    return { ok: true, data: { id: result } };
  } catch (err) {
    logger.error({ err, taskId }, "rescheduleTask failed");
    return { ok: false, error: "Reschedule failed. See server logs." };
  }
}

const reassignSchema = z.object({
  taskId: uuidSchema,
  newAssignedStaffId: z.union([z.literal("").transform(() => null), uuidSchema]).nullable(),
  version: z.coerce.number().int().min(1),
});

export async function reassignTask(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = reassignSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return { ok: false, error: "Invalid reassign payload." };
  }
  const { taskId, newAssignedStaffId, version } = parsed.data;

  try {
    const existing = await db
      .select({
        id: tasks.id,
        assignedStaffId: tasks.assignedStaffId,
      })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1)
      .then((r) => r[0]);
    if (!existing) return { ok: false, error: "Task not found." };

    const staffRole = (staff as { role?: string }).role ?? "outreach";
    const isAdminOrLead = staffRole === "admin" || staffRole === "lead";
    const isUnassigned = !existing.assignedStaffId;
    const isClaim = isUnassigned && newAssignedStaffId === staff.id;

    if (!isAdminOrLead && !isClaim) {
      return {
        ok: false,
        error: "Only leads or admins can reassign tasks. You can claim unassigned tasks.",
      };
    }

    // If a target staffer is specified, verify they exist + are active
    if (newAssignedStaffId) {
      const exists = await db
        .select({ id: staffMembers.id })
        .from(staffMembers)
        .where(and(eq(staffMembers.id, newAssignedStaffId), eq(staffMembers.status, "active")))
        .limit(1);
      if (!exists[0]) {
        return { ok: false, error: "Target staffer not found or inactive." };
      }
    }

    const result = await withAuditContext(staff.id, async (tx) => {
      const updated = await tx
        .update(tasks)
        .set({
          assignedStaffId: newAssignedStaffId,
          updatedBy: staff.id,
        })
        .where(and(eq(tasks.id, taskId), eq(tasks.version, version)))
        .returning({ id: tasks.id });
      return updated[0]?.id ?? null;
    });

    if (!result) {
      return {
        ok: false,
        error: "Task was modified concurrently. Reload and try again.",
      };
    }

    revalidatePath("/calendar");
    return { ok: true, data: { id: result } };
  } catch (err) {
    logger.error({ err, taskId }, "reassignTask failed");
    return { ok: false, error: "Reassign failed. See server logs." };
  }
}
