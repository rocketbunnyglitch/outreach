/**
 * Team labels — core logic for the team-scoped label namespace that
 * mirrors Gmail labels two-way.
 *
 * Public surface:
 *   listTeamLabels(teamId)
 *   createTeamLabel({ teamId, name, color, createdBy })
 *   renameTeamLabel({ id, name, updatedBy })
 *   deleteTeamLabel({ id })
 *   applyLabelToThread({ threadId, teamLabelId, appliedBy, via })
 *   removeLabelFromThread({ threadId, teamLabelId })
 *   listThreadLabels(threadId)
 *   reconcileGmailLabelsForThread({ threadId, gmailLabelIds, connectedAccountId, appliedBy })
 *   ensureGmailLinkForAccount({ teamLabelId, connectedAccountId, encryptedRefreshToken })
 *
 * Two-way sync rules:
 *   - createTeamLabel: also creates the label on EVERY connected_account
 *     on the team, persisting each new Gmail label id into
 *     team_label_gmail_links. If creation fails on one account
 *     (account disconnected etc.) we log + continue — the link will be
 *     created lazily the next time a thread on that account needs it.
 *   - applyLabelToThread: DB insert first; then call Gmail
 *     threads.modify on the thread's account; if the account doesn't
 *     have a link for this label yet, lazily create one.
 *   - reconcileGmailLabelsForThread (called by the poll worker):
 *     given a thread's Gmail labelIds, figure out which team_labels
 *     they map to and stamp them onto the thread with via='gmail'.
 *     Unknown Gmail labels are left alone — the team_labels namespace
 *     is curated, not auto-grown from Gmail.
 */

import {
  emailThreadLabels,
  emailThreads,
  staffOutreachEmails,
  teamLabelGmailLinks,
  teamLabels,
} from "@/db/schema";
import { db } from "@/lib/db";
import { createGmailLabel, modifyGmailThreadLabels } from "@/lib/gmail";
import { logger } from "@/lib/logger";
import { and, eq, inArray, sql } from "drizzle-orm";

export interface TeamLabelSummary {
  id: string;
  name: string;
  color: string | null;
}

export interface ThreadLabelRow extends TeamLabelSummary {
  appliedAt: Date;
  appliedVia: "manual" | "gmail" | "inherit";
}

/** Every label on a team, sorted by name (case-insensitive). */
export async function listTeamLabels(teamId: string): Promise<TeamLabelSummary[]> {
  const rows = await db
    .select({ id: teamLabels.id, name: teamLabels.name, color: teamLabels.color })
    .from(teamLabels)
    .where(eq(teamLabels.teamId, teamId))
    .orderBy(sql`lower(${teamLabels.name})`);
  return rows;
}

/** Every label currently applied to a thread. */
export async function listThreadLabels(threadId: string): Promise<ThreadLabelRow[]> {
  const rows = await db
    .select({
      id: teamLabels.id,
      name: teamLabels.name,
      color: teamLabels.color,
      appliedAt: emailThreadLabels.appliedAt,
      appliedVia: emailThreadLabels.appliedVia,
    })
    .from(emailThreadLabels)
    .innerJoin(teamLabels, eq(teamLabels.id, emailThreadLabels.teamLabelId))
    .where(eq(emailThreadLabels.threadId, threadId))
    .orderBy(sql`lower(${teamLabels.name})`);
  return rows.map((r) => ({
    ...r,
    appliedVia: r.appliedVia as "manual" | "gmail" | "inherit",
  }));
}

/**
 * Create a team_label. Best-effort Gmail-side label creation on every
 * connected_account on the team. Returns the new team_label.id even
 * if some Gmail creates failed — the missing links get created lazily
 * the first time the label is applied on that account.
 */
export async function createTeamLabel(opts: {
  teamId: string;
  name: string;
  color?: string | null;
  createdBy: string;
}): Promise<{ id: string }> {
  const name = opts.name.trim();
  if (!name) throw new Error("Label name is required");
  if (name.length > 200) throw new Error("Label name is too long");

  const inserted = await db
    .insert(teamLabels)
    .values({
      teamId: opts.teamId,
      name,
      color: opts.color ?? null,
      createdBy: opts.createdBy,
      updatedBy: opts.createdBy,
    })
    .returning({ id: teamLabels.id });
  const labelRow = inserted[0];
  if (!labelRow) throw new Error("Insert returning was empty");

  // Find every connected account on the team that's sendable; create
  // the Gmail label on each. We do this serially with try/catch per
  // account so a single bad refresh token doesn't abort the rest.
  const accounts = await db
    .select({
      id: staffOutreachEmails.id,
      token: staffOutreachEmails.gmailOauthRefreshToken,
      status: staffOutreachEmails.status,
    })
    .from(staffOutreachEmails)
    .where(eq(staffOutreachEmails.teamId, opts.teamId));

  for (const acct of accounts) {
    if (acct.status === "disconnected" || !acct.token) continue;
    try {
      const result = await createGmailLabel({
        encryptedRefreshToken: acct.token,
        name,
      });
      await db
        .insert(teamLabelGmailLinks)
        .values({
          teamLabelId: labelRow.id,
          connectedAccountId: acct.id,
          gmailLabelId: result.id,
        })
        .onConflictDoNothing();
    } catch (err) {
      logger.warn(
        { err, teamLabelId: labelRow.id, connectedAccountId: acct.id },
        "createTeamLabel: gmail label create failed (will retry lazily)",
      );
    }
  }

  return { id: labelRow.id };
}

