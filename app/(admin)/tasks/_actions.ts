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
import { requireAdmin, requireStaff } from "@/lib/auth";
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
import { and, eq, inArray, lt, sql } from "drizzle-orm";
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
  const raw = formToObject(formData);
  const parsed = taskUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    // Log the raw FormData and the zod error so we can see what's
    // failing parse if a user reports "Validation failed" with no
    // visible reason. The form's defaultValues should always produce
    // valid input; a parse failure here usually means a stale form
    // (e.g. version column drifted) or a corrupted hidden input.
    logger.warn(
      { staffId: staff.id, raw, issues: parsed.error.flatten() },
      "updateTask: validation failed",
    );
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
          version: sql`${tasks.version} + 1`,
        })
        .where(and(eq(tasks.id, input.id), eq(tasks.version, input.version)))
        .returning({ id: tasks.id });
      return updated.length === 1;
    });

    if (!result) {
      // Optimistic-lock miss — most common reason a save "looks like
      // it didn't take" is that the version in the form drifted out of
      // sync with the DB (someone else edited, or a prior save's
      // revalidation didn't propagate to the form's hidden input).
      logger.info(
        { staffId: staff.id, taskId: input.id, formVersion: input.version },
        "updateTask: optimistic lock miss",
      );
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
          version: sql`${tasks.version} + 1`,
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

// === Bulk clear (admin only) ===

/** The non-manual task sources an admin can sweep in bulk. We never
 *  bulk-touch `manual` tasks (a human typed those). `smart_note` =
 *  the AI inbox promise-extractor (the pre-campaign email backlog the
 *  operator wants gone); `auto` = cascade/graphics tasks. */
const CLEARABLE_TASK_SOURCES = ["auto", "smart_note"] as const;

/**
 * Cancel (not delete) pending auto-generated tasks in bulk. Terminal
 * state is `cancelled` so the rows + audit history survive -- `completed`
 * would wrongly imply the work was done. Admin only. Optional
 * `createdBefore` lets the operator clear only the old backlog.
 */
export async function bulkClearTasks(input: {
  sources?: Array<(typeof CLEARABLE_TASK_SOURCES)[number]>;
  createdBefore?: string;
}): Promise<ActionResult<{ cleared: number }>> {
  const { staff } = await requireAdmin();
  const sources =
    input.sources && input.sources.length > 0 ? input.sources : [...CLEARABLE_TASK_SOURCES];
  const conds = [eq(tasks.status, "pending"), inArray(tasks.source, sources)];
  if (input.createdBefore) {
    const cutoff = new Date(input.createdBefore);
    if (!Number.isNaN(cutoff.getTime())) conds.push(lt(tasks.createdAt, cutoff));
  }
  try {
    const cleared = await withAuditContext(staff.id, async (tx) => {
      const rows = await tx
        .update(tasks)
        .set({
          status: "cancelled",
          completedAt: new Date(),
          version: sql`${tasks.version} + 1`,
        })
        .where(and(...conds))
        .returning({ id: tasks.id });
      return rows.length;
    });
    revalidatePath("/tasks");
    revalidatePath("/");
    return { ok: true, data: { cleared } };
  } catch (err) {
    return wrapDbError(err, "bulkClearTasks");
  }
}

// === Delete ===

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Hard-delete a task. Any staff (operator request 2026-06-10 -- was admin
 *  only). The deletion is still attributed via the audit context. */
export async function deleteTask(id: string): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  if (!uuidRe.test(id)) return { ok: false, error: "Bad task id." };
  try {
    await withAuditContext(staff.id, async (tx) => {
      await tx.delete(tasks).where(eq(tasks.id, id));
    });
    revalidatePath("/tasks");
    revalidatePath("/");
    return { ok: true, data: { id } };
  } catch (err) {
    return wrapDbError(err, "deleteTask");
  }
}
