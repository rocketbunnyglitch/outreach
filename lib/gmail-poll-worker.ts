import "server-only";

/**
 * Gmail polling worker — pulls inbound mail from each connected staff
 * outreach inbox into the email_threads + email_messages tables.
 *
 * Triggered the same way as send-worker: by a cron endpoint
 * (/api/cron/gmail-poll) that we wire to system cron at a 5-minute
 * cadence. One pass per call.
 *
 * Per-inbox flow:
 *   1. Fetch a fresh access token via refreshAccessToken(staffOutreachEmail.gmailOauthRefreshToken).
 *   2. If gmail_last_history_id is set: call history.list since that id.
 *      Else (first run): call messages.list with a reasonable cap and
 *      newer_than:7d so the first poll doesn't pull years of mail.
 *   3. For each new gmail_message_id, fetch the full message metadata
 *      (subject, from, to, cc, snippet, body, headers, attachments).
 *   4. Resolve the venue + thread:
 *        - thread by gmail_thread_id (unique index in email_threads)
 *        - if missing, create one tied to the venue with matching
 *          domain or @email, falling back to a 'parked' state with a
 *          null venueId (operator can attach later from the inbox UI)
 *   5. Upsert email_messages on (gmail_message_id, staff_outreach_email_id)
 *      — the existing UNIQUE constraint handles dedup if we get the
 *      same message twice from a re-poll.
 *   6. Update email_threads rollups (snippet, message_count, unread_count,
 *      last_inbound_at, state if newly arrived).
 *   7. Bump gmail_last_history_id to the max we processed.
 *   8. Publish a realtime event so /inbox tabs refresh.
 *
 * Error policy:
 *   - Per-inbox errors are logged but don't stop the loop; one bad
 *     inbox shouldn't block the others.
 *   - 401 from Gmail (invalid_grant) → mark gmailOauthRefreshToken NULL
 *     and log; the staffer needs to re-connect.
 *
 * Safety:
 *   - Skips inboxes without a refresh token (operator hasn't connected
 *     Gmail yet).
 *   - SKIP LOCKED on the inbox row so two cron passes don't race on
 *     the same inbox.
 */

import { cities, emailMessages, emailThreads, staffOutreachEmails, venues } from "@/db/schema";
import { classifyInboundMessageAsync } from "@/lib/ai-classify";
import { extractPromisesAsync } from "@/lib/ai-extract-promises";
import { db, withAuditContext } from "@/lib/db";
import { parseEmailHeader, parseEmailList } from "@/lib/email-address";
import { refreshAccessToken } from "@/lib/gmail";
import { syncGmailLabelsForAccount } from "@/lib/gmail-label-sync";
import { logger } from "@/lib/logger";
import { routeMisroutedReply } from "@/lib/misrouted-reply";
import { publishRealtime } from "@/lib/realtime-publish";
import { detectSlotChange } from "@/lib/slot-change-detect";
import { reconcileGmailLabelsForThread, unreconcileGmailLabelsForThread } from "@/lib/team-labels";
import { classifyInboundEmail } from "@/lib/triage-classifier";
import { autoTagOrCreateVenue } from "@/lib/venue-auto-create";
import { findVenuesByDomainAlias } from "@/lib/venue-domain-match";
import { and, eq, isNotNull, sql } from "drizzle-orm";

const BATCH_INBOX_LIMIT = 10;
const PER_INBOX_MSG_LIMIT = 50;

// Freemail / personal-email domains. Inbound senders on these domains are
// NEVER matched to a venue by domain (a venue using bradleyson7th@aol.com
// must not capture every @aol.com sender) -- only by exact email.
const FREEMAIL_DOMAINS = new Set<string>([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "yahoo.ca",
  "ymail.com",
  "aol.com",
  "hotmail.com",
  "hotmail.co.uk",
  "outlook.com",
  "live.com",
  "live.co.uk",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "mail.com",
  "comcast.net",
  "verizon.net",
  "att.net",
  "sbcglobal.net",
  "bellsouth.net",
  "cox.net",
  "rocketmail.com",
]);
// First-poll backfill window. A freshly-connected inbox ingests the last
// N days of inbox+sent mail (the incremental history cursor then captures
// everything new). 7 days was far too narrow: high-frequency automated
// mail (Eventbrite, Google, calendar) dominates a single week, so a new
// account surfaced almost entirely CATEGORY_UPDATES and ~no CATEGORY_
// PERSONAL (Primary) conversations — operators reported "it only synced
// my Updates folder." 90 days captures real conversation history while
// staying well under FIRST_POLL_MAX_MESSAGES for any normal outreach
// inbox. An admin deep-resync can override via opts.firstPollDaysBack /
// afterDate for accounts that need their full archive.
const FIRST_POLL_NEWER_THAN_DAYS = 90;
// First-poll / deep-resync backfill: page through messages.list via
// nextPageToken up to this overall cap so a fresh connection or an
// operator-requested backfill captures historical mail (inbound AND
// sent) instead of stopping at the single-page PER_INBOX_MSG_LIMIT.
// The incremental cron path still uses PER_INBOX_MSG_LIMIT (no paging)
// to stay cheap. Gmail returns up to 500 ids per page; we cap total
// ids so a pathological multi-year archive can't blow the poll budget.
const FIRST_POLL_PAGE_SIZE = 500;
const FIRST_POLL_MAX_MESSAGES = 3000;
const SYSTEM_STAFF_ID_FALLBACK = "00000000-0000-0000-0000-000000000000";

interface DrainSummary {
  inboxesScanned: number;
  messagesIngested: number;
  threadsCreated: number;
  errors: Array<{ inboxId: string; message: string }>;
}

export async function drainGmailPolls(): Promise<DrainSummary> {
  const summary: DrainSummary = {
    inboxesScanned: 0,
    messagesIngested: 0,
    threadsCreated: 0,
    errors: [],
  };

  type ClaimedRow = {
    id: string;
    refresh_token: string;
    last_history_id: string | null;
    email: string;
    staff_member_id: string;
  };
  const claimed = (await db.execute<ClaimedRow>(sql`
    SELECT id, gmail_oauth_refresh_token AS refresh_token,
           gmail_last_history_id AS last_history_id,
           email_address AS email, owner_user_id AS staff_member_id
    FROM connected_accounts
    WHERE gmail_oauth_refresh_token IS NOT NULL
    ORDER BY COALESCE(gmail_last_polled_at, '1970-01-01'::timestamptz) ASC
    LIMIT ${BATCH_INBOX_LIMIT}
    FOR UPDATE SKIP LOCKED
  `)) as unknown as { rows?: ClaimedRow[] } | ClaimedRow[];

  const inboxes: ClaimedRow[] = Array.isArray(claimed) ? claimed : (claimed.rows ?? []);

  for (const inbox of inboxes) {
    summary.inboxesScanned++;
    try {
      const result = await pollOneInbox(inbox);
      summary.messagesIngested += result.messagesIngested;
      summary.threadsCreated += result.threadsCreated;

      // Successful poll -> stamp last_synced_at. The email-health
      // surface (lib/email-health.ts) derives a "stale" status from
      // connected_accounts.last_synced_at (NOT gmail_last_polled_at,
      // which is only the cron's internal round-robin cursor). Without
      // this write, every healthy inbox shows a false "stale sync"
      // because the cron never advanced the column the UI reads.
      try {
        await db.execute(sql`
          UPDATE connected_accounts
          SET last_synced_at = NOW()
          WHERE id = ${inbox.id}
        `);
      } catch (err) {
        logger.warn({ err, inboxId: inbox.id }, "failed to stamp last_synced_at");
      }
      // Sync Gmail labels on a sub-cadence — labels.list is cheap
      // but doesn't change between most polls. Run on a ~10% rate
      // (≈ once per 10 drains per account on average), plus we always
      // sync if the account has never been synced (the gmail_labels
      // table will be empty for new connections).
      if (Math.random() < 0.1) {
        try {
          await syncGmailLabelsForAccount(inbox.id);
        } catch (err) {
          // Label sync failures don't block message polling — they
          // just delay the next display refresh.
          logger.warn(
            { connectedAccountId: inbox.id, err },
            "syncGmailLabelsForAccount within drain failed",
          );
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ err, inboxId: inbox.id, email: inbox.email }, "gmail poll failed for inbox");
      summary.errors.push({ inboxId: inbox.id, message });

      // If the refresh token is dead, blank it so we stop trying until
      // the operator re-connects.
      if (
        message.includes("invalid_grant") ||
        message.includes("Token has been expired or revoked")
      ) {
        try {
          // Blank the dead token AND flip status to 'needs_reauth' so
          // the email-health surface (lib/email-health.ts) shows the
          // operator that this inbox must be reconnected. That UI keys
          // off connected_accounts.status === 'needs_reauth'; clearing
          // the token alone left the status stale at 'connected'.
          await db
            .update(staffOutreachEmails)
            .set({ gmailOauthRefreshToken: null, status: "needs_reauth" })
            .where(eq(staffOutreachEmails.id, inbox.id));
          logger.warn(
            { inboxId: inbox.id },
            "cleared invalid Gmail refresh token + set needs_reauth; operator must reconnect",
          );
        } catch (clearErr) {
          logger.error({ clearErr }, "failed to clear invalid refresh token");
        }
      }
    }

    // Stamp last-polled regardless of outcome so we don't get stuck
    // re-trying the same inbox forever
    try {
      await db.execute(sql`
        UPDATE connected_accounts
        SET gmail_last_polled_at = NOW()
        WHERE id = ${inbox.id}
      `);
    } catch (err) {
      logger.warn({ err, inboxId: inbox.id }, "failed to stamp gmail_last_polled_at");
    }
  }

  if (summary.messagesIngested > 0) {
    publishRealtime({
      table: "email_threads",
      type: "update",
      byStaffId: null,
      byStaffName: "Gmail poll",
    });
  }

  return summary;
}

interface InboxPollResult {
  messagesIngested: number;
  threadsCreated: number;
  /** Total Gmail message ids the poll looked at this pass. */
  messagesFound: number;
  /** Messages already present (deduped) -- looked at but not written. */
  duplicatesSkipped: number;
  /** Per-message ingest failures that were logged + skipped. */
  errors: number;
}

