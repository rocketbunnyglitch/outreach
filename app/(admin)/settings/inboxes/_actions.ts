"use server";

import { connectedAccounts } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { syncGmailLabelsForAccount } from "@/lib/gmail-label-sync";
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

/**
 * Force a Gmail-labels sync for a single connected inbox. Useful
 * when the operator has just created a new label in Gmail's web UI
 * and doesn't want to wait for the probabilistic 10%-per-drain
 * sync to catch up.
 *
 * Owner-only — operators can sync their own inboxes.
 */
export async function syncGmailLabelsNowAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ inserted: number; updated: number; deleted: number }>> {
  const { staff } = await requireStaff();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing inbox id" };

  const [inbox] = await db
    .select({
      id: connectedAccounts.id,
      ownerUserId: connectedAccounts.ownerUserId,
      status: connectedAccounts.status,
    })
    .from(connectedAccounts)
    .where(eq(connectedAccounts.id, id))
    .limit(1);
  if (!inbox) return { ok: false, error: "Inbox not found." };
  if (inbox.ownerUserId !== staff.id) {
    return { ok: false, error: "You can only sync labels for inboxes you own." };
  }
  if (inbox.status !== "connected") {
    return { ok: false, error: "Inbox is disconnected — Reconnect first." };
  }

  try {
    const result = await syncGmailLabelsForAccount(inbox.id);
    revalidatePath("/settings/inboxes");
    revalidatePath("/inbox");
    return { ok: true, data: result };
  } catch (err) {
    logger.error({ err, inboxId: id }, "syncGmailLabelsNowAction failed");
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Sync failed: ${msg}` };
  }
}

/**
 * Set the daily cold-send cap on a connected inbox.
 *
 * Permissions:
 *   - Owner of the inbox can edit their own cap
 *   - Admin can edit ANY inbox on the team (typically used when a
 *     new account is warming up and needs a lower cap)
 *
 * Caps below 0 are coerced to 0 (effectively pauses cold sends);
 * caps above 200 are rejected as a sanity guard against typos
 * ("3000 -> 30 oops").
 */
export async function setInboxCap(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string; cap: number }>> {
  const { staff } = await requireStaff();
  const id = String(formData.get("id") ?? "");
  const capRaw = String(formData.get("cap") ?? "");
  if (!id) return { ok: false, error: "Missing inbox id" };

  const cap = Number.parseInt(capRaw, 10);
  if (!Number.isFinite(cap) || cap < 0) {
    return { ok: false, error: "Cap must be 0 or greater." };
  }
  if (cap > 200) {
    return { ok: false, error: "Cap above 200 looks like a typo — pick a smaller number." };
  }

  // Load to check ownership + team scope.
  const rows = await db
    .select({
      id: connectedAccounts.id,
      ownerUserId: connectedAccounts.ownerUserId,
      teamId: connectedAccounts.teamId,
    })
    .from(connectedAccounts)
    .where(eq(connectedAccounts.id, id))
    .limit(1);
  const inbox = rows[0];
  if (!inbox) return { ok: false, error: "Inbox not found." };
  if (inbox.teamId !== staff.teamId) {
    return { ok: false, error: "That inbox isn't on your team." };
  }
  const isAdmin = staff.role === "admin";
  const isOwner = inbox.ownerUserId === staff.id;
  if (!isAdmin && !isOwner) {
    return { ok: false, error: "Only the inbox owner or an admin can change the cap." };
  }

  try {
    await withAuditContext(staff.id, async (tx) => {
      await tx
        .update(connectedAccounts)
        .set({ dailyColdSendCap: cap, updatedBy: staff.id })
        .where(eq(connectedAccounts.id, id));
    });
    revalidatePath("/settings/inboxes");
    return { ok: true, data: { id, cap } };
  } catch (err) {
    logger.error({ err, id, cap }, "setInboxCap failed");
    return { ok: false, error: "Couldn't update cap. See server logs." };
  }
}
