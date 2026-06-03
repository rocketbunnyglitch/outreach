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

/**
 * Map a Tailwind color slug (the value stored in team_labels.color)
 * to a Gmail-supported palette pair. A Gmail label color must be a
 * real { backgroundColor, textColor } hex pair drawn from Gmail's
 * fixed palette (GMAIL_LABEL_COLOR_PAIRS) -- passing a raw slug like
 * "emerald" is rejected by the Gmail API, which is why label colors
 * never mirrored. Unknown / null slugs return undefined so the Gmail
 * label is created with no color (neutral), matching the UI default.
 *
 * No migration: we keep the slug in the column and derive the hex
 * pair here at write time.
 */
function gmailColorForSlug(
  slug: string | null | undefined,
): { backgroundColor: string; textColor: string } | undefined {
  if (!slug) return undefined;
  const map: Record<string, { backgroundColor: string; textColor: string }> = {
    // Greens
    emerald: { backgroundColor: "#16a766", textColor: "#ffffff" },
    green: { backgroundColor: "#16a766", textColor: "#ffffff" },
    teal: { backgroundColor: "#43d692", textColor: "#ffffff" },
    // Blues
    blue: { backgroundColor: "#3c78d8", textColor: "#ffffff" },
    sky: { backgroundColor: "#4a86e8", textColor: "#ffffff" },
    indigo: { backgroundColor: "#3c78d8", textColor: "#ffffff" },
    // Purples
    purple: { backgroundColor: "#8e63ce", textColor: "#ffffff" },
    violet: { backgroundColor: "#8e63ce", textColor: "#ffffff" },
    fuchsia: { backgroundColor: "#b694e8", textColor: "#ffffff" },
    // Reds
    red: { backgroundColor: "#cc3a21", textColor: "#ffffff" },
    rose: { backgroundColor: "#e66550", textColor: "#ffffff" },
    pink: { backgroundColor: "#e66550", textColor: "#ffffff" },
    // Oranges / Yellows
    orange: { backgroundColor: "#ffad47", textColor: "#ffffff" },
    amber: { backgroundColor: "#ffad47", textColor: "#ffffff" },
    yellow: { backgroundColor: "#fbe983", textColor: "#684e07" },
    // Neutrals
    zinc: { backgroundColor: "#666666", textColor: "#ffffff" },
    gray: { backgroundColor: "#666666", textColor: "#ffffff" },
    slate: { backgroundColor: "#999999", textColor: "#ffffff" },
  };
  return map[slug.toLowerCase()];
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

  const gmailColor = gmailColorForSlug(opts.color);

  for (const acct of accounts) {
    // Only "connected" accounts hold a usable token. needs_reauth /
    // disconnected / anything else means the refresh token is dead --
    // attempting a Gmail write would just throw on token refresh, so
    // skip it and let the link get created lazily after reauth.
    if (acct.status !== "connected" || !acct.token) {
      logger.info(
        { teamLabelId: labelRow.id, connectedAccountId: acct.id, status: acct.status },
        "createTeamLabel: skipping gmail label create for non-sendable account",
      );
      continue;
    }
    try {
      const result = await createGmailLabel({
        encryptedRefreshToken: acct.token,
        name,
        backgroundColor: gmailColor?.backgroundColor ?? null,
        textColor: gmailColor?.textColor ?? null,
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
 * Find a team_label by (team, name), creating it if absent. Used to
 * auto-apply campaign / city labels on engine sends without duplicating a
 * label the operator may have created by hand: the (team_id, name) unique
 * index is the dedupe key, so a name that already exists is reused rather
 * than re-created. Returns the team_label id either way.
 */
export async function ensureTeamLabel(opts: {
  teamId: string;
  name: string;
  createdBy: string;
}): Promise<{ id: string }> {
  const name = opts.name.trim();
  if (!name) throw new Error("Label name is required");
  const [existing] = await db
    .select({ id: teamLabels.id })
    .from(teamLabels)
    .where(and(eq(teamLabels.teamId, opts.teamId), eq(teamLabels.name, name)))
    .limit(1);
  if (existing) return { id: existing.id };
  return createTeamLabel({ teamId: opts.teamId, name, createdBy: opts.createdBy });
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

  // Need to create. Fetch the team_label name + color + account token.
  const labelRow = await db
    .select({ name: teamLabels.name, color: teamLabels.color })
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
    // Only a "connected" account has a live token. needs_reauth and
    // disconnected both mean the token is unusable for a Gmail write.
    if (acct[0].status !== "connected" || !acct[0].token) {
      throw new Error("connected_account is not sendable");
    }
    token = acct[0].token;
  }

  const gmailColor = gmailColorForSlug(labelRow[0].color);
  const result = await createGmailLabel({
    encryptedRefreshToken: token,
    name: labelRow[0].name,
    backgroundColor: gmailColor?.backgroundColor ?? null,
    textColor: gmailColor?.textColor ?? null,
  });
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
 * Inverse of reconcileGmailLabelsForThread — called by the poll
 * worker when Gmail's history.list reports that user labels were
 * REMOVED from a message. Maps the Gmail labelIds back to
 * team_labels via the existing teamLabelGmailLinks rows and
 * removes the corresponding email_thread_labels rows.
 *
 * Policy: only remove labels that were applied via='gmail'.
 * Manually-applied team labels stay even if the operator clicked
 * them off in Gmail's UI — the engine-side action was intentional
 * and shouldn't be silently reversed by an unrelated Gmail edit.
 *
 * Returns the count of rows actually removed (zero when no
 * matching gmail-applied row exists, which is the common case for
 * labels the operator never had in the engine in the first place).
 */
export async function unreconcileGmailLabelsForThread(opts: {
  threadId: string;
  /** Gmail-side label ids that were REMOVED on the thread. */
  gmailLabelIds: string[];
  /** Scope so a coincidental Gmail label id collision across
   *  accounts can't cross-contaminate. */
  connectedAccountId: string;
}): Promise<{ removed: number }> {
  if (opts.gmailLabelIds.length === 0) return { removed: 0 };

  const links = await db
    .select({
      teamLabelId: teamLabelGmailLinks.teamLabelId,
    })
    .from(teamLabelGmailLinks)
    .where(
      and(
        eq(teamLabelGmailLinks.connectedAccountId, opts.connectedAccountId),
        inArray(teamLabelGmailLinks.gmailLabelId, opts.gmailLabelIds),
      ),
    );
  if (links.length === 0) return { removed: 0 };

  const teamLabelIds = links.map((l) => l.teamLabelId);

  const removed = await db
    .delete(emailThreadLabels)
    .where(
      and(
        eq(emailThreadLabels.threadId, opts.threadId),
        inArray(emailThreadLabels.teamLabelId, teamLabelIds),
        // CRITICAL: only delete rows that originated from Gmail.
        // Manually-applied labels in the engine survive a Gmail
        // un-label so operators don't lose curated state to a
        // teammate's Gmail-side cleanup.
        eq(emailThreadLabels.appliedVia, "gmail"),
      ),
    )
    .returning({ id: emailThreadLabels.threadId });
  return { removed: removed.length };
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
    // Only "connected" accounts hold a live token. needs_reauth /
    // disconnected accounts can't take a Gmail write -- skip the push
    // rather than throw on a dead token; the DB row is the source of
    // truth and the next poll reconciles once the account is reauthed.
    if (!account || account.status !== "connected" || !account.token) {
      logger.warn(
        { threadId: opts.threadId, status: account?.status },
        "pushLabelChangeToGmail: connected_account not sendable, skipping gmail push",
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