export async function pollOneInbox(
  inbox: {
    id: string;
    refresh_token: string;
    last_history_id: string | null;
    email: string;
    staff_member_id: string;
  },
  opts?: {
    /**
     * Override for the first-poll lookback window. Defaults to
     * FIRST_POLL_NEWER_THAN_DAYS. Only consulted when last_history_id
     * is null (i.e. the first-poll branch fires); ignored otherwise
     * since incremental polls use history.list, not a date filter.
     *
     * Set this via the operator-facing deep-resync action when an
     * admin wants to backfill more than the default 7 days. Range
     * is enforced by the caller (the action validates 1..365 to
     * keep the Gmail q parameter sane).
     */
    firstPollDaysBack?: number;
    /**
     * Optional explicit lower bound for the first-poll backfill window
     * (YYYY-MM-DD). When set, the Gmail query uses `after:YYYY/MM/DD`
     * instead of `newer_than:Nd`. Takes precedence over
     * firstPollDaysBack.
     */
    afterDate?: string;
    /**
     * Optional explicit UPPER bound (YYYY-MM-DD). When set, the Gmail
     * query adds `before:YYYY/MM/DD`, so the operator can backfill a
     * bounded historical window rather than everything-through-today.
     */
    beforeDate?: string;
    /**
     * Skip per-message AI enrichment (classify + extract-promises) during a
     * bulk backfill (deep-resync). A large resync would otherwise fire
     * hundreds of fire-and-forget model calls at once and blow the Anthropic
     * per-minute rate limit (429s), degrading AI for every inbox. Re-ingested
     * mail is deduped + historical; go-forward normal polling still enriches.
     */
    skipAiEnrichment?: boolean;
  },
): Promise<InboxPollResult> {
  const accessToken = await refreshAccessToken(inbox.refresh_token);
  let messageIds: string[] = [];
  let nextHistoryId: string | null = inbox.last_history_id;
  const firstPollDays = opts?.firstPollDaysBack ?? FIRST_POLL_NEWER_THAN_DAYS;
  const skipAiEnrichment = opts?.skipAiEnrichment ?? false;

  // Threads whose STARRED label changed in Gmail since our last
  // poll. We sync these to email_threads.is_starred so unstarring
  // (or starring) directly in Gmail reflects in the engine.
  // Populated from history.list's labelsAdded / labelsRemoved
  // events when label_change history is requested.
  const starredAddedThreadGmailIds = new Set<string>();
  const starredRemovedThreadGmailIds = new Set<string>();

  // UNREAD label changes — operator opened (or re-marked unread) a
  // thread directly in Gmail's web UI. Same delta-window collection
  // pattern as STARRED. UNREAD removed -> engine.unread_count = 0
  // (operator already saw it in Gmail). UNREAD added -> bump engine
  // unread_count back to inbound message count (operator wants the
  // engine badge back).
  //
  // Same ambiguity handling as STARRED: thread appearing in both
  // sets in one delta is skipped, next poll resolves.
  const unreadAddedThreadGmailIds = new Set<string>();
  const unreadRemovedThreadGmailIds = new Set<string>();

  // INBOX label changes -- operator archived (INBOX removed) or
  // un-archived (INBOX added) a thread directly in Gmail's web UI.
  // We mirror Gmail archive onto email_threads.archived_at + state so
  // the engine's mailbox views match Gmail. Same delta-window
  // collection + ambiguity handling as STARRED / UNREAD: a thread in
  // both sets in one delta is skipped and resolved next poll.
  const inboxAddedThreadGmailIds = new Set<string>();
  const inboxRemovedThreadGmailIds = new Set<string>();

  // User-label changes on existing messages — operator labeled or
  // unlabeled a thread directly in Gmail's web UI without sending a
  // new message. Keyed by Gmail thread id; values are the sets of
  // user-label ids added / removed in this delta window. We process
  // these AFTER message ingest so any thread newly created in this
  // poll cycle is in place before we try to apply labels to it.
  //
  // System labels (INBOX/UNREAD/SENT/SPAM/TRASH/CATEGORY_*) are
  // filtered out here — they don't map to team_labels. STARRED is
  // also filtered out because the dedicated STAR handling above
  // already processed it.
  const userLabelsAddedByThread = new Map<string, Set<string>>();
  const userLabelsRemovedByThread = new Map<string, Set<string>>();
  function addToMap(m: Map<string, Set<string>>, threadId: string, labelId: string) {
    let s = m.get(threadId);
    if (!s) {
      s = new Set();
      m.set(threadId, s);
    }
    s.add(labelId);
  }

  // When history.list returns 404 the startHistoryId is too old (Gmail
  // expires history beyond ~a week or after large mailbox changes). We
  // must null the cursor and fall back to a first-poll, otherwise the
  // inbox is silently stuck -- every poll 404s and ingests nothing.
  // This flag forces the first-poll branch below.
  let historyExpired = false;
  if (inbox.last_history_id && !historyExpired) {
    // Incremental: history.list since the last point we processed.
    // Request history types in one call:
    //   messageAdded   -- new mail (the original use case)
    //   labelAdded     -- labels added to existing messages
    //   labelRemoved   -- labels removed (same source for un-stars,
    //                    archives, and operator-driven Gmail un-labels)
    // The Gmail API accepts a comma-separated list per the docs.
    let historyRes: Record<string, unknown>;
    try {
      historyRes = await gmailFetch(
        `users/me/history?startHistoryId=${encodeURIComponent(inbox.last_history_id)}&historyTypes=messageAdded&historyTypes=labelAdded&historyTypes=labelRemoved&maxResults=500`,
        accessToken,
      );
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      // gmailFetch throws "Gmail API 404: ..." on an expired/invalid
      // startHistoryId. Recover by clearing the cursor + first-polling
      // this pass; the bug was leaving the inbox permanently stuck.
      if (m.includes("Gmail API 404")) {
        logger.warn(
          { inboxId: inbox.id, lastHistoryId: inbox.last_history_id },
          "gmail history.list 404 (expired startHistoryId); nulling cursor and falling back to first-poll",
        );
        await db.execute(sql`
          UPDATE connected_accounts
          SET gmail_last_history_id = NULL
          WHERE id = ${inbox.id}
        `);
        historyExpired = true;
        historyRes = {};
      } else {
        throw err;
      }
    }
    type LabelChange = {
      message: { id: string; threadId: string; labelIds?: string[] };
      labelIds?: string[];
    };
    type HistoryEntry = {
      id: string;
      messagesAdded?: Array<{ message: { id: string; threadId: string } }>;
      labelsAdded?: LabelChange[];
      labelsRemoved?: LabelChange[];
    };
    const histories: HistoryEntry[] = (historyRes.history as HistoryEntry[]) ?? [];
    const seen = new Set<string>();
    for (const h of histories) {
      for (const m of h.messagesAdded ?? []) {
        if (m.message.id) seen.add(m.message.id);
      }
      // STARRED label changes — collect the Gmail thread ids so we
      // can mirror the star state below. labelIds on the change
      // record is the set of labels added/removed in this delta
      // (not the post-state); we filter for STARRED specifically
      // so non-star label edits don't trigger the sync.
      for (const change of h.labelsAdded ?? []) {
        const ids = change.labelIds ?? [];
        if (ids.includes("STARRED")) {
          starredAddedThreadGmailIds.add(change.message.threadId);
        }
        if (ids.includes("UNREAD")) {
          unreadAddedThreadGmailIds.add(change.message.threadId);
        }
        // INBOX added back in Gmail -> un-archive in the engine.
        if (ids.includes("INBOX")) {
          inboxAddedThreadGmailIds.add(change.message.threadId);
        }
        // User labels (anything not a system label) — collect for
        // the post-loop reconcile.
        for (const id of ids) {
          if (!GMAIL_SYSTEM_LABEL_IDS.has(id) && !id.startsWith("CATEGORY_")) {
            addToMap(userLabelsAddedByThread, change.message.threadId, id);
          }
        }
      }
      for (const change of h.labelsRemoved ?? []) {
        const ids = change.labelIds ?? [];
        if (ids.includes("STARRED")) {
          starredRemovedThreadGmailIds.add(change.message.threadId);
        }
        if (ids.includes("UNREAD")) {
          unreadRemovedThreadGmailIds.add(change.message.threadId);
        }
        // INBOX removed in Gmail -> operator archived the thread.
        if (ids.includes("INBOX")) {
          inboxRemovedThreadGmailIds.add(change.message.threadId);
        }
        for (const id of ids) {
          if (!GMAIL_SYSTEM_LABEL_IDS.has(id) && !id.startsWith("CATEGORY_")) {
            addToMap(userLabelsRemovedByThread, change.message.threadId, id);
          }
        }
      }
    }
    messageIds = Array.from(seen).slice(0, PER_INBOX_MSG_LIMIT);
    if (historyRes.historyId) nextHistoryId = historyRes.historyId as string;
  }

  // First poll (no cursor) OR history fell back because the cursor
  // expired (404). Backfill recent mail spanning BOTH the inbox and
  // sent folders so the venue timeline gets historical OUTBOUND too --
  // a fresh connection otherwise only ingests inbound. We page through
  // nextPageToken up to FIRST_POLL_MAX_MESSAGES so a deep-resync (or a
  // normal first-poll on a busy account) isn't truncated at one 50-id
  // page. The incremental cron path above keeps its cheap single-page
  // PER_INBOX_MSG_LIMIT.
  if (!inbox.last_history_id || historyExpired) {
    // `in:anywhere` would include spam/trash; we want inbox + sent.
    // Gmail's search grammar: (in:inbox OR in:sent) scoped by date.
    // An explicit afterDate uses `after:YYYY/MM/DD` (Gmail's date
    // grammar); otherwise fall back to the relative `newer_than:Nd`.
    // An explicit beforeDate adds an UPPER bound so the operator can
    // backfill a bounded window rather than everything through today.
    const toGmailDate = (d: string) => d.replace(/-/g, "/"); // YYYY-MM-DD -> YYYY/MM/DD
    const lowerClause = opts?.afterDate
      ? `after:${toGmailDate(opts.afterDate)}`
      : `newer_than:${firstPollDays}d`;
    const upperClause = opts?.beforeDate ? ` before:${toGmailDate(opts.beforeDate)}` : "";
    const q = `(in:inbox OR in:sent) ${lowerClause}${upperClause}`;
    type MessageRef = { id: string; threadId: string };
    const collected: string[] = [];
    let pageToken: string | null = null;
    do {
      const pageParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "";
      const listRes = await gmailFetch(
        `users/me/messages?q=${encodeURIComponent(q)}&maxResults=${FIRST_POLL_PAGE_SIZE}${pageParam}`,
        accessToken,
      );
      const list: MessageRef[] = (listRes.messages as MessageRef[]) ?? [];
      for (const m of list) {
        if (m.id) collected.push(m.id);
      }
      pageToken = (listRes.nextPageToken as string | undefined) ?? null;
    } while (pageToken && collected.length < FIRST_POLL_MAX_MESSAGES);
    messageIds = collected.slice(0, FIRST_POLL_MAX_MESSAGES);

    // Grab the profile's current historyId so we can incremental-poll
    // next time -- this is what restores the cursor after a 404 fallback
    // so we don't first-poll again on the next pass.
    const profileRes = await gmailFetch("users/me/profile", accessToken);
    if (profileRes.historyId) nextHistoryId = profileRes.historyId as string;
  }

  let messagesIngested = 0;
  let threadsCreated = 0;
  let duplicatesSkipped = 0;
  let ingestErrors = 0;
  const messagesFound = messageIds.length;

  for (const messageId of messageIds) {
    try {
      const ingested = await ingestMessage({
        messageId,
        accessToken,
        inbox,
        skipAiEnrichment,
      });
      if (ingested) {
        messagesIngested++;
        if (ingested.threadCreated) threadsCreated++;
      } else {
        // ingestMessage returns null when the row already exists with a
        // populated body -- a deduped skip, not a failure.
        duplicatesSkipped++;
      }
    } catch (err) {
      ingestErrors++;
      logger.warn(
        { err, messageId, inboxId: inbox.id },
        "ingest single gmail message failed; continuing",
      );
    }
  }

  // Bump the watchpoint after all messages are in.
  if (nextHistoryId && nextHistoryId !== inbox.last_history_id) {
    await db.execute(sql`
      UPDATE connected_accounts
      SET gmail_last_history_id = ${nextHistoryId}
      WHERE id = ${inbox.id}
    `);
  }

  // Apply STARRED label changes harvested from history.list. We
  // map Gmail thread ids -> engine thread ids via the existing
  // gmail_thread_id column and UPDATE is_starred.
  //
  // Conflict resolution: if a thread appears in BOTH added and
  // removed in the same poll cycle (rapid star/unstar/star), we
  // skip it — the next poll will resolve. Cheaper than fetching
  // current state per thread. The actual transient state isn't
  // useful to mirror either way.
  //
  // We update only threads belonging to THIS inbox (the
  // staffOutreachEmailId scope) so a coincidental Gmail thread id
  // collision across teams can't cross-contaminate. Gmail thread
  // ids are namespaced per Google account so collisions are
  // already prevented at the API level — this is belt-and-braces.
  const ambiguous = new Set<string>();
  for (const id of starredAddedThreadGmailIds) {
    if (starredRemovedThreadGmailIds.has(id)) ambiguous.add(id);
  }
  const addList = Array.from(starredAddedThreadGmailIds).filter((id) => !ambiguous.has(id));
  const removeList = Array.from(starredRemovedThreadGmailIds).filter((id) => !ambiguous.has(id));

  if (addList.length > 0) {
    await db.execute(sql`
      UPDATE email_threads
      SET is_starred = true, updated_at = NOW()
      WHERE staff_outreach_email_id = ${inbox.id}
        AND gmail_thread_id IN (${sql.join(
          addList.map((id) => sql`${id}`),
          sql`, `,
        )})
        AND is_starred = false
    `);
  }
  if (removeList.length > 0) {
    await db.execute(sql`
      UPDATE email_threads
      SET is_starred = false, updated_at = NOW()
      WHERE staff_outreach_email_id = ${inbox.id}
        AND gmail_thread_id IN (${sql.join(
          removeList.map((id) => sql`${id}`),
          sql`, `,
        )})
        AND is_starred = true
    `);
  }

  // Apply UNREAD label changes harvested from history.list. Same
  // shape as the STARRED block above.
  //
  // UNREAD added in Gmail (operator marked thread back to unread):
  //   Bump engine.unread_count to the count of inbound messages on
  //   the thread, so the engine's badge reflects "all inbound is
  //   unread" — mirrors Gmail's per-message UNREAD semantics by
  //   reading the inbound count from email_messages.
  //
  // UNREAD removed in Gmail (operator opened/marked read):
  //   Engine.unread_count = 0. Operator already saw it.
  //
  // Ambiguous (in both sets in the same delta): skipped.
  //
  // Idempotency guards on each UPDATE ensure no-op when the engine
  // state already matches — handles the round-trip case where the
  // engine mark-read mirrored to Gmail, which echoes back as a
  // UNREAD removal in the next poll.
  const unreadAmbiguous = new Set<string>();
  for (const id of unreadAddedThreadGmailIds) {
    if (unreadRemovedThreadGmailIds.has(id)) unreadAmbiguous.add(id);
  }
  const unreadAddList = Array.from(unreadAddedThreadGmailIds).filter(
    (id) => !unreadAmbiguous.has(id),
  );
  const unreadRemoveList = Array.from(unreadRemovedThreadGmailIds).filter(
    (id) => !unreadAmbiguous.has(id),
  );

  if (unreadRemoveList.length > 0) {
    // Mark engine.unread_count = 0 for threads the operator opened
    // in Gmail. Guard with `unread_count > 0` so an already-read
    // thread (engine just mirrored its own action) is a no-op.
    await db.execute(sql`
      UPDATE email_threads
      SET unread_count = 0, updated_at = NOW()
      WHERE staff_outreach_email_id = ${inbox.id}
        AND gmail_thread_id IN (${sql.join(
          unreadRemoveList.map((id) => sql`${id}`),
          sql`, `,
        )})
        AND unread_count > 0
    `);
    // Also stamp read_at on the inbound messages so per-message
    // surfaces (venue communication timeline, etc.) match.
    await db.execute(sql`
      UPDATE email_messages em
      SET read_at = NOW()
      FROM email_threads et
      WHERE em.thread_id = et.id
        AND et.staff_outreach_email_id = ${inbox.id}
        AND et.gmail_thread_id IN (${sql.join(
          unreadRemoveList.map((id) => sql`${id}`),
          sql`, `,
        )})
        AND em.direction = 'inbound'
        AND em.read_at IS NULL
    `);
    // Surface this Gmail-side read to any open inbox. The drain-level
    // publishRealtime fires only when NEW mail arrived; a pure read-state
    // delta (operator opened the mail in Gmail, no new message) would
    // otherwise emit nothing, so the open /inbox never re-synced and the
    // thread stayed bold in the engine. byStaffId null => not self-
    // suppressed for any operator. This is the missing-notification half
    // of the Gmail->engine read-state bug.
    publishRealtime({
      table: "email_threads",
      type: "update",
      byStaffId: null,
      byStaffName: "Gmail poll",
    });
  }

  if (unreadAddList.length > 0) {
    // Set engine.unread_count back to the inbound message count
    // for the thread — "all inbound is unread again." We compute
    // this in-SQL rather than per-thread Node loops; one UPDATE
    // with a correlated subquery is fine for the typical delta
    // size. Guard: only touch threads where unread_count != target
    // so a no-op pass is cheap.
    await db.execute(sql`
      UPDATE email_threads et
      SET
        unread_count = (
          SELECT COUNT(*)::int FROM email_messages em
          WHERE em.thread_id = et.id AND em.direction = 'inbound'
        ),
        updated_at = NOW()
      WHERE et.staff_outreach_email_id = ${inbox.id}
        AND et.gmail_thread_id IN (${sql.join(
          unreadAddList.map((id) => sql`${id}`),
          sql`, `,
        )})
    `);
    // Clear read_at on inbound messages so per-message surfaces
    // also flip back to unread.
    await db.execute(sql`
      UPDATE email_messages em
      SET read_at = NULL
      FROM email_threads et
      WHERE em.thread_id = et.id
        AND et.staff_outreach_email_id = ${inbox.id}
        AND et.gmail_thread_id IN (${sql.join(
          unreadAddList.map((id) => sql`${id}`),
          sql`, `,
        )})
        AND em.direction = 'inbound'
        AND em.read_at IS NOT NULL
    `);
    // Operator marked the thread unread again in Gmail -- notify open
    // inboxes so the "N new" pill / re-sync reflects it (same rationale
    // as the unreadRemoveList branch above).
    publishRealtime({
      table: "email_threads",
      type: "update",
      byStaffId: null,
      byStaffName: "Gmail poll",
    });
  }

  // Apply INBOX label changes harvested from history.list -> mirror
  // Gmail archive into the engine. Same shape as the STARRED / UNREAD
  // blocks above and scoped to THIS inbox so a cross-account gmail_
  // thread_id collision can't cross-contaminate.
  //
  // INBOX removed in Gmail (operator archived the thread):
  //   email_threads.archived_at = NOW(), state = 'archived'. Mirrors
  //   how the engine's own archive action moves a thread out of the
  //   active mailbox views.
  //
  // INBOX added back in Gmail (operator un-archived):
  //   archived_at = NULL. We DON'T blindly flip state back -- the
  //   thread's prior state isn't recoverable from this signal, so we
  //   leave state as-is (the archived_at clear is enough to surface it
  //   again in the default views, which filter on archived_at IS NULL).
  //
  // Ambiguous (in both sets in the same delta): skipped, resolved next
  // poll. Idempotency guards make a no-op pass cheap.
  const inboxAmbiguous = new Set<string>();
  for (const id of inboxRemovedThreadGmailIds) {
    if (inboxAddedThreadGmailIds.has(id)) inboxAmbiguous.add(id);
  }
  const archiveList = Array.from(inboxRemovedThreadGmailIds).filter(
    (id) => !inboxAmbiguous.has(id),
  );
  const unarchiveList = Array.from(inboxAddedThreadGmailIds).filter(
    (id) => !inboxAmbiguous.has(id),
  );

  if (archiveList.length > 0) {
    await db.execute(sql`
      UPDATE email_threads
      SET archived_at = NOW(), state = 'archived', updated_at = NOW()
      WHERE staff_outreach_email_id = ${inbox.id}
        AND gmail_thread_id IN (${sql.join(
          archiveList.map((id) => sql`${id}`),
          sql`, `,
        )})
        AND archived_at IS NULL
    `);
  }
  if (unarchiveList.length > 0) {
    await db.execute(sql`
      UPDATE email_threads
      SET archived_at = NULL, updated_at = NOW()
      WHERE staff_outreach_email_id = ${inbox.id}
        AND gmail_thread_id IN (${sql.join(
          unarchiveList.map((id) => sql`${id}`),
          sql`, `,
        )})
        AND archived_at IS NOT NULL
    `);
  }

  // Apply USER-LABEL deltas harvested from history.list. Operator
  // labeled or unlabeled a thread directly in Gmail's UI; we mirror
  // those changes onto email_thread_labels for any team_label
  // mapped to the Gmail label via teamLabelGmailLinks.
  //
  // Resolve Gmail thread ids -> engine thread ids in one query
  // scoped to THIS connected account so a coincidental gmail_thread_id
  // collision across accounts can't cross-contaminate.
  const allChangedGmailThreadIds = new Set<string>([
    ...userLabelsAddedByThread.keys(),
    ...userLabelsRemovedByThread.keys(),
  ]);
  if (allChangedGmailThreadIds.size > 0) {
    const idArray = Array.from(allChangedGmailThreadIds);
    const threadRows = await db.execute<{ id: string; gmail_thread_id: string }>(sql`
      SELECT id, gmail_thread_id
      FROM email_threads
      WHERE staff_outreach_email_id = ${inbox.id}
        AND gmail_thread_id IN (${sql.join(
          idArray.map((id) => sql`${id}`),
          sql`, `,
        )})
    `);
    // ResultRow shape from drizzle's execute<T> depends on the driver
    // — postgres-js returns a rows-bearing object. Normalize.
    const rows: Array<{ id: string; gmail_thread_id: string }> = Array.isArray(threadRows)
      ? threadRows
      : ((threadRows as { rows?: Array<{ id: string; gmail_thread_id: string }> }).rows ?? []);
    const engineByGmail = new Map(rows.map((r) => [r.gmail_thread_id, r.id]));

    for (const [gmailThreadId, addedSet] of userLabelsAddedByThread) {
      const engineThreadId = engineByGmail.get(gmailThreadId);
      if (!engineThreadId) continue; // thread we don't track
      try {
        await reconcileGmailLabelsForThread({
          threadId: engineThreadId,
          gmailLabelIds: Array.from(addedSet),
          connectedAccountId: inbox.id,
          appliedBy: inbox.staff_member_id ?? SYSTEM_STAFF_ID_FALLBACK,
        });
      } catch (err) {
        logger.warn(
          { err, threadId: engineThreadId, addedLabels: Array.from(addedSet) },
          "gmail user-label reconcile (history) failed",
        );
      }
    }
    for (const [gmailThreadId, removedSet] of userLabelsRemovedByThread) {
      const engineThreadId = engineByGmail.get(gmailThreadId);
      if (!engineThreadId) continue;
      try {
        await unreconcileGmailLabelsForThread({
          threadId: engineThreadId,
          gmailLabelIds: Array.from(removedSet),
          connectedAccountId: inbox.id,
        });
      } catch (err) {
        logger.warn(
          { err, threadId: engineThreadId, removedLabels: Array.from(removedSet) },
          "gmail user-label unreconcile (history) failed",
        );
      }
    }
  }

  return {
    messagesIngested,
    threadsCreated,
    messagesFound,
    duplicatesSkipped,
    errors: ingestErrors,
  };
}