/**
 * Rename a team_label. Does NOT rename the Gmail-side labels — that
 * would require a labels.update call per account and increase the
 * cost of every rename. Gmail labels are renamed lazily on next sync,
 * which is acceptable for this surface.
 */
export async function renameTeamLabel(opts: {
  id: string;
  name: string;
  updatedBy: string;
}): Promise<void> {
  const name = opts.name.trim();
  if (!name) throw new Error("Label name is required");
  await db
    .update(teamLabels)
    .set({ name, updatedAt: new Date(), updatedBy: opts.updatedBy })
    .where(eq(teamLabels.id, opts.id));
}

/** Delete a team_label. CASCADE drops every email_thread_labels row +
 *  every team_label_gmail_links row referencing it. Does NOT delete
 *  the Gmail-side label — operators may still want it in Gmail. */
export async function deleteTeamLabel(id: string): Promise<void> {
  await db.delete(teamLabels).where(eq(teamLabels.id, id));
}

/**
 * Ensure a team_label has a Gmail-side label on the given account.
 * Looks up the existing link first; if none, creates the Gmail label
 * (or finds an existing one with the same name) and persists the link.
 *
 * Returns the gmail_label_id. Throws if the account is disconnected.
 */
export async function ensureGmailLinkForAccount(opts: {
  teamLabelId: string;
  connectedAccountId: string;
  /** Pass the encrypted refresh token if the caller has already
   *  loaded it; otherwise we fetch it. */
  encryptedRefreshToken?: string;
}): Promise<string> {
  const existing = await db
    .select({ gmailLabelId: teamLabelGmailLinks.gmailLabelId })
    .from(teamLabelGmailLinks)
    .where(
      and(
        eq(teamLabelGmailLinks.teamLabelId, opts.teamLabelId),
        eq(teamLabelGmailLinks.connectedAccountId, opts.connectedAccountId),
      ),
    )
    .limit(1);
  if (existing[0]) return existing[0].gmailLabelId;

  // Need to create. Fetch the team_label name + account refresh token.
  const labelRow = await db
    .select({ name: teamLabels.name })
    .from(teamLabels)
    .where(eq(teamLabels.id, opts.teamLabelId))
    .limit(1);
  if (!labelRow[0]) throw new Error("team_label not found");

  let token = opts.encryptedRefreshToken;
  if (!token) {
    const acct = await db
      .select({
        token: staffOutreachEmails.gmailOauthRefreshToken,
        status: staffOutreachEmails.status,
      })
      .from(staffOutreachEmails)
      .where(eq(staffOutreachEmails.id, opts.connectedAccountId))
      .limit(1);
    if (!acct[0]) throw new Error("connected_account not found");
    if (acct[0].status === "disconnected" || !acct[0].token) {
      throw new Error("connected_account is disconnected");
    }
    token = acct[0].token;
  }

  const result = await createGmailLabel({ encryptedRefreshToken: token, name: labelRow[0].name });
  await db
    .insert(teamLabelGmailLinks)
    .values({
      teamLabelId: opts.teamLabelId,
      connectedAccountId: opts.connectedAccountId,
      gmailLabelId: result.id,
    })
    .onConflictDoNothing();
  return result.id;
}

/**
 * Apply a team_label to a thread. Inserts the join row, then mirrors
 * to Gmail via threads.modify { addLabelIds }.
 *
 * Errors on the Gmail mirror are logged but don't fail the dashboard
 * write — the operator sees the label immediately in the UI and the
 * next poll cycle will reconcile.
 */
export async function applyLabelToThread(opts: {
  threadId: string;
  teamLabelId: string;
  appliedBy: string;
  via?: "manual" | "gmail" | "inherit";
}): Promise<void> {
  const via = opts.via ?? "manual";
  await db
    .insert(emailThreadLabels)
    .values({
      threadId: opts.threadId,
      teamLabelId: opts.teamLabelId,
      appliedBy: opts.appliedBy,
      appliedVia: via,
    })
    .onConflictDoNothing();

  if (via === "gmail") return; // came FROM gmail, don't push back

  // Push to Gmail.
  await pushLabelChangeToGmail({
    threadId: opts.threadId,
    addTeamLabelId: opts.teamLabelId,
  });
}

