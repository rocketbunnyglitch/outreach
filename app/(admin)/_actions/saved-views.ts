"use server";

/**
 * Saved view actions — list / create / delete / update.
 *
 * The picker UI calls these to manage per-staff named filter presets.
 * Views are scoped to (staff, surface, optional context_id) so the
 * dropdown only shows views relevant to the current page.
 */

import { staffViews } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import { logger } from "@/lib/logger";
import { and, asc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

export interface SavedView {
  id: string;
  name: string;
  params: Record<string, string>;
  sortOrder: number;
}

interface ActionResult<T = unknown> {
  ok: boolean;
  error?: string;
  data?: T;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidField = z.string().regex(uuidPattern);

const surfaceField = z
  .string()
  .min(1)
  .max(50)
  .regex(/^[a-z_]+$/, "Surface key must be lowercase + underscores");

// ---------------------------------------------------------------
// list
// ---------------------------------------------------------------
export async function listSavedViews(
  surface: string,
  contextId: string | null,
): Promise<SavedView[]> {
  const { staff } = await requireStaff();

  const surfaceParsed = surfaceField.safeParse(surface);
  if (!surfaceParsed.success) return [];

  const ctxClause =
    contextId == null ? isNull(staffViews.contextId) : eq(staffViews.contextId, contextId);

  const rows = await db
    .select({
      id: staffViews.id,
      name: staffViews.name,
      params: staffViews.params,
      sortOrder: staffViews.sortOrder,
    })
    .from(staffViews)
    .where(
      and(eq(staffViews.staffId, staff.id), eq(staffViews.surface, surfaceParsed.data), ctxClause),
    )
    .orderBy(asc(staffViews.sortOrder), asc(staffViews.name));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    params: (r.params ?? {}) as Record<string, string>,
    sortOrder: r.sortOrder,
  }));
}

// ---------------------------------------------------------------
// save (insert or upsert by name)
// ---------------------------------------------------------------
const saveSchema = z.object({
  surface: surfaceField,
  contextId: uuidField.optional().nullable(),
  name: z.string().min(1).max(80),
  paramsJson: z.string().max(2000),
  revalidate: z.string().optional(),
});

export async function saveCurrentView(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();

  const parsed = saveSchema.safeParse({
    surface: formData.get("surface"),
    contextId: formData.get("contextId") || null,
    name: formData.get("name"),
    paramsJson: formData.get("paramsJson"),
    revalidate: formData.get("revalidate"),
  });
  if (!parsed.success) return { ok: false, error: "Invalid payload." };

  let params: Record<string, string>;
  try {
    const obj = JSON.parse(parsed.data.paramsJson);
    if (typeof obj !== "object" || obj == null || Array.isArray(obj)) {
      throw new Error("not object");
    }
    // Sanitize — keys must be strings, values too
    params = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof k === "string" && typeof v === "string") params[k] = v;
    }
  } catch {
    return { ok: false, error: "Couldn't parse view params." };
  }

  try {
    const id = await withAuditContext(staff.id, async (tx) => {
      const [row] = await tx
        .insert(staffViews)
        .values({
          staffId: staff.id,
          surface: parsed.data.surface,
          contextId: parsed.data.contextId ?? null,
          name: parsed.data.name.trim(),
          params,
        })
        .onConflictDoUpdate({
          target: [staffViews.staffId, staffViews.surface, staffViews.contextId, staffViews.name],
          set: {
            params,
            updatedAt: new Date(),
          },
        })
        .returning({ id: staffViews.id });
      return row?.id ?? "";
    });

    if (parsed.data.revalidate) revalidatePath(parsed.data.revalidate);
    return { ok: true, data: { id } };
  } catch (err) {
    logger.error({ err }, "saveCurrentView failed");
    return { ok: false, error: "Couldn't save view." };
  }
}

// ---------------------------------------------------------------
// delete
// ---------------------------------------------------------------
const deleteSchema = z.object({
  viewId: uuidField,
  revalidate: z.string().optional(),
});

export async function deleteSavedView(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ deleted: boolean }>> {
  const { staff } = await requireStaff();

  const parsed = deleteSchema.safeParse({
    viewId: formData.get("viewId"),
    revalidate: formData.get("revalidate"),
  });
  if (!parsed.success) return { ok: false, error: "Invalid payload." };

  try {
    const result = await withAuditContext(staff.id, async (tx) =>
      tx
        .delete(staffViews)
        .where(and(eq(staffViews.id, parsed.data.viewId), eq(staffViews.staffId, staff.id)))
        .returning({ id: staffViews.id }),
    );
    if (parsed.data.revalidate) revalidatePath(parsed.data.revalidate);
    return { ok: true, data: { deleted: result.length > 0 } };
  } catch (err) {
    logger.error({ err }, "deleteSavedView failed");
    return { ok: false, error: "Couldn't delete view." };
  }
}