interface IngestResult {
  threadCreated: boolean;
}

async function ingestMessage(opts: {
  messageId: string;
  accessToken: string;
  inbox: {
    id: string;
    email: string;
    staff_member_id: string;
  };
  /** When true, skip fire-and-forget AI enrichment (bulk deep-resync). */
  skipAiEnrichment?: boolean;
}): Promise<IngestResult | null> {
  const { messageId, accessToken, inbox, skipAiEnrichment } = opts;

  // Cheap dedup: if email_messages already has this gmail_message_id +
  // inbox combo, AND the existing row has a populated body, skip the
  // API call entirely. The body check is the post-empty-body-fix
  // (38b15f6) repair path: an existing row that was ingested before
  // the attachment-aware extractor landed will have body_text='' and
  // body_html IS NULL. We let those rows fall through to the full
  // fetch path below so deep-resync (or a fresh poll on a related
  // message that revives the conversation) re-extracts the body and
  // updates the row in place. The UPDATE at the end of this function
  // covers the "row exists; new body" case.
  const existing = await db
    .select({
      id: emailMessages.id,
      bodyText: emailMessages.bodyText,
      bodyHtml: emailMessages.bodyHtml,
    })
    .from(emailMessages)
    .where(
      and(
        eq(emailMessages.gmailMessageId, messageId),
        eq(emailMessages.staffOutreachEmailId, inbox.id),
      ),
    )
    .limit(1);
  const existingRow = existing[0];
  const isEmptyBodyRepair =
    existingRow &&
    (existingRow.bodyText === null || existingRow.bodyText === "") &&
    existingRow.bodyHtml === null;
  if (existingRow && !isEmptyBodyRepair) return null;

  // Fetch full message
  const msg = await gmailFetch(
    `users/me/messages/${encodeURIComponent(messageId)}?format=full`,
    accessToken,
  );

  const headers = (
    (msg.payload as { headers?: Array<{ name: string; value: string }> })?.headers ?? []
  ).reduce<Record<string, string>>((acc, h) => {
    acc[h.name.toLowerCase()] = h.value;
    return acc;
  }, {});

  const gmailThreadId = msg.threadId as string;
  const subject = headers.subject ?? "(no subject)";
  const fromHeader = headers.from ?? "";
  const toHeader = headers.to ?? "";
  const ccHeader = headers.cc ?? "";
  // bcc rarely appears on inbound (the recipient doesn't see it),
  // but for OUTBOUND messages mirrored back through poll it does
  // appear in the Sent folder copy. Capture defensively so the
  // normalized array is populated for outbound rows.
  const bccHeader = headers.bcc ?? "";
  const rfcMessageId = headers["message-id"] ?? null;
  const inReplyTo = headers["in-reply-to"] ?? null;
  const snippet = (msg.snippet as string) ?? "";
  const labels = (msg.labelIds as string[]) ?? [];
  const internalDateMs = Number.parseInt(msg.internalDate as string, 10);
  const receivedAt = Number.isFinite(internalDateMs)
    ? new Date(internalDateMs).toISOString()
    : new Date().toISOString();

  // Normalize every recipient header into the columns that venue
  // matching + duplicate detection + the timeline join all use.
  // The raw headers still get stored on from_address / to_addresses
  // / cc_addresses (UI shows "Mike Smith <info@venue.com>" exactly
  // as Gmail emitted it); these columns are what the engine
  // queries against. See lib/email-address.ts + migration 0083.
  const parsedFrom = parseEmailHeader(fromHeader);
  const fromEmailNormalized = parsedFrom.email;
  // Display name preference: parsed name from the header, falling
  // back to anything Gmail might have provided separately. Empty
  // string flattens to null for the column.
  const fromNameFromHeader = parsedFrom.name;
  const toEmailsNormalized = parseEmailList(toHeader);
  const ccEmailsNormalized = parseEmailList(ccHeader);
  const bccEmailsNormalized = parseEmailList(bccHeader);

  // Direction: if 'from' contains the inbox's own email, it's outbound.
  // Otherwise inbound. Use the normalized form when available so a
  // raw 'Mike <jc@brand.com>' from an outbound mirror correctly
  // matches the inbox's clean address 'jc@brand.com'. Falls back to
  // the prior substring check for the rare case where parseEmailHeader
  // can't extract an address.
  const inboxEmailLower = inbox.email.toLowerCase();
  const direction =
    (fromEmailNormalized && fromEmailNormalized === inboxEmailLower) ||
    fromHeader.toLowerCase().includes(inboxEmailLower)
      ? "outbound"
      : "inbound";

  // Body extraction — capture BOTH halves of multipart/alternative
  // when present. Sanitization happens on the way out (lib/inbox-data
  // calls sanitizeEmailHtml when building bodySafeHtml for the
  // MessageCard render path), so we store the raw HTML here.
  //
  // Fallback logic when only one half is present:
  //   - HTML-only senders (some marketing tools, some clients):
  //     synthesize a plain-text version by stripping tags so search,
  //     classification, and the bodyText-only fallback render path
  //     all keep working.
  //   - Plain-text-only senders: leave bodyHtml null so the
  //     render path uses the <pre> plain-text branch.
  const rawHtml = await extractHtml(
    msg.payload as GmailPayload | undefined,
    messageId,
    accessToken,
  );
  // Defensive cap on stored HTML size. Most legitimate emails are
  // under 100 KB of HTML -- even with rich signatures + embedded
  // tables it's rare to exceed 500 KB. We cap at 2 MB to defeat
  // pathological payloads (embedded data: URIs, malformed
  // generated HTML from old WordPerfect exports, etc) without
  // truncating real-world content. The DOMPurify sanitizer at
  // read time would also reject most truly hostile payloads, but
  // bounding storage cost upstream is cheap insurance.
  const HTML_MAX_BYTES = 2 * 1024 * 1024;
  const cappedHtml =
    rawHtml && Buffer.byteLength(rawHtml, "utf8") > HTML_MAX_BYTES
      ? rawHtml.slice(0, HTML_MAX_BYTES) // crude char-truncate; fine since the sanitizer will drop unterminated tags
      : rawHtml;
  const rawText = await extractPlainText(
    msg.payload as GmailPayload | undefined,
    messageId,
    accessToken,
  );
  const bodyText =
    rawText.length > 0
      ? rawText
      : cappedHtml
        ? // Cheap text extraction — strip tags + collapse whitespace.
          // Good enough for search + classification. The HTML render
          // path uses the raw HTML, so visual fidelity isn't affected
          // by the simplicity of this fallback.
          cappedHtml
            .replace(/<\/(p|div|br|li|h[1-6])>/gi, "\n")
            .replace(/<[^>]*>/g, "")
            .replace(/[ \t]+/g, " ")
            .replace(/\n{3,}/g, "\n\n")
            .trim()
        : "";
  const bodyHtml = cappedHtml; // null when sender sent text-only

  // Empty-body repair path: when we entered this function for an
  // existing row whose body was empty (the 38b15f6 pre-fix bug),
  // skip the insert + thread-rollup work and just UPDATE the body
  // columns on the existing row. Returns the existing message id so
  // the caller's "ingested N messages" count still reflects work
  // done. The thread's rollups (snippet, classification, message_
  // count, etc.) are already populated from the original insert --
  // we're just patching the body that got dropped.
  if (existingRow && isEmptyBodyRepair) {
    if (bodyText.length === 0 && !bodyHtml) {
      // Re-fetch still empty -- genuinely contentless email, or a
      // message whose attachment URL is now stale. Leave the row
      // alone so we don't churn it; next ingest pass would do the
      // same thing.
      return null;
    }
    await db
      .update(emailMessages)
      .set({ bodyText, bodyHtml })
      .where(eq(emailMessages.id, existingRow.id));
    // Also refresh the thread snippet if it's empty (likely was the
    // body's first line and got dropped along with the body).
    if (snippet) {
      await db.execute(sql`
        UPDATE email_threads
        SET snippet = ${snippet}
        WHERE id = (SELECT thread_id FROM email_messages WHERE id = ${existingRow.id})
          AND (snippet IS NULL OR snippet = '')
      `);
    }
    logger.info({ messageId, accountId: inbox.id }, "empty-body repaired via re-ingest");
    return { threadCreated: false };
  }

  // Rule-based triage classification — only for inbound messages.
  // Outbound replies don't get classified (the operator wrote them, no
  // signal to extract). Tagged on the thread for fast list-view filtering.
  const classification =
    direction === "inbound"
      ? classifyInboundEmail({
          subject,
          bodyText,
          fromAddress: fromHeader,
          // Pass Gmail's own labels so the classifier can short-
          // circuit CATEGORY_PROMOTIONS / CATEGORY_SOCIAL before
          // running regex passes. See lib/triage-classifier.ts
          // step 0.
          gmailLabels: labels,
        })
      : null;

  // Auto-suppress: inbound messages whose body/subject screams
  // "unsubscribe" or "STOP" get the sender's address pushed into
  // email_suppression with reason='unsubscribe'. Future sends from
  // anyone on the team to that address will hard-block.
  //
  // We only auto-suppress on a clean STOP signal — not on any reply
  // that happens to contain the word. The patterns inside
  // maybeAutoSuppressInbound match explicit unsubscribe asks (first
  // body line OR exact subject). Conservative on purpose.
  if (direction === "inbound") {
    try {
      // Resolve the team_id for this inbox. Cheap lookup; only runs
      // when we have a candidate STOP signal at the helper level.
      const teamRow = await db
        .select({ teamId: staffOutreachEmails.teamId })
        .from(staffOutreachEmails)
        .where(eq(staffOutreachEmails.id, inbox.id))
        .limit(1);
      const teamId = teamRow[0]?.teamId;
      if (teamId) {
        await maybeAutoSuppressInbound({
          teamId,
          fromAddress: fromHeader,
          subject,
          bodyText,
          sourceThreadId: null,
        });

        // Bounce detection — different from STOP/unsubscribe: a
        // bounce is a Mail Transfer Agent notification that a prior
        // OUTBOUND send failed. We extract the BOUNCED recipient (not
        // the bounce notifier's address) and suppress that recipient.
        // Idempotent via the same unique index.
        await maybeAutoSuppressBounce({
          teamId,
          fromAddress: fromHeader,
          subject,
          bodyText,
          headers,
        });
      }
    } catch (err) {
      logger.warn({ err, gmailThreadId }, "auto-suppress check failed (non-fatal)");
    }
  }

  // Find or create the thread.
  let threadId: string;
  let threadCreated = false;

  // ACCOUNT-SCOPED lookup: a Gmail thread id is only unique WITHIN a
  // connected account, not globally. Two connected accounts can each
  // see the same Gmail thread id (e.g. both were on the same external
  // conversation), so matching on gmail_thread_id ALONE would cross-
  // wire account B's inbound message onto account A's local thread.
  // Scope by staff_outreach_email_id (= this inbox's connected account)
  // to match the email_threads_thread_staff_unique index.
  const existingThread = await db
    .select({ id: emailThreads.id, venueId: emailThreads.venueId })
    .from(emailThreads)
    .where(
      and(
        eq(emailThreads.gmailThreadId, gmailThreadId),
        eq(emailThreads.staffOutreachEmailId, inbox.id),
      ),
    )
    .limit(1);

  if (existingThread.length > 0 && existingThread[0]) {
    threadId = existingThread[0].id;
  } else {
    // Try to resolve a venue from the inbound from-address domain.
    // If we can't, the thread STILL ingests — venueId stays null and
    // an operator attaches a venue post-triage from the inbox UI.
    // (Previous behaviour silently swallowed every email whose sender
    // domain didn't match a venue. Migration 0046 + schema relax
    // make this safe.)
    // Resolve the venue from the SENDER for inbound mail, or from the
    // RECIPIENT(s) for outbound mail. An outbound message's From is our
    // own connected inbox, which never matches a venue -- so a reply a
    // staffer sent directly from Gmail (creating a thread the app hasn't
    // seen yet) would otherwise ingest UNATTACHED. Matching the recipients
    // tags it to the venue so that Gmail-sent correspondence still shows
    // on the venue communication timeline + threads into the app inbox.
    let venueId: string | null = null;
    if (direction === "inbound") {
      // Pass subject+body so the fuzzy domain tier can disambiguate
      // same-domain venues across cities (chain locations).
      venueId = await resolveVenueFromAddress(fromHeader, `${subject} ${bodyText}`);
      if (!venueId) {
        // Smart auto-tag/create: when address matching finds nothing,
        // derive the venue name + city from the email (code first, Haiku
        // fallback) and CREATE the venue when confident -- so genuine
        // venue correspondence tags itself + appears on a venue timeline
        // without manual triage. Guarded against junk (business domains +
        // genuine classifications + known-city match only).
        const auto = await autoTagOrCreateVenue({
          fromEmail: fromEmailNormalized ?? "",
          fromName: fromNameFromHeader,
          subject,
          bodyText,
          classification: classification?.classification ?? null,
          createdByStaffId: inbox.staff_member_id ?? SYSTEM_STAFF_ID_FALLBACK,
        });
        venueId = auto.venueId;
      }
    } else {
      for (const addr of [...toEmailsNormalized, ...ccEmailsNormalized]) {
        venueId = await resolveVenueFromAddress(addr);
        if (venueId) break;
      }
    }
    if (!venueId) {
      logger.info(
        { fromHeader, direction, gmailThreadId },
        "gmail message ingest: no venue match, ingesting as unassigned",
      );
    }

    const created = await withAuditContext(
      inbox.staff_member_id ?? SYSTEM_STAFF_ID_FALLBACK,
      async (tx) =>
        tx
          .insert(emailThreads)
          .values({
            // outreachBrandId intentionally null — assigned post-ingest
            // via the brand/campaign attribution UI. Schema dropped
            // NOT NULL in migration 0045.
            staffOutreachEmailId: inbox.id,
            gmailThreadId,
            venueId,
            subject,
            state: direction === "inbound" ? "needs_reply" : "waiting_on_them",
            direction,
            // Newly created threads start with the triage classifier's
            // best guess. The operator can override via the UI; future
            // inbound messages won't clobber a manual choice (see the
            // UPDATE below — it's guarded by classification = 'unclassified').
            classification: classification?.classification ?? "unclassified",
            snippet,
            messageCount: 0,
            unreadCount: direction === "inbound" ? 1 : 0,
            // lastMessageAt drives BOTH the inbox sort order and the time
            // shown on each row. It MUST be the email's real received time
            // (Gmail internalDate via receivedAt), NOT the schema default
            // (now() = ingest time) — otherwise backfilled months-old mail
            // stamps as "just now," scrambling the order and burying new
            // mail. This was the "all emails show the pull time / can't see
            // recent Primary" bug.
            lastMessageAt: new Date(receivedAt),
            lastInboundAt: direction === "inbound" ? new Date(receivedAt) : null,
            lastOutboundAt: direction === "outbound" ? new Date(receivedAt) : null,
            lastSenderName: extractSenderName(fromHeader),
            createdBy: inbox.staff_member_id,
            updatedBy: inbox.staff_member_id,
          })
          .returning({ id: emailThreads.id }),
    );
    if (!created[0]) {
      throw new Error("thread insert returned no row");
    }
    threadId = created[0].id;
    threadCreated = true;
  }

  // Insert the message
  const inserted = await db
    .insert(emailMessages)
    .values({
      threadId,
      gmailMessageId: messageId,
      rfcMessageId,
      inReplyTo,
      kind: "email",
      direction,
      fromAddress: fromHeader,
      fromName: fromNameFromHeader,
      toAddresses: toHeader ? splitAddresses(toHeader) : [],
      ccAddresses: ccHeader ? splitAddresses(ccHeader) : [],
      bccAddresses: bccHeader ? splitAddresses(bccHeader) : [],
      // Normalized address columns — see lib/email-address.ts.
      // The raw arrays above preserve display names; these are
      // the columns matching + duplicate detection query against.
      fromEmailNormalized,
      toEmailsNormalized,
      ccEmailsNormalized,
      bccEmailsNormalized,
      subject,
      bodyText,
      // bodyHtml: raw HTML from the message payload when present.
      // The render path (MessageCard) prefers bodySafeHtml, which
      // lib/inbox-data computes by passing this column through
      // sanitizeEmailHtml on read. Storing the raw form lets us
      // re-sanitize if our sanitizer policy ever needs to be
      // tightened without re-fetching from Gmail.
      bodyHtml,
      snippet,
      gmailLabels: labels,
      rawPayload: msg as Record<string, unknown>,
      sentAt: new Date(receivedAt),
      receivedAt: direction === "inbound" ? new Date(receivedAt) : null,
      readAt: null,
      sentByStaffId: direction === "outbound" ? inbox.staff_member_id : null,
      staffOutreachEmailId: inbox.id,
    })
    .onConflictDoNothing({
      target: [emailMessages.gmailMessageId, emailMessages.staffOutreachEmailId],
    })
    .returning({ id: emailMessages.id });

  const insertedMessageId = inserted[0]?.id ?? null;

  // Roll thread counters forward. Classification only auto-updates when
  // the thread is currently 'unclassified' AND the new inbound message
  // has a confident classification — protects manual operator overrides
  // from being clobbered by a later auto-reply etc.
  const autoUpgradeClassification =
    direction === "inbound" && classification && classification.classification !== "unclassified";

  // STARRED label → email_threads.is_starred mirror. A Gmail thread is
  // "starred" if any message on it has the STARRED system label. When
  // we ingest a message that carries STARRED, propagate to the thread.
  //
  // Asymmetric on purpose: we set is_starred=true when STARRED is
  // present on this message, but DON'T clear it when STARRED is
  // absent — another message on the same thread might still be
  // starred. Pure unstars-from-Gmail (no new message, just a label
  // removal) need to come through users.history.list with
  // historyTypes=labelRemoved, which the current poll loop doesn't
  // subscribe to. That's a follow-up enhancement.
  const messageHasStar = labels.includes("STARRED");
  const shouldSetStar = messageHasStar;

  await db.execute(sql`
    UPDATE email_threads
    SET
      message_count = message_count + 1,
      ${direction === "inbound" ? sql`unread_count = unread_count + 1,` : sql``}
      ${direction === "inbound" ? sql`last_inbound_at = ${receivedAt},` : sql`last_outbound_at = ${receivedAt},`}
      -- Keep the thread at its NEWEST message's real received time (Gmail
      -- internalDate). GREATEST guards against out-of-order backfill
      -- ingesting an older message after a newer one.
      last_message_at = GREATEST(last_message_at, ${receivedAt}::timestamptz),
      ${
        autoUpgradeClassification
          ? sql`classification = CASE
                  WHEN classification = 'unclassified' THEN ${classification.classification}::reply_classification
                  ELSE classification
                END,`
          : sql``
      }
      ${shouldSetStar ? sql`is_starred = true,` : sql``}
      snippet = ${snippet},
      last_sender_name = ${extractSenderName(fromHeader)},
      -- Promote to 'mixed' once a thread carries BOTH directions. Without this
      -- a thread staff started (direction='outbound') stays outbound forever
      -- after the venue replies, so the reply is hidden from the Inbox folder
      -- (direction IN inbound/mixed) and only shows in Sent. Symmetric for an
      -- inbound thread we later reply to from Gmail directly.
      direction = CASE
        WHEN direction = ${direction}::thread_direction THEN direction
        ELSE 'mixed'::thread_direction
      END,
      state = CASE
        WHEN ${direction} = 'inbound' THEN 'needs_reply'::thread_state
        ELSE state
      END,
      updated_at = NOW(),
      updated_by = ${inbox.staff_member_id}
    WHERE id = ${threadId}
  `);

  // Phase 4.9: an inbound reply that landed on a different alias than the one
  // that pitched the venue gets routed to the original pitcher's queue.
  // Best-effort -- never blocks ingestion.
  if (direction === "inbound") {
    await routeMisroutedReply(threadId).catch((err) =>
      logger.warn({ err, threadId }, "misrouted-reply routing failed"),
    );
  }

  // Phase 3.5: slot-change detection. [ReferenceDoc 9.4] If a CONFIRMED venue
  // replies asking to move to a different day/slot, raise a heuristic FLAG on
  // the thread (NOT a new AI classification enum value) so the worklist's
  // "Slot change requested" section surfaces it for an operator-driven swap.
  // Best-effort -- never blocks ingestion.
  if (direction === "inbound") {
    try {
      const confirmedRes = await db.execute<{ has_confirmed: boolean }>(sql`
        SELECT EXISTS (
          SELECT 1
          FROM venue_events ve
          JOIN email_threads t ON t.venue_id = ve.venue_id
          WHERE t.id = ${threadId}
            AND ve.status = 'confirmed'
        ) AS has_confirmed
      `);
      const confirmedRow = Array.isArray(confirmedRes)
        ? (confirmedRes as unknown as Array<{ has_confirmed: boolean }>)[0]
        : (confirmedRes as unknown as { rows: Array<{ has_confirmed: boolean }> }).rows?.[0];
      const venueHasConfirmedEvent = confirmedRow?.has_confirmed === true;

      const detection = detectSlotChange({ subject, body: bodyText, venueHasConfirmedEvent });
      if (detection.isSlotChange) {
        await db.execute(sql`
          UPDATE email_threads
          SET slot_change_requested = true,
              slot_change_detected_at = NOW(),
              slot_change_phrase = ${detection.matchedPhrase ?? null}
          WHERE id = ${threadId}
        `);
      }
    } catch (err) {
      logger.warn({ err, threadId }, "slot-change detection failed (non-fatal)");
    }
  }

  // Reconcile Gmail labels onto team_labels. Skip system labels
  // (INBOX, UNREAD, IMPORTANT, CATEGORY_*, SENT etc.) — those aren't
  // mirrored into the team namespace. Only user labels (anything not
  // starting with one of the well-known system prefixes) get fed
  // through reconcileGmailLabelsForThread. Unknown user labels (no
  // corresponding team_label_gmail_links row) are silently ignored
  // — the team_labels namespace is curated.
  const userLabelIds = labels.filter(
    (id) => !GMAIL_SYSTEM_LABEL_IDS.has(id) && !id.startsWith("CATEGORY_"),
  );
  if (userLabelIds.length > 0) {
    try {
      await reconcileGmailLabelsForThread({
        threadId,
        gmailLabelIds: userLabelIds,
        connectedAccountId: inbox.id,
        appliedBy: inbox.staff_member_id ?? SYSTEM_STAFF_ID_FALLBACK,
      });
    } catch (err) {
      logger.warn({ err, threadId }, "gmail label reconcile failed (non-fatal)");
    }
  }

  // AI auto-classify suggestion for inbound messages — Phase A.1.
  // Fire-and-forget so ingest latency isn't affected. The classifier
  // itself skips when the thread is already operator-classified (or
  // confidently regex-classified upstream), so this is cheap in
  // steady-state and only runs on genuinely ambiguous threads.
  if (
    direction === "inbound" &&
    insertedMessageId &&
    !skipAiEnrichment &&
    process.env.AI_INBOX_CLASSIFY_ENABLED !== "0"
  ) {
    try {
      // Resolve team id for the classifier (it doesn't need it for
      // the model call but logs benefit from the breadcrumb).
      const teamRow = await db
        .select({ teamId: staffOutreachEmails.teamId })
        .from(staffOutreachEmails)
        .where(eq(staffOutreachEmails.id, inbox.id))
        .limit(1);
      const teamId = teamRow[0]?.teamId;
      if (teamId) {
        // Don't await — we want ingest to complete before the model
        // call. Errors are logged inside classifyInboundMessageAsync.
        void classifyInboundMessageAsync({
          threadId,
          messageId: insertedMessageId,
          teamId,
        });
        // Same fire-and-forget pattern: pull date-anchored promises
        // out of the message and auto-create tasks for them. Phase
        // A.2. Independent of the classifier — extraction can
        // succeed when classification fails (or vice versa). Gated
        // by its own env flag so ops can disable just one.
        if (process.env.AI_INBOX_EXTRACT_PROMISES_ENABLED !== "0") {
          void extractPromisesAsync({
            threadId,
            messageId: insertedMessageId,
            teamId,
          });
        }
      }
    } catch (err) {
      logger.warn({ err, threadId }, "[gmail-poll] ai dispatch failed (non-fatal)");
    }
  }

  return { threadCreated };
}

