"use server";

/**
 * Team-label CRUD. Creates, renames, and deletes labels in the
 * team's namespace. createTeamLabel also fans out to every connected
 * Gmail to keep both sides in sync.
 *
 * Permissions:
 *   - Create / rename: any team operator (requireStaff). Matches
 *     Gmail's behavior where any user can create labels in their own
 *     mailbox; here, labels are team-scoped so any operator
 *     contributing to the team should be able to add an organizing
 *     label on the fly.
 *   - Delete: admin-only (still requireAdmin). Deletion is
 *     destructive across the whole team's threads — keep that gated.
 */

import { requireAdmin, requireStaff } from "@/lib/auth";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { createTeamLabel, deleteTeamLabel, renameTeamLabel } from "@/lib/team-labels";
import { revalidatePath } from "next/cache";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COLORS = new Set([
  "emerald",
  "rose",
  "blue",
  "amber",
  "violet",
  "sky",
  "orange",
  "yellow",
  "zinc",
]);

export async function createTeamLabelAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireStaff();
  const name = String(formData.get("name") ?? "").trim();
  const colorRaw = String(formData.get("color") ?? "").trim();
  if (!name) return { ok: false, error: "Label name is required." };
  if (name.length > 200) return { ok: false, error: "Label name is too long." };
  const color = COLORS.has(colorRaw) ? colorRaw : null;

  try {
    const { id } = await createTeamLabel({
      teamId: ctx.staff.teamId,
      name,
      color,
      createdBy: ctx.staff.id,
    });
    revalidatePath("/admin/labels");
    revalidatePath("/inbox");
    return { ok: true, data: { id } };
  } catch (err) {
    // Most likely cause is the unique-index collision on (team_id, lower(name)).
    const msg = err instanceof Error ? err.message : "Could not create label.";
    logger.warn({ err, name }, "createTeamLabelAction failed");
    if (msg.includes("team_labels_team_name_unique")) {
      return { ok: false, error: "A label with that name already exists." };
    }
    return { ok: false, error: msg };
  }
}

export async function renameTeamLabelAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireStaff();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!UUID_RE.test(id)) return { ok: false, error: "Invalid label id." };
  if (!name) return { ok: false, error: "Label name is required." };

  try {
    await renameTeamLabel({ id, name, updatedBy: ctx.staff.id });
    revalidatePath("/admin/labels");
    revalidatePath("/inbox");
    return { ok: true, data: { id } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not rename label.";
    logger.warn({ err, id, name }, "renameTeamLabelAction failed");
    if (msg.includes("team_labels_team_name_unique")) {
      return { ok: false, error: "A label with that name already exists." };
    }
    return { ok: false, error: msg };
  }
}

export async function deleteTeamLabelAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!UUID_RE.test(id)) return { ok: false, error: "Invalid label id." };

  try {
    await deleteTeamLabel(id);
    revalidatePath("/admin/labels");
    revalidatePath("/inbox");
    return { ok: true, data: { id } };
  } catch (err) {
    logger.error({ err, id }, "deleteTeamLabelAction failed");
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not delete label.",
    };
  }
}
