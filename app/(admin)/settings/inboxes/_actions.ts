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
/**
 * Deep-resync an inbox by clearing its last_history_id and replaying
 * the first-poll branch with a custom lookback window. The default
 * resyncInbox uses the existing incremental cursor; this one is for
 * when the operator wants to backfill more history than the engine
 * has seen.
 *
 * Use cases:
 *   - New connection: ingested only the last 7 days; operator wants
 *     the last 30 to populate the venue timelines.
 *   - Troubleshooting: a chunk of history is missing (maybe an
 *     ingest error in the past), operator wants to rerun.
 *   - Onboarding a venue that had been on the team for months
 *     before the inbox was connected -- backfill so the venue
 *     timeline isn't empty.
 *
 * Owner-only. daysBack is clamped to [1, 365] to keep the Gmail
 * `newer_than:Nd` query sane (Gmail accepts very large N but the
 * ingest cost is non-trivial; 365 is enough for any practical
 * onboarding).
 *
 * Behavior:
 *   1. last_history_id is set to NULL (engine forgets its cursor).
 *   2. pollOneInbox runs with the custom firstPollDaysBack. The
 *      first-poll branch fires (because last_history_id is null)
 *      and uses the operator's days-back instead of the constant.
 *   3. At the end of pollOneInbox, last_history_id is set to the
 *      profile's current historyId, so the NEXT poll (cron or
 *      regular resync) returns to incremental mode immediately.
 *      The deep-resync window is one-shot per click.
 *
 * Idempotency: re-running on the same inbox is safe -- the ingest
 * dedupes on (gmail_message_id, connected_account_id) so repeat
 * processing of the same Gmail messages is a no-op other than the
 * Gmail API quota cost.
 */
export async function deepResyncInbox(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ messagesIngested: number; threadsCreated: number; daysBack: number }>> {
  const { staff } = await requireStaff();
  const id = String(formData.get("id") ?? "");
  const daysBackRaw = String(formData.get("daysBack") ?? "30");
  if (!id) return { ok: false, error: "Missing inbox id" };

  const daysBack = Number.parseInt(daysBackRaw, 10);
  if (!Number.isFinite(daysBack) || daysBack < 1 || daysBack > 365) {
    return { ok: false, error: "Days back must be between 1 and 365." };
  }

  // Same shape as resyncInbox: ownership check + connected check.
  const rows = await db
    .select({
      id: connectedAccounts.id,
      ownerUserId: connectedAccounts.ownerUserId,
      emailAddress: connectedAccounts.emailAddress,
      refreshToken: connectedAccounts.gmailOauthRefreshToken,
      status: connectedAccounts.status,
    })
    .from(connectedAccounts)
    .where(eq(connectedAccounts.id, id))
    .limit(1);
  const inbox = rows[0];
  if (!inbox) return { ok: false, error: "Inbox not found." };
  if (inbox.ownerUserId !== staff.id) {
    return { ok: false, error: "You can only deep-resync inboxes you own." };
  }
  if (!inbox.refreshToken || inbox.status !== "connected") {
    return {
      ok: false,
      error: "Inbox is disconnected -- click Reconnect to re-authorize Gmail first.",
    };
  }

  try {
    // Step 1: forget the incremental cursor so pollOneInbox enters
    // the first-poll branch. This is the destructive part -- on
    // failure, the next normal poll would also enter first-poll
    // (with the default 7-day lookback); ingest dedupe makes that
    // safe but wasteful. We restore the cursor at the end of
    // pollOneInbox anyway, so the window is brief in practice.
    await db.execute(sql`
      UPDATE connected_accounts
      SET gmail_last_history_id = NULL
      WHERE id = ${inbox.id}
    `);

    // Step 2: run the poll with the custom days-back. pollOneInbox
    // sets last_history_id back to the current value at the end,
    // so subsequent polls go back to incremental mode.
    const result = await pollOneInbox(
      {
        id: inbox.id,
        refresh_token: inbox.refreshToken,
        last_history_id: null,
        email: inbox.emailAddress,
        staff_member_id: staff.id,
      },
      { firstPollDaysBack: daysBack },
    );

    // Bookkeeping (same as the normal resyncInbox path).
    await db.execute(sql`
      UPDATE connected_accounts SET gmail_last_polled_at = NOW() WHERE id = ${inbox.id}
    `);
    await db
      .update(connectedAccounts)
      .set({ lastSyncedAt: new Date() })
      .where(eq(connectedAccounts.id, inbox.id));

    logger.info({ inboxId: id, daysBack, ...result }, "deepResyncInbox complete");

    revalidatePath("/settings/inboxes");
    revalidatePath("/inbox");
    return { ok: true, data: { ...result, daysBack } };
  } catch (err) {
    logger.error({ err, inboxId: id, daysBack }, "deepResyncInbox failed");
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Deep resync failed: ${msg}` };
  }
}