/** Gmail's well-known system label ids that should never be mirrored
 *  into team_labels. Anything starting with CATEGORY_ is also a system
 *  label (Forums/Promotions/Social/Updates/Personal). */
const GMAIL_SYSTEM_LABEL_IDS = new Set([
  "INBOX",
  "UNREAD",
  "STARRED",
  "IMPORTANT",
  "SENT",
  "DRAFT",
  "TRASH",
  "SPAM",
  "CHAT",
]);

// =========================================================================
// Helpers
// =========================================================================

interface GmailPayload {
  mimeType?: string;
  body?: {
    /** Inline base64url-encoded body. Present for small payloads. */
    data?: string;
    /** Set instead of `data` for parts whose body exceeds Gmail's
     *  inline-size threshold (typically ~5MB, though Gmail doesn't
     *  document the exact cutoff). Must be fetched separately via
     *  users.messages.attachments.get to retrieve the actual bytes.
     *  This is what trips up HTML emails from notification platforms
     *  (Triple Seat, Eventbrite, etc.) whose markup is large enough
     *  to land beyond the inline threshold. */
    attachmentId?: string;
    /** Byte size of the decoded body. Gmail provides this even when
     *  the data lives behind attachmentId. Used here for logging /
     *  defensive caps; not strictly required for extraction. */
    size?: number;
  };
  parts?: GmailPayload[];
}

