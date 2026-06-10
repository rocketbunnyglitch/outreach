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
import { db, withAuditContext } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { normaliseEmail } from "@/lib/send-safety";
import { and, eq, sql } from "drizzle-orm";
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
/**
 * Count the malformed suppression rows on the team -- rows whose
 * email column has display-name junk or otherwise fails the
 * "one '@', no whitespace, no angle brackets, no quotes" sanity
 * check. Read-only, safe to call from a preview surface.
 *
 * Background: pre-ff2246c, blockThreadSender stored the RAW From
 * header (e.g. '"Mike Smith" <mike@venue.com>') into the email
 * column. Those rows never match anything at send-time and are
 * cosmetic clutter. ff2246c stopped the bleeding; this counter +
 * the cleanup action below let admins clean up the historical
 * rows in a single click.
 *
 * Pattern: matches anything with a quote, less-than, greater-than,
 * or whitespace, OR anything that's NOT shaped like exactly one
 * non-empty local-part, one '@', one non-empty domain.
 */
export async function countMalformedSuppression(): Promise<{ count: number; sample: string[] }> {
  const ctx = await requireAdmin();
  try {
    const rows = await db.execute<{ email: string }>(sql`
      SELECT email
      FROM email_suppression
      WHERE team_id = ${ctx.staff.teamId}
        AND (
          email ~ E'[<>"\\n\\r\\t ]'
          OR email !~ '^[^@\s]+@[^@\s]+$'
        )
      ORDER BY created_at DESC
      LIMIT 5000
    `);
    const list = Array.isArray(rows)
      ? (rows as unknown as Array<{ email: string }>)
      : ((rows as unknown as { rows?: Array<{ email: string }> }).rows ?? []);
    return {
      count: list.length,
      sample: list.slice(0, 5).map((r) => r.email),
    };
  } catch (err) {
    logger.warn({ err }, "countMalformedSuppression failed");
    return { count: 0, sample: [] };
  }
}

/**
 * Delete every malformed suppression row on the team. Same pattern
 * as countMalformedSuppression; this is the destructive companion.
 *
 * Safe-by-construction: the WHERE clause only matches rows that
 * could never match a clean recipient at send time, so deleting
 * them can never unblock a sender. Effectively garbage collection.
 *
 * Returns the deletion count for the UI's success message.
 */
export async function cleanMalformedSuppression(): Promise<ActionResult<{ deleted: number }>> {
  const ctx = await requireAdmin();
  try {
    const result = await withAuditContext(ctx.staff.id, (tx) =>
      tx.execute<{ id: string }>(sql`
        DELETE FROM email_suppression
        WHERE team_id = ${ctx.staff.teamId}
          AND (
            email ~ E'[<>"\\n\\r\\t ]'
            OR email !~ '^[^@\s]+@[^@\s]+$'
          )
        RETURNING id
      `),
    );
    const rows = Array.isArray(result)
      ? (result as unknown as Array<{ id: string }>)
      : ((result as unknown as { rows?: Array<{ id: string }> }).rows ?? []);
    revalidatePath("/admin/suppression");
    return { ok: true, data: { deleted: rows.length } };
  } catch (err) {
    logger.error({ err }, "cleanMalformedSuppression failed");
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not clean suppression list.",
    };
  }
}
