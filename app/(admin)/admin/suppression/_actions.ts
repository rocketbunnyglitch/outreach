"use server";

/**
 * /admin/suppression server actions — add, remove, list.
 *
 * Add inserts a new row with the operator-chosen reason. Email is
 * normalised (lower + trim) before insert; the unique index on
 * (team_id, lower(email)) guarantees one suppression per address.
 *
 * Remove is destructive — admin un-suppresses an address. Audit log
 * captures who removed it and when (via withAuditContext on the
 * delete).
 */

import { emailSuppression } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { withAuditContext } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { normaliseEmail } from "@/lib/send-safety";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_REASONS = new Set(["manual", "bounced", "complained", "unsubscribe"]);

export async function addSuppression(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireAdmin();
  const emailRaw = String(formData.get("email") ?? "");
  const reason = String(formData.get("reason") ?? "manual");
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const email = normaliseEmail(emailRaw);
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  if (!VALID_REASONS.has(reason)) {
    return { ok: false, error: "Invalid reason." };
  }

  try {
    const inserted = await withAuditContext(ctx.staff.id, (tx) =>
      tx
        .insert(emailSuppression)
        .values({
          teamId: ctx.staff.teamId,
          email,
          reason,
          notes,
          createdBy: ctx.staff.id,
        })
        .returning({ id: emailSuppression.id }),
    );
    revalidatePath("/admin/suppression");
    return { ok: true, data: { id: inserted[0]?.id ?? "" } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not add suppression.";
    logger.warn({ err, email, reason }, "addSuppression failed");
    if (msg.includes("email_suppression_team_email_unique")) {
      return { ok: false, error: "That address is already suppressed." };
    }
    return { ok: false, error: msg };
  }
}

export async function removeSuppression(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!UUID_RE.test(id)) return { ok: false, error: "Invalid id." };

  try {
    await withAuditContext(ctx.staff.id, (tx) =>
      tx
        .delete(emailSuppression)
        .where(and(eq(emailSuppression.id, id), eq(emailSuppression.teamId, ctx.staff.teamId))),
    );
    revalidatePath("/admin/suppression");
    return { ok: true, data: { id } };
  } catch (err) {
    logger.error({ err, id }, "removeSuppression failed");
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not remove suppression.",
    };
  }
}
