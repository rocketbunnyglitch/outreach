/**
 * Venue Communication Timeline loader.
 *
 * Returns every email thread linked to a venue regardless of Gmail
 * thread id or subject. The Outreach Engine must show the full
 * relationship history with each venue even when Gmail's own
 * threading breaks it up across subjects (operators commonly start
 * a new "Friday details" subject mid-conversation; Gmail won't link
 * those to the original "Halloween partnership" thread, but our CRM
 * must).
 *
 * Matching signals (in confidence order):
 *
 *   "venue_id"
 *      The thread row carries venue_id = current venue. High-
 *      confidence: this is how the ingestion poller + the unmatched-
 *      email resolution UI tag threads.
 *
 *   "email_match"
 *      A message in the thread has from_address OR a recipient
 *      address that exactly matches the venue's stored email (or any
 *      alternate email on the venue contacts table once that lands).
 *      Catches threads the poller missed and threads the operator
 *      hasn't yet linked manually.
 *
 *   "domain_match"
 *      A message in the thread has from_address whose domain matches
 *      the venue's website host. Lower confidence; surfaces as
 *      "Suggested" in the UI rather than auto-confirmed.
 *
 * Each thread is returned with its source so the UI can communicate
 * uncertainty (badge / tooltip on lower-confidence matches).
 *
 * Performance note: the cross-match path uses a UNION-like pattern
 * (SELECT DISTINCT from messages WHERE from_address ILIKE ...) which
 * is acceptable up to roughly 10k messages per venue. If individual
 * venues exceed that, we'll add a denormalized
 * venue_id_inferred column on email_threads written by the poller.
 */

