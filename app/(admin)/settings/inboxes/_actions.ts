"use server";

import { connectedAccounts } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { pollOneInbox } from "@/lib/gmail-poll-worker";
import { logger } from "@/lib/logger";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

/**
 * Disconnect a Gmail inbox by NULL-ing the refresh token and flipping
 * status to 'disconnected'. We keep the row (rather than deleting) so
 * audit history + foreign keys from email_threads stay intact.
 *
 * Only the user who owns the connection can disconnect it. The
 * brand-reassign action that used to live here is gone — brand
 * scoping was removed from connected_accounts in the send-queue
 * decommission.
 */
export async function disconnectInbox(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing inbox id" };

  try {
    const result = await withAuditContext(staff.id, async (tx) => {
      const updated = await tx
        .update(connectedAccounts)
        .set({
          gmailOauthRefreshToken: null,
          gmailOauthScopes: null,
          status: "disconnected",
          updatedBy: staff.id,
        })
        .where(and(eq(connectedAccounts.id, id), eq(connectedAccounts.ownerUserId, staff.id)))
        .returning({ id: connectedAccounts.id });
      return updated[0]?.id;
    });

    if (!result) {
      return { ok: false, error: "Inbox not found or not yours to disconnect." };
    }

    revalidatePath("/settings/inboxes");
    return { ok: true, data: { id: result } };
  } catch (err) {
    logger.error({ err }, "disconnectInbox failed");
    return { ok: false, error: "Disconnect failed. See server logs." };
  }
}

/**
 * Resync a single connected inbox on demand. Bypasses the 5-min cron
 * cadence so the operator gets immediate feedback after connecting a
 * new account or troubleshooting a quiet inbox.
 *
 * Requires the caller to own the connection (same guard as disconnect).
 * Skips if the account is disconnected (no refresh token to use).
 *
 * Returns counts so the UI can render "ingested N messages, X new
 * threads" without an extra round-trip.
 */
export async function resyncInbox(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ messagesIngested: number; threadsCreated: number }>> {
  const { staff } = await requireStaff();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing inbox id" };

  // Load the connection + verify ownership + that it's still connected.
  const rows = await db
    .select({
      id: connectedAccounts.id,
      ownerUserId: connectedAccounts.ownerUserId,
      emailAddress: connectedAccounts.emailAddress,
      refreshToken: connectedAccounts.gmailOauthRefreshToken,
      lastHistoryId: connectedAccounts.gmailLastHistoryId,
      status: connectedAccounts.status,
    })
    .from(connectedAccounts)
    .where(eq(connectedAccounts.id, id))
    .limit(1);
  const inbox = rows[0];
  if (!inbox) return { ok: false, error: "Inbox not found." };
  if (inbox.ownerUserId !== staff.id) {
    return { ok: false, error: "You can only resync inboxes you own." };
  }
  if (!inbox.refreshToken || inbox.status !== "connected") {
    return {
      ok: false,
      error: "Inbox is disconnected — click Reconnect to re-authorize Gmail first.",
    };
  }

  try {
    const result = await pollOneInbox({
      id: inbox.id,
      refresh_token: inbox.refreshToken,
      last_history_id: inbox.lastHistoryId,
      email: inbox.emailAddress,
      staff_member_id: staff.id,
    });

    // Stamp gmail_last_polled_at so the cron's next ORDER BY skips
    // this account temporarily — same bookkeeping the drain does.
    // gmail_last_polled_at isn't mapped in the Drizzle schema; do it
    // in raw SQL like the worker. last_synced_at IS mapped.
    await db.execute(sql`
      UPDATE connected_accounts SET gmail_last_polled_at = NOW() WHERE id = ${inbox.id}
    `);
    await db
      .update(connectedAccounts)
      .set({ lastSyncedAt: new Date() })
      .where(eq(connectedAccounts.id, inbox.id));

    revalidatePath("/settings/inboxes");
    revalidatePath("/inbox");
    return { ok: true, data: result };
  } catch (err) {
    logger.error({ err, inboxId: id }, "resyncInbox failed");
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Resync failed: ${msg}` };
  }
}
