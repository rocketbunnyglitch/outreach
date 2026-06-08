"use server";

/**
 * Snippets / text-expander CRUD (Tier-2).
 *
 * Team-scoped reusable body fragments. Admin manages them on /admin/snippets;
 * the composer lists the team's snippets and inserts one (merge-rendered) when
 * the operator types a ";trigger". Snippets touch ONLY the composer editor --
 * never the send path or the send-safety boundary.
 */

import { snippets } from "@/db/schema";
import { requireAdmin, requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

export interface SnippetRow {
  id: string;
  trigger: string;
  label: string;
  body: string;
  updatedAt: string;
}

/** A trigger token: letters, digits, underscore, hyphen. No ";" or spaces. */
const triggerSchema = z
  .string()
  .trim()
  .min(1, "Trigger is required.")
  .max(40)
  .regex(
    /^[a-zA-Z0-9_-]+$/,
    "Trigger can only contain letters, numbers, _ and - (no spaces or ;).",
  );

const upsertSchema = z.object({
  trigger: triggerSchema,
  label: z.string().trim().min(1, "Label is required.").max(120),
  body: z.string().trim().min(1, "Body is required.").max(8000),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Active snippets for a team, trigger-ordered. Shared by the admin list +
 *  the composer. */
async function selectTeamSnippets(teamId: string): Promise<SnippetRow[]> {
  const rows = await db
    .select({
      id: snippets.id,
      trigger: snippets.trigger,
      label: snippets.label,
      body: snippets.body,
      updatedAt: snippets.updatedAt,
    })
    .from(snippets)
    .where(and(eq(snippets.teamId, teamId), isNull(snippets.archivedAt)))
    .orderBy(asc(snippets.trigger));
  return rows.map((r) => ({
    id: r.id,
    trigger: r.trigger,
    label: r.label,
    body: r.body,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/** Admin: list this team's snippets for the management page. */
export async function listSnippets(): Promise<SnippetRow[]> {
  const { staff } = await requireAdmin();
  if (!staff.teamId) return [];
  return selectTeamSnippets(staff.teamId);
}

/** Composer: list this team's snippets (any operator). */
export async function listTeamSnippets(): Promise<SnippetRow[]> {
  const { staff } = await requireStaff();
  if (!staff.teamId) return [];
  return selectTeamSnippets(staff.teamId);
}

/** True if the trigger is already used by another active snippet on the team
 *  (case-insensitive). */
async function triggerTaken(teamId: string, trigger: string, exceptId?: string): Promise<boolean> {
  const conds = [
    eq(snippets.teamId, teamId),
    isNull(snippets.archivedAt),
    sql`lower(${snippets.trigger}) = lower(${trigger})`,
  ];
  if (exceptId) conds.push(ne(snippets.id, exceptId));
  const [hit] = await db
    .select({ id: snippets.id })
    .from(snippets)
    .where(and(...conds))
    .limit(1);
  return Boolean(hit);
}

export async function createSnippet(input: {
  trigger: string;
  label: string;
  body: string;
}): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireAdmin();
  if (!staff.teamId) return { ok: false, error: "No team context." };
  const parsed = upsertSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid snippet." };
  }
  try {
    if (await triggerTaken(staff.teamId, parsed.data.trigger)) {
      return {
        ok: false,
        error: `A snippet with trigger ";${parsed.data.trigger}" already exists.`,
      };
    }
    const [row] = await db
      .insert(snippets)
      .values({
        teamId: staff.teamId,
        trigger: parsed.data.trigger,
        label: parsed.data.label,
        body: parsed.data.body,
        createdBy: staff.id,
        updatedBy: staff.id,
      })
      .returning({ id: snippets.id });
    revalidatePath("/admin/snippets");
    return { ok: true, data: { id: row?.id ?? "" } };
  } catch (err) {
    logger.error({ err }, "createSnippet failed");
    return { ok: false, error: "Couldn't create the snippet." };
  }
}

export async function updateSnippet(
  id: string,
  input: { trigger: string; label: string; body: string },
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireAdmin();
  if (!staff.teamId) return { ok: false, error: "No team context." };
  if (!UUID_RE.test(id)) return { ok: false, error: "Invalid snippet id." };
  const parsed = upsertSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid snippet." };
  }
  try {
    if (await triggerTaken(staff.teamId, parsed.data.trigger, id)) {
      return {
        ok: false,
        error: `A snippet with trigger ";${parsed.data.trigger}" already exists.`,
      };
    }
    const [row] = await db
      .update(snippets)
      .set({
        trigger: parsed.data.trigger,
        label: parsed.data.label,
        body: parsed.data.body,
        updatedBy: staff.id,
        updatedAt: new Date(),
      })
      // Scope to the team so an admin can't edit another team's snippet.
      .where(
        and(eq(snippets.id, id), eq(snippets.teamId, staff.teamId), isNull(snippets.archivedAt)),
      )
      .returning({ id: snippets.id });
    if (!row) return { ok: false, error: "Snippet not found." };
    revalidatePath("/admin/snippets");
    return { ok: true, data: { id: row.id } };
  } catch (err) {
    logger.error({ err, id }, "updateSnippet failed");
    return { ok: false, error: "Couldn't update the snippet." };
  }
}

export async function deleteSnippet(id: string): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireAdmin();
  if (!staff.teamId) return { ok: false, error: "No team context." };
  if (!UUID_RE.test(id)) return { ok: false, error: "Invalid snippet id." };
  try {
    // Soft delete (archived_at) per CLAUDE.md section 6.
    const [row] = await db
      .update(snippets)
      .set({ archivedAt: new Date(), updatedBy: staff.id, updatedAt: new Date() })
      .where(
        and(eq(snippets.id, id), eq(snippets.teamId, staff.teamId), isNull(snippets.archivedAt)),
      )
      .returning({ id: snippets.id });
    if (!row) return { ok: false, error: "Snippet not found." };
    revalidatePath("/admin/snippets");
    return { ok: true, data: { id: row.id } };
  } catch (err) {
    logger.error({ err, id }, "deleteSnippet failed");
    return { ok: false, error: "Couldn't delete the snippet." };
  }
}
