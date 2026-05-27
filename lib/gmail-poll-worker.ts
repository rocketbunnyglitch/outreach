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
import { db, withAuditContext } from "@/lib/db";
import { refreshAccessToken } from "@/lib/gmail";
import { logger } from "@/lib/logger";
import { publishRealtime } from "@/lib/realtime-publish";
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
    outreach_brand_id: string;
  };
  const claimed = (await db.execute<ClaimedRow>(sql`
    SELECT id, gmail_oauth_refresh_token AS refresh_token,
           gmail_last_history_id AS last_history_id,
           email_address AS email, staff_member_id, outreach_brand_id
    FROM staff_outreach_emails
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
        UPDATE staff_outreach_emails
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

async function pollOneInbox(inbox: {
  id: string;
  refresh_token: string;
  last_history_id: string | null;
  email: string;
  staff_member_id: string;
  outreach_brand_id: string;
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
      UPDATE staff_outreach_emails
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
    outreach_brand_id: string;
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
    const venueId = await resolveVenueFromAddress(fromHeader);
    if (!venueId) {
      // No venue match — skip ingestion for now rather than create an
      // orphaned thread. Future: parked-thread state with a UI to
      // attach to a venue.
      logger.info({ fromHeader, gmailThreadId }, "gmail message ingest skipped — no venue match");
      return null;
    }

    const created = await withAuditContext(
      inbox.staff_member_id ?? SYSTEM_STAFF_ID_FALLBACK,
      async (tx) =>
        tx
          .insert(emailThreads)
          .values({
            outreachBrandId: inbox.outreach_brand_id,
            staffOutreachEmailId: inbox.id,
            gmailThreadId,
            venueId,
            subject,
            state: direction === "inbound" ? "needs_reply" : "waiting_on_them",
            direction,
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
  await db
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
    });

  // Roll thread counters forward.
  await db.execute(sql`
    UPDATE email_threads
    SET
      message_count = message_count + 1,
      ${direction === "inbound" ? sql`unread_count = unread_count + 1,` : sql``}
      ${direction === "inbound" ? sql`last_inbound_at = ${receivedAt},` : sql`last_outbound_at = ${receivedAt},`}
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

  return { threadCreated };
}

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

  // First: exact match on venues.email if any
  const exact = await db
    .select({ id: venues.id })
    .from(venues)
    .where(and(eq(venues.email, email), isNotNull(venues.id)))
    .limit(1);
  if (exact[0]) return exact[0].id;

  // Fallback: domain match on venues.email
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
