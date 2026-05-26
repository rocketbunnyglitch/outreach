"use server";

/**
 * Task server actions.
 *
 * Create / update / mark-complete / cancel. All mutations run through
 * `withAuditContext` so audit_log captures who did what.
 *
 * The `version` column gives optimistic-concurrency: if two staff edit
 * the same task simultaneously, the second write will detect the version
 * mismatch and surface "stale" to the user.
 */

import { tasks } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { withAuditContext } from "@/lib/db";
import { type ActionResult, formToObject } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import {
  type TaskCompleteInput,
  type TaskCreateInput,
  type TaskUpdateInput,
  taskCompleteSchema,
  taskCreateSchema,
  taskUpdateSchema,
} from "@/lib/validation/tasks";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { DatabaseError } from "pg";

function wrapDbError(err: unknown, action: string): ActionResult<never> {
  const dbErr = err as DatabaseError;
  logger.error({ err, action }, "task action failed");
  if (dbErr?.code === "23503") {
    return { ok: false, error: "Referenced staff or target not found." };
  }
  return { ok: false, error: "Unexpected database error. See server logs." };
}

// === Create ===

export async function createTask(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = taskCreateSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const input: TaskCreateInput = parsed.data;

  try {
    const id = await withAuditContext(staff.id, async (tx) => {
      const [row] = await tx
        .insert(tasks)
        .values({
          title: input.title,
          description: input.description ?? "",
          source: "manual",
          status: "pending",
          targetType: input.targetType,
          targetId: input.targetId ?? null,
          assignedStaffId: input.assignedStaffId ?? null,
          dueAt: input.dueAt ?? null,
          slaThresholdMinutes: input.slaThresholdMinutes ?? null,
        })
        .returning({ id: tasks.id });
      return row?.id ?? "";
    });

    revalidatePath("/tasks");
    revalidatePath("/");
    redirect(`/tasks/${id}`);
  } catch (err) {
    // redirect() throws by design — propagate it
    if (err instanceof Error && err.message === "NEXT_REDIRECT") throw err;
    return wrapDbError(err, "createTask");
  }
}

// === Update ===

export async function updateTask(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = taskUpdateSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const input: TaskUpdateInput = parsed.data;

  try {
    const result = await withAuditContext(staff.id, async (tx) => {
      const completedAt = input.status === "completed" ? new Date() : null;
      const updated = await tx
        .update(tasks)
        .set({
          title: input.title,
          description: input.description ?? "",
          status: input.status,
          assignedStaffId: input.assignedStaffId ?? null,
          dueAt: input.dueAt ?? null,
          slaThresholdMinutes: input.slaThresholdMinutes ?? null,
          completedAt,
        })
        .where(and(eq(tasks.id, input.id), eq(tasks.version, input.version)))
        .returning({ id: tasks.id });
      return updated.length === 1;
    });

    if (!result) {
      return {
        ok: false,
        error: "This task was modified by someone else. Refresh and try again.",
      };
    }

    revalidatePath("/tasks");
    revalidatePath(`/tasks/${input.id}`);
    revalidatePath("/");
    return { ok: true, data: { id: input.id } };
  } catch (err) {
    return wrapDbError(err, "updateTask");
  }
}

// === Mark complete (single-click action) ===

export async function completeTask(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = taskCompleteSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return { ok: false, error: "Validation failed." };
  }
  const input: TaskCompleteInput = parsed.data;

  try {
    const result = await withAuditContext(staff.id, async (tx) => {
      const updated = await tx
        .update(tasks)
        .set({
          status: "completed",
          completedAt: new Date(),
        })
        .where(and(eq(tasks.id, input.id), eq(tasks.version, input.version)))
        .returning({ id: tasks.id });
      return updated.length === 1;
    });

    if (!result) {
      return {
        ok: false,
        error: "This task was modified by someone else. Refresh and try again.",
      };
    }

    revalidatePath("/tasks");
    revalidatePath(`/tasks/${input.id}`);
    revalidatePath("/");
    return { ok: true, data: { id: input.id } };
  } catch (err) {
    return wrapDbError(err, "completeTask");
  }
}