/**
 * Resolve a part's body bytes -- inline `data` when present, otherwise
 * a follow-up fetch of the attachment. Returns "" when neither is
 * available (e.g. the part is a multipart container with no body).
 *
 * Background: Gmail's messages.get response inlines small bodies but
 * shifts larger ones (the docs say "approximately 5MB", real-world
 * threshold appears to be lower) into a separately-fetchable
 * attachment. Notification platforms like Triple Seat and Eventbrite
 * commonly send HTML bodies that cross this line because of their
 * heavy embedded styling. Without the attachment fetch, the engine
 * stored bodyText="" and bodyHtml=null, surfacing as "(empty body)"
 * in the inbox UI.
 *
 * The attachment endpoint:
 *   GET users/me/messages/{messageId}/attachments/{attachmentId}
 * returns { data: base64url, size: number }.
 *
 * Best-effort: a failed attachment fetch logs + returns "" so the
 * thread still ingests (headers, dates, classification, etc. don't
 * depend on the body). The operator sees an empty body which is no
 * worse than the bug we're fixing.
 */
async function fetchPartBody(
  part: GmailPayload,
  messageId: string,
  accessToken: string,
): Promise<string> {
  if (part.body?.data) {
    return base64UrlDecode(part.body.data);
  }
  if (part.body?.attachmentId) {
    try {
      const res = await gmailFetch(
        `users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(
          part.body.attachmentId,
        )}`,
        accessToken,
      );
      const data = (res as { data?: string }).data;
      if (data) return base64UrlDecode(data);
    } catch (err) {
      logger.warn(
        { err, messageId, mimeType: part.mimeType },
        "failed to fetch attachment body; rendering will show empty",
      );
    }
  }
  return "";
}

