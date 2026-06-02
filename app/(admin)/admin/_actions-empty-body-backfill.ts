"use server";

/**
 * Admin -> empty-body backfill action.
 *
 * Surface for repairing the historical empty-body bug (fixed at
 * the ingest layer in commit 38b15f6). Operators trigger this
 * post-fix to refill the body columns of inbound messages that
 * silently dropped their HTML/text content because Gmail returned
 * the body via attachmentId and the old extractor skipped that
 * path.
 *
 * Per-run cap: 200 (lib default). Operators rerun until
 * totalCandidates hits 0. Each click is one batch.
 *
 * Admin-only -- this scans + mutates rows across the team's
 * messages; gate accordingly.
 */

import { hasMinimumRole, requireStaff } from "@/lib/auth";
import { backfillEmptyBodies } from "@/lib/empty-body-backfill";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { revalidatePath } from "next/cache";

export async function runEmptyBodyBackfill(): Promise<
  ActionResult<{
    totalCandidates: number;
    scanned: number;
    repaired: number;
    stillEmpty: number;
    errors: number;
  }>
> {
  const { staff } = await requireStaff();
  if (!hasMinimumRole(staff, "admin")) {
    return { ok: false, error: "Admin role required." };
  }

  try {
    const result = await backfillEmptyBodies({ teamId: staff.teamId });
    // Inbox views are the immediate consumer of repaired body text;
    // also revalidate the admin page so the operator sees the post-
    // run candidate count.
    revalidatePath("/admin");
    revalidatePath("/inbox");
    logger.info({ staffId: staff.id, ...result }, "admin empty-body backfill complete");
    return { ok: true, data: result };
  } catch (err) {
    logger.error({ err }, "admin empty-body backfill failed");
    return { ok: false, error: "Empty-body backfill failed. See server logs." };
  }
}

/**
 * Snapshot count of inbound messages with empty body fields on the
 * caller's team. Used by /admin to render the "X to repair" starting
 * number on the EmptyBodyBackfillPanel. Cheap aggregate; mirrors the
 * lib's selection criteria so the count matches the backfill's
 * actual scope.
 */
export async function getEmptyBodyCount(): Promise<number> {
  const { staff } = await requireStaff();
  if (!hasMinimumRole(staff, "admin")) return 0;
  const { db } = await import("@/lib/db");
  const { sql } = await import("drizzle-orm");
  const rows = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n
    FROM email_messages m
    JOIN email_threads t ON t.id = m.thread_id
    JOIN connected_accounts ca ON ca.id = m.staff_outreach_email_id
    WHERE ca.team_id = ${staff.teamId}
      AND ca.status = 'connected'
      AND ca.gmail_oauth_refresh_token IS NOT NULL
      AND t.deleted_at IS NULL
      AND m.direction = 'inbound'
      AND (m.body_text = '' OR m.body_text IS NULL)
      AND m.body_html IS NULL
  `);
  const list = Array.isArray(rows)
    ? (rows as unknown as Array<{ n: number }>)
    : ((rows as unknown as { rows: Array<{ n: number }> }).rows ?? []);
  return Number(list[0]?.n ?? 0);
}
