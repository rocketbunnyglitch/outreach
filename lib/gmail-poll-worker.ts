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

import { emailMessages, emailThreads, staffOutreachEmails, venues } from "@/db/schema";
import { classifyInboundMessageAsync } from "@/lib/ai-classify";
import { db, withAuditContext } from "@/lib/db";
import { refreshAccessToken } from "@/lib/gmail";
import { syncGmailLabelsForAccount } from "@/lib/gmail-label-sync";
import { logger } from "@/lib/logger";
import { publishRealtime } from "@/lib/realtime-publish";
import { reconcileGmailLabelsForThread } from "@/lib/team-labels";
import { classifyInboundEmail } from "@/lib/triage-classifier";
import { and, eq, isNotNull, sql } from "drizzle-orm";

const BATCH_INBOX_LIMIT = 10;
const PER_INBOX_MSG_LIMIT = 50;
const FIRST_POLL_NEWER_THAN_DAYS = 7;
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
          await db
            .update(staffOutreachEmails)
            .set({ gmailOauthRefreshToken: null })
            .where(eq(staffOutreachEmails.id, inbox.id));
          logger.warn(
            { inboxId: inbox.id },
            "cleared invalid Gmail refresh token; operator must reconnect",
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
}

export async function pollOneInbox(inbox: {
  id: string;
  refresh_token: string;
  last_history_id: string | null;
  email: string;
  staff_member_id: string;
}): Promise<InboxPollResult> {
  const accessToken = await refreshAccessToken(inbox.refresh_token);
  let messageIds: string[];
  let nextHistoryId: string | null = inbox.last_history_id;

  if (inbox.last_history_id) {
    // Incremental: history.list since the last point we processed.
    const historyRes = await gmailFetch(
      `users/me/history?startHistoryId=${encodeURIComponent(inbox.last_history_id)}&historyTypes=messageAdded&maxResults=500`,
      accessToken,
    );
    type HistoryEntry = {
      id: string;
      messagesAdded?: Array<{ message: { id: string; threadId: string } }>;
    };
    const histories: HistoryEntry[] = (historyRes.history as HistoryEntry[]) ?? [];
    const seen = new Set<string>();
    for (const h of histories) {
      for (const m of h.messagesAdded ?? []) {
        if (m.message.id) seen.add(m.message.id);
      }
    }
    messageIds = Array.from(seen).slice(0, PER_INBOX_MSG_LIMIT);
    if (historyRes.historyId) nextHistoryId = historyRes.historyId as string;
  } else {
    // First poll: pull recent inbox messages with newer_than filter so
    // we don't sweep up a years-old archive.
    const listRes = await gmailFetch(
      `users/me/messages?q=${encodeURIComponent(`in:inbox newer_than:${FIRST_POLL_NEWER_THAN_DAYS}d`)}&maxResults=${PER_INBOX_MSG_LIMIT}`,
      accessToken,
    );
    type MessageRef = { id: string; threadId: string };
    const list: MessageRef[] = (listRes.messages as MessageRef[]) ?? [];
    messageIds = list.map((m) => m.id);

    // Grab the profile's current historyId so we can incremental-poll next time
    const profileRes = await gmailFetch("users/me/profile", accessToken);
    if (profileRes.historyId) nextHistoryId = profileRes.historyId as string;
  }

  let messagesIngested = 0;
  let threadsCreated = 0;

  for (const messageId of messageIds) {
    try {
      const ingested = await ingestMessage({
        messageId,
        accessToken,
        inbox,
      });
      if (ingested) {
        messagesIngested++;
        if (ingested.threadCreated) threadsCreated++;
      }
    } catch (err) {
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

  return { messagesIngested, threadsCreated };
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
}): Promise<IngestResult | null> {
  const { messageId, accessToken, inbox } = opts;

  // Cheap dedup: if email_messages already has this gmail_message_id +
  // inbox combo, skip the API call entirely.
  const existing = await db
    .select({ id: emailMessages.id })
    .from(emailMessages)
    .where(
      and(
        eq(emailMessages.gmailMessageId, messageId),
        eq(emailMessages.staffOutreachEmailId, inbox.id),
      ),
    )
    .limit(1);
  if (existing.length > 0) return null;

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
  const rfcMessageId = headers["message-id"] ?? null;
  const inReplyTo = headers["in-reply-to"] ?? null;
  const snippet = (msg.snippet as string) ?? "";
  const labels = (msg.labelIds as string[]) ?? [];
  const internalDateMs = Number.parseInt(msg.internalDate as string, 10);
  const receivedAt = Number.isFinite(internalDateMs)
    ? new Date(internalDateMs).toISOString()
    : new Date().toISOString();

  // Direction: if 'from' contains the inbox's own email, it's outbound.
  // Otherwise inbound.
  const direction = fromHeader.toLowerCase().includes(inbox.email.toLowerCase())
    ? "outbound"
    : "inbound";

  // Plain-text body extraction (light pass — full HTML rendering is
  // deferred until we sanitize on the way out)
  const bodyText = extractPlainText(msg.payload as GmailPayload | undefined);

  // Rule-based triage classification — only for inbound messages.
  // Outbound replies don't get classified (the operator wrote them, no
  // signal to extract). Tagged on the thread for fast list-view filtering.
  const classification =
    direction === "inbound"
      ? classifyInboundEmail({
          subject,
          bodyText,
          fromAddress: fromHeader,
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

  const existingThread = await db
    .select({ id: emailThreads.id, venueId: emailThreads.venueId })
    .from(emailThreads)
    .where(eq(emailThreads.gmailThreadId, gmailThreadId))
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
    const venueId = await resolveVenueFromAddress(fromHeader);
    if (!venueId) {
      logger.info(
        { fromHeader, gmailThreadId },
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
      toAddresses: toHeader ? splitAddresses(toHeader) : [],
      ccAddresses: ccHeader ? splitAddresses(ccHeader) : [],
      bccAddresses: [],
      subject,
      bodyText,
      bodyHtml: null,
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

  await db.execute(sql`
    UPDATE email_threads
    SET
      message_count = message_count + 1,
      ${direction === "inbound" ? sql`unread_count = unread_count + 1,` : sql``}
      ${direction === "inbound" ? sql`last_inbound_at = ${receivedAt},` : sql`last_outbound_at = ${receivedAt},`}
      ${
        autoUpgradeClassification
          ? sql`classification = CASE
                  WHEN classification = 'unclassified' THEN ${classification.classification}::reply_classification
                  ELSE classification
                END,`
          : sql``
      }
      snippet = ${snippet},
      last_sender_name = ${extractSenderName(fromHeader)},
      state = CASE
        WHEN ${direction} = 'inbound' THEN 'needs_reply'::thread_state
        ELSE state
      END,
      updated_at = NOW(),
      updated_by = ${inbox.staff_member_id}
    WHERE id = ${threadId}
  `);

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
      }
    } catch (err) {
      logger.warn({ err, threadId }, "[gmail-poll] ai-classify dispatch failed (non-fatal)");
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
  body?: { data?: string };
  parts?: GmailPayload[];
}

function extractPlainText(payload: GmailPayload | undefined): string {
  if (!payload) return "";

  // Walk the MIME tree looking for the first text/plain part.
  function walk(part: GmailPayload): string | null {
    if (part.mimeType === "text/plain" && part.body?.data) {
      return base64UrlDecode(part.body.data);
    }
    for (const child of part.parts ?? []) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  }

  return walk(payload) ?? "";
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

async function resolveVenueFromAddress(fromHeader: string): Promise<string | null> {
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
  // This is the canonical "operator-trained" signal — every time an
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

  // Tier 3 (medium confidence): domain match on venues.email.
  // Last-resort fallback for senders we haven't seen yet but whose
  // domain looks right (e.g. info@lavelle.com matching when only
  // bookings@lavelle.com is the stored email).
  const domain = email.split("@")[1];
  if (!domain) return null;
  const domainMatch = await db.execute<{ id: string }>(sql`
    SELECT id FROM venues
    WHERE email IS NOT NULL
      AND lower(email) LIKE ${`%@${domain}`}
      AND archived_at IS NULL
    LIMIT 1
  `);
  const list: Array<{ id: string }> = Array.isArray(domainMatch)
    ? (domainMatch as unknown as Array<{ id: string }>)
    : ((domainMatch as unknown as { rows: Array<{ id: string }> }).rows ?? []);
  return list[0]?.id ?? null;
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