import { connectedAccounts, emailMessages, emailThreads, staffMembers, venues } from "@/db/schema";
import { db } from "@/lib/db";
import { aliasedTable, and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";

export type VenueCommunicationSource = "venue_id" | "email_match" | "domain_match";

/**
 * Free / consumer email providers. A venue whose website host happens
 * to be one of these (or whose stored email is on one of these) must
 * NOT trigger the domain_match branch: split_part(from,'@',2) =
 * 'gmail.com' would otherwise pull in every unrelated thread from any
 * Gmail sender. For free-provider domains we require an exact address
 * match (email_match) instead.
 */
const FREE_EMAIL_DOMAINS = new Set<string>([
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "icloud.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "live.com",
  "msn.com",
]);

export interface VenueCommunicationThread {
  threadId: string;
  subject: string | null;
  gmailThreadId: string;
  lastMessageAt: Date;
  state: string;
  classification: string;
  direction: string;
  /** Connected Gmail account that owns the thread (sender side). */
  accountEmail: string;
  /** Staff member who owns the account, if any. */
  ownerName: string | null;
  /** Message count in the thread. Cheap derived value. */
  messageCount: number;
  /** True when at least one message has read_at = NULL. */
  hasUnread: boolean;
  /** Match signal — drives badge + tooltip in the UI. */
  source: VenueCommunicationSource;
}

export interface VenueCommunicationSummary {
  totalThreads: number;
  totalMessages: number;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  needsReplyCount: number;
  staleCount: number;
  staffEmails: string[];
  staffOwnerNames: string[];
}

export interface VenueCommunication {
  threads: VenueCommunicationThread[];
  summary: VenueCommunicationSummary;
}

/**
 * Load every email thread tied to a venue across all matching
 * signals. Returns threads ordered most-recent-first.
 *
 * `teamId` is required so we never cross-team-leak (a venue could
 * conceivably exist on multiple teams in a future multi-tenant
 * world; for now venues are team-global but the team scope on
 * threads must still match).
 */
export async function loadVenueCommunication(
  venueId: string,
  teamId: string,
): Promise<VenueCommunication> {
  // ----------------------------------------------------------------
  // 1. Resolve the venue's matching surface (email + alt emails +
  //    website host)
  // ----------------------------------------------------------------
  const [venueRow] = await db
    .select({
      id: venues.id,
      email: venues.email,
      alternateEmails: venues.alternateEmails,
      websiteUrl: venues.websiteUrl,
    })
    .from(venues)
    .where(eq(venues.id, venueId))
    .limit(1);
  if (!venueRow) {
    return {
      threads: [],
      summary: {
        totalThreads: 0,
        totalMessages: 0,
        lastInboundAt: null,
        lastOutboundAt: null,
        needsReplyCount: 0,
        staleCount: 0,
        staffEmails: [],
        staffOwnerNames: [],
      },
    };
  }
  // Build the union of primary email + alt emails — the matching
  // surface for "email_match". Lowercased + de-duped so the WHERE
  // clause is tight.
  const emailSurface = new Set<string>();
  if (venueRow.email) emailSurface.add(venueRow.email.toLowerCase());
  for (const e of venueRow.alternateEmails ?? []) {
    if (e) emailSurface.add(e.toLowerCase());
  }
  const venueDomain = venueRow.websiteUrl ? extractDomain(venueRow.websiteUrl) : null;

  // ----------------------------------------------------------------
  // 2. Direct-match threads (venue_id set on the row)
  // ----------------------------------------------------------------
  const accountOwners = aliasedTable(staffMembers, "account_owners");
  const directIds = await db
    .select({ id: emailThreads.id })
    .from(emailThreads)
    .innerJoin(connectedAccounts, eq(connectedAccounts.id, emailThreads.staffOutreachEmailId))
    .where(
      and(
        eq(emailThreads.venueId, venueId),
        eq(connectedAccounts.teamId, teamId),
        isNull(emailThreads.deletedAt),
      ),
    );
  const directIdSet = new Set(directIds.map((r) => r.id));

  // ----------------------------------------------------------------
  // 3. Email-match threads (sender/recipient = venue's stored email
  //    or any alternate email on the venue row). Limited to threads
  //    NOT already in directIdSet so we don't double-count.
  //    Source: "email_match".
  //
  //    PRIOR BUG: this used to compare `lower(from_address)` against
  //    the venue's clean email list, which silently failed for any
  //    sender with a display name in the From header (the common
  //    case). After migration 0083 we query from_email_normalized
  //    instead; the column is pre-normalized at ingest + send time
  //    and indexed for fast equality / ANY().
  //
  //    Recipient side uses the to_emails_normalized array — the
  //    `&&` (overlap) operator + GIN index makes this a much
  //    cheaper plan than the previous unnest+lower scan.
  // ----------------------------------------------------------------
  const emailMatchIds = new Set<string>();
  if (emailSurface.size > 0) {
    const emailList = Array.from(emailSurface);
    const matchedRows = await db
      .selectDistinct({ threadId: emailMessages.threadId })
      .from(emailMessages)
      .innerJoin(emailThreads, eq(emailThreads.id, emailMessages.threadId))
      .innerJoin(connectedAccounts, eq(connectedAccounts.id, emailThreads.staffOutreachEmailId))
      .where(
        and(
          eq(connectedAccounts.teamId, teamId),
          isNull(emailThreads.deletedAt),
          or(
            sql`${emailMessages.fromEmailNormalized} = ANY(${emailList})`,
            sql`${emailMessages.toEmailsNormalized} && ${emailList}::text[]`,
            sql`${emailMessages.ccEmailsNormalized} && ${emailList}::text[]`,
            sql`${emailMessages.bccEmailsNormalized} && ${emailList}::text[]`,
          ),
        ),
      );
    for (const r of matchedRows) {
      if (!directIdSet.has(r.threadId)) emailMatchIds.add(r.threadId);
    }
  }

  // ----------------------------------------------------------------
  // 4. Domain-match threads (sender domain = venue website host).
  //    Limited to threads NOT already in direct or email match.
  //
  //    Same fix: query from_email_normalized so the LIKE pattern
  //    actually matches. Previously `lower(from_address) LIKE
  //    '%@venue.com'` failed on raw headers ending in '>' (the
  //    closing angle bracket of a display-name form). Splitting
  //    on '@' is cleaner than LIKE — exact match on the domain
  //    half, indexable.
  // ----------------------------------------------------------------
  const domainMatchIds = new Set<string>();
  // Skip domain_match entirely for free / consumer providers -- matching
  // every Gmail/Yahoo/etc sender by domain would flood the timeline with
  // unrelated threads. Those venues rely on exact-address email_match.
  if (venueDomain && !FREE_EMAIL_DOMAINS.has(venueDomain)) {
    const matchedRows = await db
      .selectDistinct({ threadId: emailMessages.threadId })
      .from(emailMessages)
      .innerJoin(emailThreads, eq(emailThreads.id, emailMessages.threadId))
      .innerJoin(connectedAccounts, eq(connectedAccounts.id, emailThreads.staffOutreachEmailId))
      .where(
        and(
          eq(connectedAccounts.teamId, teamId),
          isNull(emailThreads.deletedAt),
          sql`split_part(${emailMessages.fromEmailNormalized}, '@', 2) = ${venueDomain}`,
        ),
      );
    for (const r of matchedRows) {
      if (!directIdSet.has(r.threadId) && !emailMatchIds.has(r.threadId)) {
        domainMatchIds.add(r.threadId);
      }
    }
  }

  // ----------------------------------------------------------------
  // 5. Single hydration query for every matched id.
  // ----------------------------------------------------------------
  const allIds = [...directIdSet, ...emailMatchIds, ...domainMatchIds];
  if (allIds.length === 0) {
    return {
      threads: [],
      summary: {
        totalThreads: 0,
        totalMessages: 0,
        lastInboundAt: null,
        lastOutboundAt: null,
        needsReplyCount: 0,
        staleCount: 0,
        staffEmails: [],
        staffOwnerNames: [],
      },
    };
  }
  const rows = await db
    .select({
      threadId: emailThreads.id,
      subject: emailThreads.subject,
      gmailThreadId: emailThreads.gmailThreadId,
      lastMessageAt: emailThreads.lastMessageAt,
      lastInboundAt: emailThreads.lastInboundAt,
      lastOutboundAt: emailThreads.lastOutboundAt,
      state: emailThreads.state,
      classification: emailThreads.classification,
      direction: emailThreads.direction,
      unreadCount: emailThreads.unreadCount,
      accountEmail: connectedAccounts.emailAddress,
      ownerUserId: connectedAccounts.ownerUserId,
      ownerName: accountOwners.displayName,
      messageCount: sql<number>`(SELECT COUNT(*)::int FROM email_messages WHERE thread_id = ${emailThreads.id})`,
    })
    .from(emailThreads)
    .innerJoin(connectedAccounts, eq(connectedAccounts.id, emailThreads.staffOutreachEmailId))
    .leftJoin(accountOwners, eq(accountOwners.id, connectedAccounts.ownerUserId))
    .where(and(inArray(emailThreads.id, allIds), isNull(emailThreads.deletedAt)))
    .orderBy(desc(emailThreads.lastMessageAt));

  const threads: VenueCommunicationThread[] = rows.map((r) => ({
    threadId: r.threadId,
    subject: r.subject,
    gmailThreadId: r.gmailThreadId,
    lastMessageAt: r.lastMessageAt,
    state: r.state,
    classification: r.classification,
    direction: r.direction,
    accountEmail: r.accountEmail,
    ownerName: r.ownerName,
    messageCount: r.messageCount,
    hasUnread: r.unreadCount > 0,
    source: directIdSet.has(r.threadId)
      ? "venue_id"
      : emailMatchIds.has(r.threadId)
        ? "email_match"
        : "domain_match",
  }));

  // ----------------------------------------------------------------
  // 6. Summary card derivation. SLA threshold: 4 business hours, but
  //    for the venue page we use a simpler "needs_reply state AND
  //    last_inbound_at > 24h ago" approximation since the venue
  //    surface doesn't need the inbox's business-hours precision.
  // ----------------------------------------------------------------
  const now = Date.now();
  const staleThresholdMs = 24 * 60 * 60 * 1000;
  let lastInboundAt: Date | null = null;
  let lastOutboundAt: Date | null = null;
  let needsReplyCount = 0;
  let staleCount = 0;
  const staffEmailsSet = new Set<string>();
  const ownerNamesSet = new Set<string>();
  let totalMessages = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    totalMessages += r.messageCount;
    if (r.lastInboundAt && (!lastInboundAt || r.lastInboundAt > lastInboundAt)) {
      lastInboundAt = r.lastInboundAt;
    }
    if (r.lastOutboundAt && (!lastOutboundAt || r.lastOutboundAt > lastOutboundAt)) {
      lastOutboundAt = r.lastOutboundAt;
    }
    if (r.state === "needs_reply") {
      needsReplyCount += 1;
      if (r.lastInboundAt && now - r.lastInboundAt.getTime() > staleThresholdMs) {
        staleCount += 1;
      }
    }
    staffEmailsSet.add(r.accountEmail);
    if (r.ownerName) ownerNamesSet.add(r.ownerName);
  }

  return {
    threads,
    summary: {
      totalThreads: threads.length,
      totalMessages,
      lastInboundAt,
      lastOutboundAt,
      needsReplyCount,
      staleCount,
      staffEmails: Array.from(staffEmailsSet),
      staffOwnerNames: Array.from(ownerNamesSet),
    },
  };
}

/**
 * Extract a bare lowercase hostname from a URL or domain string.
 * Returns null if nothing usable. Handles:
 *   "https://lavelle.com"  -> "lavelle.com"
 *   "https://www.lavelle.com/menu" -> "lavelle.com"
 *   "lavelle.com" -> "lavelle.com"
 *   "" / invalid -> null
 */
function extractDomain(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  try {
    const withProtocol = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
    const u = new URL(withProtocol);
    return u.hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}