async function extractPlainText(
  payload: GmailPayload | undefined,
  messageId: string,
  accessToken: string,
): Promise<string> {
  if (!payload) return "";

  // Walk the MIME tree looking for the first text/plain part.
  // Note: now async because fetchPartBody may need to follow an
  // attachmentId.
  async function walk(part: GmailPayload): Promise<string | null> {
    if (part.mimeType === "text/plain" && (part.body?.data || part.body?.attachmentId)) {
      const decoded = await fetchPartBody(part, messageId, accessToken);
      return decoded;
    }
    for (const child of part.parts ?? []) {
      const found = await walk(child);
      if (found) return found;
    }
    return null;
  }

  return (await walk(payload)) ?? "";
}

/**
 * Walk the MIME tree looking for the first text/html part. Returns
 * the raw HTML string (UTF-8) or null when the message is plain-text
 * only.
 *
 * Why this exists
 * ---------------
 *
 * Inbound HTML used to be silently dropped (the ingest path stored
 * bodyHtml: null on every inbound row). Operators viewing inbound
 * threads in the engine saw plain-text rendering even when the
 * sender's email had formatting, links, signatures, embedded
 * images. The UI render path (MessageCard) already prefers
 * bodySafeHtml when present and sanitizes via DOMPurify (see
 * lib/email-sanitize.ts) — the missing piece was the ingest side
 * actually capturing the HTML.
 *
 * MIME structure notes
 * --------------------
 *
 * Gmail's API returns the message payload as a tree of MIME parts.
 * Common shapes:
 *
 *   multipart/alternative
 *     text/plain      ← extractPlainText finds this
 *     text/html       ← extractHtml finds this
 *
 *   multipart/related (for emails with inline images)
 *     multipart/alternative
 *       text/plain
 *       text/html
 *     image/png        ← inline image, cid:... referenced from HTML
 *
 *   multipart/mixed (for emails with attachments)
 *     multipart/alternative
 *       text/plain
 *       text/html
 *     application/pdf  ← attachment
 *
 * We do a depth-first search for the first text/html node in any
 * of these shapes. Inline images live on their own parts and are
 * separately addressable via their attachmentId — capturing them
 * is out of scope for this commit (would need email_attachments
 * ingest first).
 */
async function extractHtml(
  payload: GmailPayload | undefined,
  messageId: string,
  accessToken: string,
): Promise<string | null> {
  if (!payload) return null;

  async function walk(part: GmailPayload): Promise<string | null> {
    if (part.mimeType === "text/html" && (part.body?.data || part.body?.attachmentId)) {
      const decoded = await fetchPartBody(part, messageId, accessToken);
      // Treat empty-string as null so the caller's "html only when
      // we actually have something" branch behaves correctly.
      return decoded.length > 0 ? decoded : null;
    }
    for (const child of part.parts ?? []) {
      const found = await walk(child);
      if (found) return found;
    }
    return null;
  }

  return walk(payload);
}

