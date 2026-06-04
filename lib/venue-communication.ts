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

import {
  connectedAccounts,
  emailMessages,
  emailThreads,
  staffMembers,
  venueDomainAliases,
  venues,
} from "@/db/schema";
import { db } from "@/lib/db";
import { aliasedTable, and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";

export type VenueCommunicationSource = "venue_id" | "email_match" | "domain_match";

const VENUE_COMMUNICATION_SOURCES = new Set<VenueCommunicationSource>([
  "venue_id",
  "email_match",
  "domain_match",
]);

/**
 * Narrow a persisted match_source value (free-form text column) to a
 * known VenueCommunicationSource, or null if it is absent / unrecognized
 * so the caller can fall back to the value computed from the match
 * buckets in this loader.
 */
function persistedSource(value: string | null): VenueCommunicationSource | null {
  if (value && VENUE_COMMUNICATION_SOURCES.has(value as VenueCommunicationSource)) {
    return value as VenueCommunicationSource;
  }
  return null;
}

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
  /** Match signal -- drives badge + tooltip in the UI. Reads the
   *  persisted email_threads.match_source when present (migration
   *  0089), else falls back to the value computed from the match
   *  buckets in this loader. */
  source: VenueCommunicationSource;
  /** Persisted confidence label (email_threads.match_confidence),
   *  null when not yet written by the poller. Read-only passthrough. */
  matchConfidence: string | null;
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
            // inArray, NOT sql`= ANY(${emailList})` — the latter mis-binds
            // the JS array as a scalar (22P02 malformed array literal) and
            // this query is .catch(()=>null)'d, so it silently dropped the
            // venue timeline. The && overlap lines below correctly cast via
            // ${emailList}::text[]; this scalar-column match needs inArray.
            inArray(emailMessages.fromEmailNormalized, emailList),
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
  // 4b. Domain-ALIAS threads: sender domain is in this venue's curated
  //     venue_domain_aliases (parent-group / management-company domains
  //     an operator mapped to the venue). The poll worker matches these
  //     at INGEST (Tier 2.5), but a thread that arrived BEFORE the alias
  //     was added has venue_id = null and would otherwise be invisible
  //     here -- so the timeline reader honors aliases retroactively. Same
  //     free-domain skip + dedup as domain_match; labeled "domain_match"
  //     (a suggestion) by the source fallback below.
  // ----------------------------------------------------------------
  const aliasMatchIds = new Set<string>();
  {
    const aliasRows = await db
      .select({ domain: venueDomainAliases.domain })
      .from(venueDomainAliases)
      .where(eq(venueDomainAliases.venueId, venueId));
    const aliasDomains = aliasRows
      .map((r) => r.domain.toLowerCase())
      .filter((d) => d.length > 0 && !FREE_EMAIL_DOMAINS.has(d));
    if (aliasDomains.length > 0) {
      const matchedRows = await db
        .selectDistinct({ threadId: emailMessages.threadId })
        .from(emailMessages)
        .innerJoin(emailThreads, eq(emailThreads.id, emailMessages.threadId))
        .innerJoin(connectedAccounts, eq(connectedAccounts.id, emailThreads.staffOutreachEmailId))
        .where(
          and(
            eq(connectedAccounts.teamId, teamId),
            isNull(emailThreads.deletedAt),
            // IN (...) with sql.join, NOT `= ANY(${aliasDomains})`: the LHS
            // is an expression (split_part) so inArray can't be used, and
            // interpolating the JS array into = ANY mis-binds it as a scalar
            // (22P02). aliasDomains is guarded non-empty above.
            sql`split_part(${emailMessages.fromEmailNormalized}, '@', 2) IN (${sql.join(
              aliasDomains.map((d) => sql`${d}`),
              sql`, `,
            )})`,
          ),
        );
      for (const r of matchedRows) {
        if (
          !directIdSet.has(r.threadId) &&
          !emailMatchIds.has(r.threadId) &&
          !domainMatchIds.has(r.threadId)
        ) {
          aliasMatchIds.add(r.threadId);
        }
      }
    }
  }

  // ----------------------------------------------------------------
  // 5. Single hydration query for every matched id.
  // ----------------------------------------------------------------
  const allIds = [...directIdSet, ...emailMatchIds, ...domainMatchIds, ...aliasMatchIds];
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
      matchSource: emailThreads.matchSource,
      matchConfidence: emailThreads.matchConfidence,
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
    // Read the persisted classification when present (migration 0089),
    // else fall back to the value computed from the match buckets. The
    // poller write that populates these columns lives in
    // lib/gmail-poll-worker.ts (out of scope); until it lands the
    // column is NULL for every row and the computed fallback drives the
    // UI exactly as before.
    source:
      persistedSource(r.matchSource) ??
      (directIdSet.has(r.threadId)
        ? "venue_id"
        : emailMatchIds.has(r.threadId)
          ? "email_match"
          : "domain_match"),
    matchConfidence: r.matchConfidence,
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

// =========================================================================
// Written-confirmation messages (venue detail card)
// =========================================================================

export interface VenueConfirmationMessage {
  messageId: string;
  threadId: string;
  subject: string | null;
  /** The venue-side person who replied (display name, falls back to address). */
  fromName: string | null;
  fromAddress: string;
  /** When the venue sent it (received_at, falling back to sent_at). */
  at: Date | null;
  snippet: string | null;
  /** True when an operator has flagged this message as the written confirmation. */
  isConfirmation: boolean;
  /** Operator who flagged it + when (null until flagged). */
  flaggedByName: string | null;
  flaggedAt: Date | null;
}

/**
 * Inbound emails for a venue's matched threads, newest first, each carrying its
 * written-confirmation flag. Drives the venue card's confirmation section:
 * flagged messages are the "confirmation on file" proof; the rest are
 * candidates the operator can flag. Pass the thread ids already resolved by
 * loadVenueCommunication so we never re-run the (expensive) venue match.
 */
export async function loadVenueConfirmationMessages(
  threadIds: string[],
): Promise<VenueConfirmationMessage[]> {
  if (threadIds.length === 0) return [];
  const rows = await db
    .select({
      messageId: emailMessages.id,
      threadId: emailMessages.threadId,
      subject: emailMessages.subject,
      fromName: emailMessages.fromName,
      fromAddress: emailMessages.fromAddress,
      receivedAt: emailMessages.receivedAt,
      sentAt: emailMessages.sentAt,
      snippet: emailMessages.snippet,
      isConfirmation: emailMessages.isConfirmation,
      flaggedAt: emailMessages.confirmationFlaggedAt,
      flaggedByName: staffMembers.displayName,
    })
    .from(emailMessages)
    .leftJoin(staffMembers, eq(staffMembers.id, emailMessages.confirmationFlaggedBy))
    .where(and(inArray(emailMessages.threadId, threadIds), eq(emailMessages.direction, "inbound")))
    .orderBy(desc(emailMessages.receivedAt), desc(emailMessages.sentAt))
    .limit(60);
  return rows.map((r) => ({
    messageId: r.messageId,
    threadId: r.threadId,
    subject: r.subject,
    fromName: r.fromName,
    fromAddress: r.fromAddress,
    at: r.receivedAt ?? r.sentAt ?? null,
    snippet: r.snippet,
    isConfirmation: r.isConfirmation,
    flaggedByName: r.flaggedByName,
    flaggedAt: r.flaggedAt,
  }));
}
