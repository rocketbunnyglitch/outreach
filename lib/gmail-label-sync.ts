import "server-only";

/**
 * Gmail label sync — pulls each connected account's labels from
 * Gmail and upserts them into the `gmail_labels` table for left-rail
 * rendering.
 *
 * Why here rather than inside the existing poll worker:
 *   The existing poll worker already fetches Gmail messages for the
 *   inbox + sent feed. Labels change far less often than messages,
 *   so we run this on a slower cadence — by default every 10th
 *   message-poll cycle, or on-demand from the connected_accounts
 *   settings page.
 *
 * Idempotent: upserts by (connected_account_id, gmail_label_id) so
 * repeated calls just refresh counts + name/color.
 *
 * Gmail label types:
 *   system  — INBOX, SENT, STARRED, IMPORTANT, DRAFT, SPAM, TRASH,
 *             CATEGORY_*, etc. We mirror these for completeness but
 *             the left rail mostly surfaces user labels (the rest
 *             duplicate mailbox views we already have).
 *   user    — Operator-defined in Gmail's UI.
 *
 * Nested labels: Gmail represents nesting via the name itself
 * ("Parent/Child"). We don't model the tree explicitly here; the
 * left rail renders by name with the slash preserved, matching
 * Gmail's own display.
 */

import { connectedAccounts, gmailLabels } from "@/db/schema";
import { db } from "@/lib/db";
import { type GmailLabel, listGmailLabels } from "@/lib/gmail";
import { logger } from "@/lib/logger";
import { and, eq, notInArray } from "drizzle-orm";

export interface SyncResult {
  inserted: number;
  updated: number;
  deleted: number;
}

/**
 * Sync labels for a single connected account.
 *
 * Returns counts so the caller can log meaningful metrics. Throws
 * only on outright Gmail API failures; missing-label-on-our-side
 * is treated as an insert.
 */
export async function syncGmailLabelsForAccount(connectedAccountId: string): Promise<SyncResult> {
  // Pull the encrypted refresh token + verify the account exists.
  const [account] = await db
    .select({
      id: connectedAccounts.id,
      token: connectedAccounts.gmailOauthRefreshToken,
    })
    .from(connectedAccounts)
    .where(eq(connectedAccounts.id, connectedAccountId))
    .limit(1);
  if (!account) {
    throw new Error(`Connected account ${connectedAccountId} not found.`);
  }
  if (!account.token) {
    throw new Error(`Connected account ${connectedAccountId} has no refresh token.`);
  }

  const remote = await listGmailLabels(account.token);
  const now = new Date();

  // Pull existing rows so we can diff for accurate insert/update/
  // delete counts (one round trip; the table is small per-account).
  const existing = await db
    .select({
      id: gmailLabels.id,
      gmailLabelId: gmailLabels.gmailLabelId,
    })
    .from(gmailLabels)
    .where(eq(gmailLabels.connectedAccountId, connectedAccountId));
  const existingByGmailId = new Map(existing.map((r) => [r.gmailLabelId, r]));

  let inserted = 0;
  let updated = 0;

  for (const label of remote) {
    const parentName = label.name.includes("/")
      ? label.name.slice(0, label.name.lastIndexOf("/"))
      : null;
    // Resolve parent_label_id by matching the parent name against
    // the same set we just fetched. We do this in two passes so a
    // child arriving before its parent still resolves correctly.
    const parentLabelId = parentName ? findRemoteLabelIdByName(remote, parentName) : null;

    const wasPresent = existingByGmailId.has(label.id);
    if (wasPresent) {
      await db
        .update(gmailLabels)
        .set({
          name: label.name,
          type: label.type,
          parentLabelId,
          backgroundColor: label.backgroundColor ?? null,
          textColor: label.textColor ?? null,
          syncedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(gmailLabels.connectedAccountId, connectedAccountId),
            eq(gmailLabels.gmailLabelId, label.id),
          ),
        );
      updated += 1;
      existingByGmailId.delete(label.id);
    } else {
      await db.insert(gmailLabels).values({
        connectedAccountId,
        gmailLabelId: label.id,
        name: label.name,
        type: label.type,
        parentLabelId,
        backgroundColor: label.backgroundColor ?? null,
        textColor: label.textColor ?? null,
        syncedAt: now,
      });
      inserted += 1;
    }
  }

  // Anything still in existingByGmailId has been deleted on Gmail's
  // side. Remove our mirror entries — operator deleting a label in
  // Gmail's UI shouldn't leave a phantom in our left rail.
  const stale = Array.from(existingByGmailId.keys());
  let deleted = 0;
  if (stale.length > 0) {
    const res = await db
      .delete(gmailLabels)
      .where(
        and(
          eq(gmailLabels.connectedAccountId, connectedAccountId),
          notInArray(
            gmailLabels.gmailLabelId,
            remote.map((l) => l.id),
          ),
        ),
      )
      .returning({ id: gmailLabels.id });
    deleted = res.length;
  }

  logger.info(
    { connectedAccountId, inserted, updated, deleted },
    "syncGmailLabelsForAccount complete",
  );
  return { inserted, updated, deleted };
}

function findRemoteLabelIdByName(labels: GmailLabel[], name: string): string | null {
  const m = labels.find((l) => l.name === name);
  return m?.id ?? null;
}

/**
 * Sync labels for every connected account on a team. Used by the
 * settings page or a cron pass. Continues on per-account errors so
 * one bad token doesn't block the rest.
 */
export async function syncGmailLabelsForTeam(teamId: string): Promise<{
  totalInserted: number;
  totalUpdated: number;
  totalDeleted: number;
  accountFailures: Array<{ connectedAccountId: string; error: string }>;
}> {
  const accounts = await db
    .select({ id: connectedAccounts.id })
    .from(connectedAccounts)
    .where(eq(connectedAccounts.teamId, teamId));

  let totalInserted = 0;
  let totalUpdated = 0;
  let totalDeleted = 0;
  const accountFailures: Array<{ connectedAccountId: string; error: string }> = [];

  for (const a of accounts) {
    try {
      const res = await syncGmailLabelsForAccount(a.id);
      totalInserted += res.inserted;
      totalUpdated += res.updated;
      totalDeleted += res.deleted;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ connectedAccountId: a.id, err }, "syncGmailLabelsForAccount failed");
      accountFailures.push({ connectedAccountId: a.id, error: msg });
    }
  }

  return { totalInserted, totalUpdated, totalDeleted, accountFailures };
}