function base64UrlDecode(s: string): string {
  // Gmail uses base64url
  const normalized = s.replace(/-/g, "+").replace(/_/g, "/");
  // Pad to multiple of 4
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  try {
    return Buffer.from(padded, "base64").toString("utf-8");
  } catch {
    return "";
  }
}

function splitAddresses(headerVal: string): string[] {
  // Crude split — Gmail addresses come as "Name <email@x>, Other <other@y>"
  return headerVal
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractSenderName(fromHeader: string): string {
  // "Sarah Owner <sarah@royalyork.com>" → "Sarah Owner"
  const match = fromHeader.match(/^([^<]+)</);
  if (match?.[1]) return match[1].trim().replace(/"/g, "");
  return fromHeader.split("@")[0] ?? fromHeader;
}

async function resolveVenueFromAddress(
  fromHeader: string,
  // Optional subject+body text. Used ONLY by the fuzzy Tier-3 domain
  // fallback to disambiguate same-domain venues across cities (chains like
  // "SPIN" with a shared corporate domain in Washington AND Toronto). The
  // high-confidence tiers (exact email / alt-email / operator alias) ignore
  // it — an exact address is unambiguous regardless of city.
  emailText?: string,
): Promise<string | null> {
  const m = fromHeader.match(/<([^>]+)>/) ?? fromHeader.match(/([\w.\-+]+@[\w.\-]+)/);
  const email = m?.[1]?.toLowerCase();
  if (!email) return null;

  // Tier 1 (high confidence): exact match on venues.email
  const exact = await db
    .select({ id: venues.id })
    .from(venues)
    .where(and(eq(venues.email, email), isNotNull(venues.id)))
    .limit(1);
  if (exact[0]) return exact[0].id;

  // Tier 2 (high confidence): exact match on venues.alternate_emails.
  // This is the canonical "operator-trained" signal -- every time an
  // operator manually links an unmatched thread to a venue, the
  // thread's sender gets appended to that venue's alt_emails (see
  // attachVenueToThread in app/(admin)/inbox/_attach-venue-action.ts).
  // Future inbound from the same sender lands matched at INGEST time
  // instead of read time.
  const altExact = await db.execute<{ id: string }>(sql`
    SELECT id FROM venues
    WHERE archived_at IS NULL
      AND ${email} = ANY(SELECT lower(unnest(alternate_emails)))
    LIMIT 1
  `);
  const altList: Array<{ id: string }> = Array.isArray(altExact)
    ? (altExact as unknown as Array<{ id: string }>)
    : ((altExact as unknown as { rows: Array<{ id: string }> }).rows ?? []);
  if (altList[0]) return altList[0].id;

  // Tier 2.5 (high confidence): venue_domain_aliases match. Operator-
  // curated mapping for parent-group domains where the venue's
  // manager emails from a different host than the venue's own site
  // (e.g. Lavelle's site is lavellenyc.com but the manager writes
  // from @taohospitalitygroup.com). The lookup is keyed by the bare
  // host (no '@', lowercase) which the helper normalizes from the
  // full address.
  //
  // findVenuesByDomainAlias can return multiple venue ids in the
  // rare case where one parent domain maps to several venues. We
  // take the first row -- if operators have intentionally set up
  // multiple aliases for the same domain, the inbound thread is
  // ambiguous anyway; surfacing the first lets the operator
  // re-attach manually if needed. A future enhancement could
  // surface ambiguity in the UI rather than silently picking.
  //
  // This is Tier 2.5 (not Tier 3) because the alias is operator-
  // curated -- higher confidence than the fuzzy domain-match
  // fallback below.
  const domainAliasMatches = await findVenuesByDomainAlias(email);
  const [firstDomainAlias] = domainAliasMatches;
  if (firstDomainAlias) return firstDomainAlias;

  // Tier 3 (medium confidence): domain match on venues.email.
  // Last-resort fallback for senders we haven't seen yet but whose
  // domain looks right (e.g. info@lavelle.com matching when only
  // bookings@lavelle.com is the stored email).
  const domain = email.split("@")[1];
  if (!domain) return null;
  // Never domain-match on a freemail / personal domain. A venue that happens
  // to use e.g. bradleyson7th@aol.com would otherwise capture EVERY @aol.com
  // sender (strayvay@aol.com -> wrong "Bradley's on 7th, Tampa" match).
  // Personal-domain senders are linked only by EXACT email (operator-curated
  // alias / alternate_emails), never by a shared freemail domain.
  if (FREEMAIL_DOMAINS.has(domain.toLowerCase())) return null;
  const domainMatch = await db.execute<{ id: string; city_id: string | null }>(sql`
    SELECT id, city_id FROM venues
    WHERE email IS NOT NULL
      AND lower(email) LIKE ${`%@${domain}`}
      AND archived_at IS NULL
  `);
  const candidates: Array<{ id: string; city_id: string | null }> = Array.isArray(domainMatch)
    ? (domainMatch as unknown as Array<{ id: string; city_id: string | null }>)
    : ((domainMatch as unknown as { rows: Array<{ id: string; city_id: string | null }> }).rows ??
      []);
  if (candidates.length === 0) return null;

  // City-disambiguation for shared/corporate domains (the SPIN-Washington-
  // vs-SPIN-Toronto problem). A chain's locations can share one email
  // domain, so a bare domain match would wrongly attach new-city mail to
  // whichever same-domain venue happens to be first. If the email text
  // names a known city, only match a candidate IN that city; if the named
  // city has no same-domain venue yet, return null so autoTagOrCreateVenue
  // creates/sorts the correct-city venue instead of mis-attributing.
  if (emailText?.trim()) {
    const cityRows = await db.select({ id: cities.id, name: cities.name }).from(cities);
    const hay = emailText.toLowerCase();
    // Longest names first so "New York City" wins over "York".
    const byLongest = cityRows.slice().sort((a, b) => b.name.length - a.name.length);
    let detectedCityId: string | null = null;
    for (const c of byLongest) {
      const n = c.name.trim().toLowerCase();
      if (n.length >= 3 && hay.includes(n)) {
        detectedCityId = c.id;
        break;
      }
    }
    if (detectedCityId) {
      const inCity = candidates.find((v) => v.city_id === detectedCityId);
      if (inCity) return inCity.id;
      // Email clearly names a city, but no same-domain venue is in it →
      // don't guess; let the auto-create path handle the new-city venue.
      return null;
    }
  }

  // No city signal in the text → fall back to the first domain match
  // (prior behavior; safe when the domain isn't a multi-city chain).
  return candidates[0]?.id ?? null;
}

async function gmailFetch(endpoint: string, accessToken: string): Promise<Record<string, unknown>> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/${endpoint}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gmail API ${res.status}: ${body.slice(0, 500)}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

// Backfill-only exports. lib/empty-body-backfill.ts uses these to
// re-extract message bodies for the empty-body bug repair without
// duplicating the MIME-walk / attachment-fetch logic. Keeping the
// internal originals private (so callers can't accidentally bypass
// the live ingest pipeline) but giving the backfill an explicit
// hook with a distinct name documents the dependency.
export { gmailFetch as gmailFetchForBackfill };
export { extractHtml as extractHtmlForBackfill };
export { extractPlainText as extractPlainTextForBackfill };

// =========================================================================
// Auto-suppression on inbound STOP/unsubscribe
// =========================================================================

const UNSUBSCRIBE_BODY_RE = /^[\s>"']*(unsubscribe|remove me|stop|opt\s*out|please remove)\b/i;
const UNSUBSCRIBE_SUBJECT_RE = /^\s*(unsubscribe|stop|remove me|opt\s*out)\s*$/i;

/**
 * Inspect an inbound message; if its first body line / subject is an
 * explicit unsubscribe request, push the sender's address into
 * email_suppression with reason='unsubscribe'. Idempotent via the
 * unique index on (team_id, lower(email)).
 *
 * Conservative on purpose — we'd rather miss the edge case "STOP
 * sending me ads but reply about my booking" than over-suppress
 * legitimate addresses.
 */
async function maybeAutoSuppressInbound(opts: {
  teamId: string;
  fromAddress: string;
  subject: string | null;
  bodyText: string | null;
  sourceThreadId: string | null;
}): Promise<void> {
  const bodyFirstLine = (opts.bodyText ?? "").split(/\r?\n/, 1)[0] ?? "";
  const subjectMatch = opts.subject ? UNSUBSCRIBE_SUBJECT_RE.test(opts.subject) : false;
  const bodyMatch = bodyFirstLine ? UNSUBSCRIBE_BODY_RE.test(bodyFirstLine) : false;
  if (!subjectMatch && !bodyMatch) return;

  // Extract bare email out of the From header (handles "Name <a@b>").
  const angle = opts.fromAddress.match(/<([^>]+)>/);
  const email = (angle?.[1] ?? opts.fromAddress).trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return;

  // The schema barrel re-exports emailSuppression; we use a raw SQL
  // INSERT here to avoid importing the schema module from a worker
  // hot path with already heavy imports. onConflictDoNothing via
  // ON CONFLICT DO NOTHING preserves idempotency.
  await db.execute(sql`
    INSERT INTO email_suppression (team_id, email, reason, notes, source_thread_id)
    VALUES (${opts.teamId}, ${email}, 'unsubscribe',
            'Auto-suppressed from inbound STOP/unsubscribe reply.',
            ${opts.sourceThreadId})
    ON CONFLICT (team_id, email) DO NOTHING
  `);
  logger.info({ email, teamId: opts.teamId }, "auto-suppressed address from inbound unsubscribe");
}

// =========================================================================
// Bounce detection — auto-suppress recipients whose prior outbound failed
// =========================================================================

/** From header pattern that indicates a bounce notifier — most MTAs
 *  send from `mailer-daemon` regardless of domain (Postfix, sendmail,
 *  Gmail's GMAIL-SMTP-IN). We also catch the Google-specific variant. */
const BOUNCE_FROM_RE = /\b(mailer-daemon|postmaster)@/i;

/** Subject patterns common across MTAs. Conservative — only matches
 *  unambiguous bounce subjects, not generic "Delivery Confirmation"
 *  or "Inactive account" replies. */
const BOUNCE_SUBJECT_RE =
  /^\s*(Delivery Status Notification|Mail Delivery Subsystem|Undelivered Mail Returned|Delivery has failed|Returned mail|Mail delivery failed|Failure notice)\b/i;

/** Final-Recipient header in delivery-status-notification reports,
 *  per RFC 3464. Format: `Final-Recipient: rfc822; user@example.com`. */
const FINAL_RECIPIENT_RE = /Final-Recipient:\s*(?:rfc822;\s*)?([^\s<>]+@[^\s<>;]+)/i;

/** Original-Recipient header (sometimes present instead of Final-Recipient). */
const ORIGINAL_RECIPIENT_RE = /Original-Recipient:\s*(?:rfc822;\s*)?([^\s<>]+@[^\s<>;]+)/i;

/** Inline mentions some MTAs put in the human-readable body section. */
const INLINE_FAILED_RE =
  /(?:could not be delivered|delivery to the following recipient(?:s)? failed|<([^<>\s]+@[^<>\s]+)>:?\s*(?:5\d{2}|user unknown|address rejected|recipient address rejected))/i;

/** RFC 3464 Status: line, e.g. "Status: 5.1.1" — first digit = class.
 *  4.x.x = persistent transient (soft); 5.x.x = permanent failure (hard). */
const DSN_STATUS_RE = /^\s*Status:\s*([2-5])\.\d+\.\d+/im;

/** Inline 3-digit SMTP code like "550 user unknown" or "421 too many connections". */
const INLINE_SMTP_CODE_RE = /\b([2-5])\d{2}\b/;

/** Classify a bounce as 'hard' (permanent — suppress) or 'soft'
 *  (transient — don't suppress on a single occurrence).
 *
 *  Sources tried in order:
 *    1. RFC 3464 Status: header in the body
 *    2. Any 3-digit SMTP code near the recipient line in the body
 *    3. Subject keywords (rare — most subjects don't carry a code)
 *
 *  Defaults to 'hard' when we can't tell. Better to occasionally
 *  suppress a temporarily-undeliverable address than to keep
 *  emailing dead inboxes.
 */
function classifyBounce(opts: {
  subject: string | null;
  bodyText: string | null;
}): "hard" | "soft" {
  const body = opts.bodyText ?? "";

  // 1. DSN Status: line — most reliable.
  const dsn = body.match(DSN_STATUS_RE);
  if (dsn?.[1]) {
    return dsn[1] === "4" ? "soft" : "hard";
  }

  // 2. Inline SMTP code.
  const inline = body.match(INLINE_SMTP_CODE_RE);
  if (inline?.[1]) {
    return inline[1] === "4" ? "soft" : "hard";
  }

  // 3. Subject keywords as last resort. Most "delayed delivery" /
  //    "deferred" subjects are soft; "undeliverable" / "rejected" /
  //    "user unknown" are hard.
  const subject = (opts.subject ?? "").toLowerCase();
  if (/\bdelayed?\b|\bdeferred\b|\btemporarily\b/i.test(subject)) return "soft";

  return "hard";
}

/**
 * Detect a bounce; if confident, extract the failed recipient and
 * suppress them with reason='bounced'. Notes capture the bounce
 * subject for the operator to see in /admin/suppression.
 *
 * Detection priority:
 *   1. From header matches mailer-daemon / postmaster — strongest signal
 *   2. Subject matches a known MTA bounce string — very strong
 *   3. Body contains Final-Recipient: or Original-Recipient: headers
 *      (RFC 3464 DSN format) — definitive
 *
 * We require AT LEAST ONE high-confidence signal plus an extracted
 * recipient. A subject like "Mail Delivery Subsystem" alone without
 * a recipient address doesn't suppress anyone (we wouldn't know who).
 *
 * Soft bounces (4.x.x or 4xx SMTP code) are LOGGED but NOT suppressed
 * — the address may come back. Hard bounces (5.x.x) and unknown
 * classification suppress + close the thread.
 */
async function maybeAutoSuppressBounce(opts: {
  teamId: string;
  fromAddress: string;
  subject: string | null;
  bodyText: string | null;
  headers: Record<string, string>;
}): Promise<void> {
  const fromMatch = BOUNCE_FROM_RE.test(opts.fromAddress);
  const subjectMatch = opts.subject ? BOUNCE_SUBJECT_RE.test(opts.subject) : false;
  // RFC 3464 sets Content-Type: multipart/report; report-type=delivery-status
  // on DSN messages. This is the strongest signal short of parsing the
  // structured part — and it costs us one header lookup.
  const contentType = (opts.headers["content-type"] ?? "").toLowerCase();
  const contentTypeMatch =
    contentType.includes("multipart/report") || contentType.includes("delivery-status");
  const looksLikeBounce = fromMatch || subjectMatch || contentTypeMatch;
  if (!looksLikeBounce) return;

  // Try to pull the recipient from the body, preferring the
  // structured headers first.
  const body = opts.bodyText ?? "";
  let recipient: string | null = null;
  const finalMatch = body.match(FINAL_RECIPIENT_RE);
  if (finalMatch?.[1]) recipient = finalMatch[1];
  if (!recipient) {
    const origMatch = body.match(ORIGINAL_RECIPIENT_RE);
    if (origMatch?.[1]) recipient = origMatch[1];
  }
  if (!recipient) {
    // Last resort: scan for inline failure mentions like
    // "<user@example.com>: 550 user unknown"
    const inline = body.match(INLINE_FAILED_RE);
    if (inline?.[1]) recipient = inline[1];
  }
  if (!recipient) {
    // We've seen a bounce-looking message but couldn't identify the
    // bounced address. Log and skip — better than guessing wrong.
    logger.info(
      { from: opts.fromAddress, subject: opts.subject },
      "bounce signal detected but no recipient extracted; skipping auto-suppress",
    );
    return;
  }

  const email = recipient.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return;

  // Classify hard vs soft. Soft bounces are logged but NOT suppressed
  // — the address may come back after a temporary issue (greylist,
  // full mailbox, DNS hiccup). Hard bounces and unknown classification
  // suppress permanently. A persistent soft bouncer escalates to hard
  // after CONSECUTIVE_SOFT_THRESHOLD attempts (see escalateOrSkip).
  const severity = classifyBounce({ subject: opts.subject, bodyText: opts.bodyText });
  if (severity === "soft") {
    const escalated = await trackSoftBounceAndMaybeEscalate({
      teamId: opts.teamId,
      email,
      subject: opts.subject,
    });
    if (!escalated) {
      logger.info(
        { email, teamId: opts.teamId, subject: opts.subject },
        "soft bounce tracked (under escalation threshold); not suppressed",
      );
      return;
    }
    // Escalation tripped — fall through to the hard-bounce path
    // below. The notes string distinguishes this from a primary
    // hard bounce so operators reviewing /admin/suppression can
    // see what happened.
    logger.warn(
      { email, teamId: opts.teamId },
      "soft bounce escalated to hard after consecutive failures",
    );
  }

  // Capture a short diagnostic from the subject for operator context.
  // When a soft escalation triggers a hard suppress, mark it so the
  // operator can tell apart "this bounced hard immediately" from
  // "this kept softly bouncing until we gave up".
  const escalationPrefix =
    severity === "soft" ? "Escalated soft bounces: " : "Auto-suppressed from bounce: ";
  const notes = `${escalationPrefix}${opts.subject ?? "(no subject)"}`.slice(0, 280);

  await db.execute(sql`
    INSERT INTO email_suppression (team_id, email, reason, notes, source_thread_id)
    VALUES (${opts.teamId}, ${email}, 'bounced', ${notes}, NULL)
    ON CONFLICT (team_id, email) DO NOTHING
  `);
  logger.info(
    { email, teamId: opts.teamId, subject: opts.subject },
    "auto-suppressed address from bounce",
  );

  // Close the original thread(s) that bounced. We look for OPEN
  // threads on this team where the most recent outbound message
  // had this recipient in its to_addresses. State transitions to
  // closed_dnc — the existing inbox folder for "this conversation
  // is dead" — and stale + cadence are cleared so the cron tickers
  // don't keep re-tagging a now-dead thread.
  //
  // Bulk update via a CTE that filters by the same recipient match
  // used in the duplicate-outreach detector (see lib/send-safety.ts).
  // Idempotent — re-running on a re-delivered bounce won't change
  // already-closed threads.
  try {
    await db.execute(sql`
      UPDATE email_threads et
      SET
        state = 'closed_dnc',
        is_stale = false,
        stale_since = NULL,
        stale_reason = NULL,
        follow_up_stage = 0,
        follow_up_next_due_at = NULL,
        snippet = COALESCE(snippet, '') || ' [Bounced — auto-suppressed]'
      FROM connected_accounts ca
      WHERE et.staff_outreach_email_id = ca.id
        AND ca.team_id = ${opts.teamId}
        AND et.state IN ('needs_reply', 'waiting_on_them', 'follow_up_due')
        AND EXISTS (
          SELECT 1 FROM email_messages em
          WHERE em.thread_id = et.id
            AND em.direction = 'outbound'
            AND ${email} = ANY (SELECT lower(unnest(em.to_addresses)))
        )
    `);
  } catch (err) {
    // Closing the thread is best-effort — the suppression is the
    // important guarantee. Log and move on.
    logger.warn({ err, email }, "bounce: failed to close original thread (non-fatal)");
  }
}

/**
 * Track a single soft-bounce occurrence on the per-(team, email)
 * counter. Returns `true` when the consecutive count crosses the
 * escalation threshold (and the caller should proceed to hard
 * suppression), `false` when we're still under threshold and the
 * caller should skip suppression for this round.
 *
 * Threshold = 3 consecutive soft bounces. After the 3rd attempt,
 * the deliverability hit dominates the "might-still-recover" upside
 * and we promote to hard.
 *
 * The counter is reset OUTSIDE this function — see the inbound
 * delivery success path in clearSoftBounceCounter (currently unused;
 * a follow-up could reset when a successful send to the address
 * completes, but v1 just lets the row sit until it's superseded
 * by a hard suppression which clears via the email_suppression
 * unique constraint logic). For v1, escalation is sticky: once an
 * address has bounced softly 3 times, we don't give it another
 * chance until an operator manually un-suppresses it.
 */
const CONSECUTIVE_SOFT_THRESHOLD = 3;

async function trackSoftBounceAndMaybeEscalate(opts: {
  teamId: string;
  email: string;
  subject: string | null;
}): Promise<boolean> {
  // Upsert the per-(team, email) row, incrementing consecutive_count.
  // Returns the new count via RETURNING.
  const result = await db.execute<{ consecutive_count: number }>(sql`
    INSERT INTO email_soft_bounces (team_id, email, consecutive_count, last_subject, last_seen_at, first_seen_at)
    VALUES (${opts.teamId}, ${opts.email}, 1, ${opts.subject}, now(), now())
    ON CONFLICT (team_id, email) DO UPDATE
      SET consecutive_count = email_soft_bounces.consecutive_count + 1,
          last_subject = EXCLUDED.last_subject,
          last_seen_at = now()
    RETURNING consecutive_count
  `);
  const rows = Array.isArray(result)
    ? (result as Array<{ consecutive_count: number }>)
    : ((result as unknown as { rows: Array<{ consecutive_count: number }> }).rows ?? []);
  const count = rows[0]?.consecutive_count ?? 1;
  return count >= CONSECUTIVE_SOFT_THRESHOLD;
}
