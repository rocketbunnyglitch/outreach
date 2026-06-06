"use server";

import { connectedAccounts } from "@/db/schema";
import { hasMinimumRole, requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import {
  GmailScopeError,
  fetchGmailSignature,
  fetchGoogleProfile,
  refreshAccessToken,
} from "@/lib/gmail";
import { syncGmailLabelsForAccount } from "@/lib/gmail-label-sync";
import { pollOneInbox } from "@/lib/gmail-poll-worker";
import { logger } from "@/lib/logger";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
 * PERMANENTLY remove a connected inbox. Distinct from disconnectInbox
 * (which keeps the row + history and just stops syncing): this DELETES the
 * connected_accounts row so the account disappears from the list entirely.
 *
 * email_threads.staff_outreach_email_id is NOT NULL + a RESTRICT FK in the
 * live DB, so the account's conversations can't be detached — they're
 * DELETED. We delete the account's email_threads first (which cascades
 * messages / thread-labels / notes / mentions; send-events / drafts /
 * suppression null out), then delete the connected_accounts row. This is a
 * true permanent removal; re-adding the same Gmail account later starts a
 * fresh sync from scratch.
 *
 * Gated to the account OWNER or a team admin.
 */
export async function removeInboxPermanently(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing inbox id" };
  const isAdmin = hasMinimumRole(staff, "admin");

  try {
    const result = await withAuditContext(staff.id, async (tx) => {
      // Ownership / admin gate — confirm the row is removable by this user
      // before mutating anything.
      const owned = await tx
        .select({ id: connectedAccounts.id })
        .from(connectedAccounts)
        .where(
          isAdmin
            ? eq(connectedAccounts.id, id)
            : and(eq(connectedAccounts.id, id), eq(connectedAccounts.ownerUserId, staff.id)),
        )
        .limit(1);
      if (!owned[0]) return null;

      // Delete the account's conversations first. email_threads →
      // connected_accounts is NOT NULL + RESTRICT in the live DB, so we
      // can't detach (set null) — we delete the threads, which cascades
      // their messages / labels / notes / mentions and nulls the set-null
      // children (send-events / drafts / suppression). Only then can the
      // RESTRICT FK on connected_accounts be satisfied for the row delete.
      await tx.execute(sql`DELETE FROM email_threads WHERE staff_outreach_email_id = ${id}`);

      const deleted = await tx
        .delete(connectedAccounts)
        .where(eq(connectedAccounts.id, id))
        .returning({ id: connectedAccounts.id });
      return deleted[0]?.id;
    });

    if (!result) {
      return { ok: false, error: "Inbox not found or not yours to remove." };
    }

    revalidatePath("/settings/inboxes");
    return { ok: true, data: { id: result } };
  } catch (err) {
    logger.error({ err }, "removeInboxPermanently failed");
    return { ok: false, error: "Remove failed. See server logs." };
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
  const isAdmin = hasMinimumRole(staff, "admin");
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
 * Date-window input:
 *   The operator can pass an explicit `afterDate` (YYYY-MM-DD) instead
 *   of a preset days-back. We derive daysBack from it -- the number of
 *   whole days between that start date and now -- because the worker
 *   (pollOneInbox) only accepts a days-back lookback (firstPollDaysBack),
 *   NOT an arbitrary date range. afterDate wins over daysBack when both
 *   are present.
 *
 *   `beforeDate` (an upper bound on the window) is accepted but NOT
 *   enforced: the worker's Gmail query is `newer_than:Nd` with no
 *   `before:` clause, so the engine always ingests up through "now".
 *   We echo beforeDate back (and a beforeUnsupported flag) so the UI can
 *   warn the operator that the upper bound was ignored. Enforcing it
 *   would require changing the worker, which is out of scope here.
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
): Promise<
  ActionResult<{
    started: true;
    daysBack: number;
    afterDate: string | null;
    beforeDate: string | null;
    beforeUnsupported: boolean;
  }>
> {
  const { staff } = await requireStaff();
  const id = String(formData.get("id") ?? "");
  const daysBackRaw = String(formData.get("daysBack") ?? "30");
  const afterRaw = String(formData.get("afterDate") ?? "").trim();
  const beforeRaw = String(formData.get("beforeDate") ?? "").trim();
  if (!id) return { ok: false, error: "Missing inbox id" };

  // Validate any supplied dates as plain YYYY-MM-DD calendar days. We
  // parse at UTC midnight so the days-back math is timezone-stable.
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  function parseDay(raw: string): number | null {
    if (!DATE_RE.test(raw)) return null;
    const ms = Date.parse(`${raw}T00:00:00.000Z`);
    return Number.isNaN(ms) ? null : ms;
  }

  let afterDate: string | null = null;
  let beforeDate: string | null = null;
  let daysBack: number;

  if (afterRaw) {
    const afterMs = parseDay(afterRaw);
    if (afterMs === null) {
      return { ok: false, error: "Start date must be a valid YYYY-MM-DD date." };
    }
    if (afterMs > Date.now()) {
      return { ok: false, error: "Start date can't be in the future." };
    }
    // Derive whole-day lookback from the start date. Round UP so the
    // chosen start day is fully inside the Gmail `newer_than:Nd` window
    // (newer_than is exclusive-ish at the day boundary; an extra day of
    // overlap is harmless thanks to ingest dedupe).
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    daysBack = Math.ceil((Date.now() - afterMs) / MS_PER_DAY) + 1;
    if (daysBack < 1 || daysBack > 365) {
      return { ok: false, error: "Start date must be within the last 365 days." };
    }
    afterDate = afterRaw;

    // beforeDate is accepted for the UI's sake but the worker can't
    // filter an upper bound (newer_than:Nd only). Validate + echo it so
    // we can warn the operator; do NOT let it change what we ingest.
    if (beforeRaw) {
      const beforeMs = parseDay(beforeRaw);
      if (beforeMs === null) {
        return { ok: false, error: "End date must be a valid YYYY-MM-DD date." };
      }
      if (beforeMs <= afterMs) {
        return { ok: false, error: "End date must be after the start date." };
      }
      beforeDate = beforeRaw;
    }
  } else {
    // No explicit window: fall back to the preset days-back.
    daysBack = Number.parseInt(daysBackRaw, 10);
    if (!Number.isFinite(daysBack) || daysBack < 1 || daysBack > 365) {
      return { ok: false, error: "Days back must be between 1 and 365." };
    }
  }
  // The worker now enforces a `before:` upper bound, so the End date IS
  // honored. Kept in the return shape for the UI but always false now.
  const beforeUnsupported = false;

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
    // Step 1: forget the incremental cursor so pollOneInbox enters the
    // first-poll branch. pollOneInbox restores last_history_id at the end so
    // subsequent polls return to incremental mode.
    await db.execute(sql`
      UPDATE connected_accounts
      SET gmail_last_history_id = NULL
      WHERE id = ${inbox.id}
    `);

    // Step 2: run the backfill in the BACKGROUND. A large window can take
    // several minutes + thousands of Gmail fetches; awaiting it blocks the
    // request until the proxy times out and the operator sees "server error"
    // (even though the sync actually succeeds). We detach it and return
    // immediately. This is a long-lived Node server, so the promise keeps
    // running after we respond (same pattern as the fire-and-forget AI
    // enrichment in the poll worker). skipAiEnrichment avoids firing hundreds
    // of model calls at once, which previously blew the Anthropic per-minute
    // rate limit (429 flood) and degraded AI for every inbox.
    void pollOneInbox(
      {
        id: inbox.id,
        refresh_token: inbox.refreshToken,
        last_history_id: null,
        email: inbox.emailAddress,
        staff_member_id: staff.id,
      },
      {
        firstPollDaysBack: daysBack,
        afterDate: afterDate ?? undefined,
        beforeDate: beforeDate ?? undefined,
        skipAiEnrichment: true,
      },
    )
      .then(async (result) => {
        await db.execute(sql`
          UPDATE connected_accounts SET gmail_last_polled_at = NOW() WHERE id = ${inbox.id}
        `);
        await db
          .update(connectedAccounts)
          .set({ lastSyncedAt: new Date() })
          .where(eq(connectedAccounts.id, inbox.id));
        logger.info(
          { inboxId: id, daysBack, afterDate, beforeDate, ...result },
          "deepResyncInbox (background) complete",
        );
      })
      .catch((err) => {
        logger.error({ err, inboxId: id, daysBack }, "deepResyncInbox (background) failed");
      });

    revalidatePath("/settings/inboxes");
    revalidatePath("/inbox");
    return {
      ok: true,
      data: { started: true, daysBack, afterDate, beforeDate, beforeUnsupported },
    };
  } catch (err) {
    logger.error({ err, inboxId: id, daysBack }, "deepResyncInbox kickoff failed");
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Deep resync failed to start: ${msg}` };
  }
}

/**
 * Pull the inbox's Gmail signature into the engine (connected_accounts.
 * signature_html). Team-scoped. Returns a "reconnect" error when the account
 * was connected before the gmail.settings.basic scope was added.
 */
export async function syncSignatureFromGmail(
  connectedAccountId: string,
): Promise<ActionResult<{ signatureHtml: string }>> {
  const { staff } = await requireStaff();
  if (!UUID_RE.test(connectedAccountId)) return { ok: false, error: "Invalid inbox." };
  try {
    const [acct] = await db
      .select({
        refresh: connectedAccounts.gmailOauthRefreshToken,
        email: connectedAccounts.emailAddress,
        teamId: connectedAccounts.teamId,
      })
      .from(connectedAccounts)
      .where(eq(connectedAccounts.id, connectedAccountId))
      .limit(1);
    if (!acct) return { ok: false, error: "Inbox not found." };
    if (acct.teamId !== staff.teamId) return { ok: false, error: "Not allowed." };
    if (!acct.refresh) return { ok: false, error: "This inbox isn't connected. Reconnect Gmail." };

    const signature = await fetchGmailSignature(acct.refresh, acct.email);
    await withAuditContext(staff.id, async (tx) => {
      await tx
        .update(connectedAccounts)
        .set({ signatureHtml: signature || null, updatedBy: staff.id })
        .where(eq(connectedAccounts.id, connectedAccountId));
    });
    revalidatePath("/campaign-info");
    revalidatePath("/settings/inboxes");
    return { ok: true, data: { signatureHtml: signature } };
  } catch (err) {
    if (err instanceof GmailScopeError) {
      return {
        ok: false,
        error: "Reconnect this Gmail inbox to enable signature sync (new permission needed).",
      };
    }
    logger.error({ err, connectedAccountId }, "syncSignatureFromGmail failed");
    return { ok: false, error: "Couldn't sync the signature from Gmail." };
  }
}

/**
 * Pull the inbox's Google profile picture into connected_accounts.avatar_url.
 * Team-scoped. Returns a "reconnect" error when the account lacks the
 * userinfo.profile scope (no picture comes back).
 */
export async function syncProfilePhotoFromGmail(
  connectedAccountId: string,
): Promise<ActionResult<{ avatarUrl: string | null }>> {
  const { staff } = await requireStaff();
  if (!UUID_RE.test(connectedAccountId)) return { ok: false, error: "Invalid inbox." };
  try {
    const [acct] = await db
      .select({
        refresh: connectedAccounts.gmailOauthRefreshToken,
        teamId: connectedAccounts.teamId,
      })
      .from(connectedAccounts)
      .where(eq(connectedAccounts.id, connectedAccountId))
      .limit(1);
    if (!acct) return { ok: false, error: "Inbox not found." };
    if (acct.teamId !== staff.teamId) return { ok: false, error: "Not allowed." };
    if (!acct.refresh) return { ok: false, error: "This inbox isn't connected. Reconnect Gmail." };

    const accessToken = await refreshAccessToken(acct.refresh);
    const profile = await fetchGoogleProfile(accessToken);
    if (!profile.picture) {
      return {
        ok: false,
        error:
          "No picture available -- reconnect this Gmail inbox to grant the profile permission.",
      };
    }
    await withAuditContext(staff.id, async (tx) => {
      await tx
        .update(connectedAccounts)
        .set({ avatarUrl: profile.picture, updatedBy: staff.id })
        .where(eq(connectedAccounts.id, connectedAccountId));
    });
    revalidatePath("/campaign-info");
    revalidatePath("/settings/inboxes");
    return { ok: true, data: { avatarUrl: profile.picture } };
  } catch (err) {
    logger.error({ err, connectedAccountId }, "syncProfilePhotoFromGmail failed");
    return { ok: false, error: "Couldn't sync the profile picture from Gmail." };
  }
}