/** Remove a team_label from a thread. Mirrors removal to Gmail. */
export async function removeLabelFromThread(opts: {
  threadId: string;
  teamLabelId: string;
}): Promise<void> {
  await db
    .delete(emailThreadLabels)
    .where(
      and(
        eq(emailThreadLabels.threadId, opts.threadId),
        eq(emailThreadLabels.teamLabelId, opts.teamLabelId),
      ),
    );
  await pushLabelChangeToGmail({
    threadId: opts.threadId,
    removeTeamLabelId: opts.teamLabelId,
  });
}

/**
 * Inbound sync: called by the poll worker for each thread it touches.
 * Given the Gmail labelIds on a message (or the union across the
 * thread's messages, depending on the caller), figure out which
 * team_labels they map to and stamp them onto the thread with
 * via='gmail'. Unknown Gmail labels are NOT promoted to team_labels —
 * the team_labels namespace is curated.
 */
export async function reconcileGmailLabelsForThread(opts: {
  threadId: string;
  /** Gmail-side label ids on the THREAD or its messages. */
  gmailLabelIds: string[];
  /** The connected_account these labels came from. */
  connectedAccountId: string;
  /** Audit attribution. */
  appliedBy: string;
}): Promise<{ added: number }> {
  if (opts.gmailLabelIds.length === 0) return { added: 0 };

  const links = await db
    .select({
      teamLabelId: teamLabelGmailLinks.teamLabelId,
      gmailLabelId: teamLabelGmailLinks.gmailLabelId,
    })
    .from(teamLabelGmailLinks)
    .where(
      and(
        eq(teamLabelGmailLinks.connectedAccountId, opts.connectedAccountId),
        inArray(teamLabelGmailLinks.gmailLabelId, opts.gmailLabelIds),
      ),
    );
  if (links.length === 0) return { added: 0 };

  // Bulk insert with onConflictDoNothing so re-syncs are idempotent.
  await db
    .insert(emailThreadLabels)
    .values(
      links.map((l) => ({
        threadId: opts.threadId,
        teamLabelId: l.teamLabelId,
        appliedBy: opts.appliedBy,
        appliedVia: "gmail" as const,
      })),
    )
    .onConflictDoNothing();
  return { added: links.length };
}

/**
 * Internal: push a single label apply/remove to Gmail for a thread.
 * Looks up the thread's gmailThreadId + connected_account, ensures
 * the team_label has a Gmail link on that account (creating it
 * lazily), then calls threads.modify.
 *
 * Errors are caught and logged — the dashboard view of labels is the
 * source of truth; Gmail is downstream best-effort.
 */
async function pushLabelChangeToGmail(opts: {
  threadId: string;
  addTeamLabelId?: string;
  removeTeamLabelId?: string;
}): Promise<void> {
  try {
    const threadRow = await db
      .select({
        gmailThreadId: emailThreads.gmailThreadId,
        staffOutreachEmailId: emailThreads.staffOutreachEmailId,
      })
      .from(emailThreads)
      .where(eq(emailThreads.id, opts.threadId))
      .limit(1);
    const thread = threadRow[0];
    if (!thread || !thread.staffOutreachEmailId) {
      logger.warn(
        { threadId: opts.threadId },
        "pushLabelChangeToGmail: thread has no connected_account",
      );
      return;
    }

    const acct = await db
      .select({
        token: staffOutreachEmails.gmailOauthRefreshToken,
        status: staffOutreachEmails.status,
      })
      .from(staffOutreachEmails)
      .where(eq(staffOutreachEmails.id, thread.staffOutreachEmailId))
      .limit(1);
    const account = acct[0];
    if (!account || account.status === "disconnected" || !account.token) {
      logger.warn(
        { threadId: opts.threadId },
        "pushLabelChangeToGmail: connected_account disconnected, skipping gmail push",
      );
      return;
    }

    const addIds: string[] = [];
    if (opts.addTeamLabelId) {
      const gmailId = await ensureGmailLinkForAccount({
        teamLabelId: opts.addTeamLabelId,
        connectedAccountId: thread.staffOutreachEmailId,
        encryptedRefreshToken: account.token,
      });
      addIds.push(gmailId);
    }

    const removeIds: string[] = [];
    if (opts.removeTeamLabelId) {
      const link = await db
        .select({ gmailLabelId: teamLabelGmailLinks.gmailLabelId })
        .from(teamLabelGmailLinks)
        .where(
          and(
            eq(teamLabelGmailLinks.teamLabelId, opts.removeTeamLabelId),
            eq(teamLabelGmailLinks.connectedAccountId, thread.staffOutreachEmailId),
          ),
        )
        .limit(1);
      if (link[0]) removeIds.push(link[0].gmailLabelId);
    }

    if (addIds.length === 0 && removeIds.length === 0) return;

    await modifyGmailThreadLabels({
      encryptedRefreshToken: account.token,
      gmailThreadId: thread.gmailThreadId,
      addLabelIds: addIds,
      removeLabelIds: removeIds,
    });
  } catch (err) {
    logger.error({ err, threadId: opts.threadId }, "pushLabelChangeToGmail failed");
  }
}
