/**
 * Inbox data helpers.
 *
 * All Drizzle queries for the /inbox tab live here so the page + components
 * stay declarative. Keeping the SQL in one place also makes it easy to
 * see when a query is repeated and should be factored.
 *
 * Conventions
 *   • Every list query filters out archived_at IS NOT NULL.
 *   • Folder routing maps thread_state enum values to URL slugs (see
 *     FOLDER_TO_STATES below).
 *   • SLA breach is computed in SQL on read (no stored flag); the
 *     threshold lives in INBOX_SLA_HOURS so config changes apply
 *     retroactively.
 */

import {
  events,
  campaigns,
  cities,
  cityCampaigns,
  connectedAccounts,
  emailDrafts,
  emailMessages,
  emailThreads,
  outreachBrands,
  outreachLog,
  staffMembers,
  tasks,
  venueEvents,
  venues,
} from "@/db/schema";
import { db } from "@/lib/db";
import { sanitizeEmailHtml } from "@/lib/email-sanitize";
import { parseSearchQuery } from "@/lib/inbox-search";
import {
  aliasedTable,
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";

// =========================================================================
// Folders
// =========================================================================

/**
 * URL slug → thread_state values it includes. Used by the engine
 * "smart view" folders (needs_reply / waiting / follow_up / closed).
 *
 * The Gmail-style mailbox folders (inbox / sent / starred / etc) do
 * NOT use state filtering — they filter by direction / is_starred /
 * snooze_until / deleted_at instead. The folder enum carries both
 * sets of slugs; fetchInboxThreads picks the right WHERE shape.
 */
export const FOLDER_TO_STATES: Record<EngineSmartFolder, readonly ThreadStateValue[]> = {
  needs_reply: ["needs_reply"],
  waiting: ["waiting_on_them"],
  follow_up: ["follow_up_due"],
  closed: ["closed_won", "closed_lost", "closed_dnc"],
};

/**
 * Gmail-style mailbox views — primary navigation. Map to Gmail
 * mailbox concepts (Inbox = inbound, Sent = outbound, etc).
 * Drafts + Scheduled live in email_drafts so the page renders a
 * different middle pane for those.
 */
export const GMAIL_MAILBOX_FOLDERS = [
  "inbox",
  "sent",
  "drafts",
  "starred",
  "snoozed",
  "scheduled",
  "archive",
  "all_mail",
  "trash",
] as const;

/**
 * Engine smart views — secondary navigation for power-user
 * workflows. Kept for parity with the prior shape; surfaced below
 * the mailbox section in the left rail.
 */
export const ENGINE_SMART_FOLDERS = ["needs_reply", "waiting", "follow_up", "closed"] as const;

export type GmailMailboxFolder = (typeof GMAIL_MAILBOX_FOLDERS)[number];
export type EngineSmartFolder = (typeof ENGINE_SMART_FOLDERS)[number];

export const INBOX_FOLDERS = [...GMAIL_MAILBOX_FOLDERS, ...ENGINE_SMART_FOLDERS] as const;
export type InboxFolder = (typeof INBOX_FOLDERS)[number];

export type ThreadStateValue =
  | "needs_reply"
  | "waiting_on_them"
  | "follow_up_due"
  | "closed_won"
  | "closed_lost"
  | "closed_dnc"
  | "archived";

export const FOLDER_LABELS: Record<InboxFolder, string> = {
  // Gmail-style mailbox views
  inbox: "Inbox",
  sent: "Sent",
  drafts: "Drafts",
  starred: "Starred",
  snoozed: "Snoozed",
  scheduled: "Scheduled",
  archive: "Archive",
  all_mail: "All Mail",
  trash: "Trash",
  // Engine smart views
  needs_reply: "Needs Reply",
  waiting: "Waiting On Them",
  follow_up: "Follow-Up Due",
  closed: "Closed",
};

export function isInboxFolder(value: string | undefined | null): value is InboxFolder {
  return value != null && (INBOX_FOLDERS as readonly string[]).includes(value);
}

export function isGmailMailbox(value: InboxFolder): value is GmailMailboxFolder {
  return (GMAIL_MAILBOX_FOLDERS as readonly string[]).includes(value);
}

export function isEngineSmartFolder(value: InboxFolder): value is EngineSmartFolder {
  return (ENGINE_SMART_FOLDERS as readonly string[]).includes(value);
}

/**
 * SLA threshold — a needs_reply thread older than this is "breached".
 * Tunable here; if we ever wire it to a per-brand setting, fetch it
 * inside the query instead of inlining the constant.
 */
export const INBOX_SLA_HOURS = 4;

// =========================================================================
// Thread list query (middle pane)
// =========================================================================

export interface ThreadListFilter {
  folder: InboxFolder;
  /**
   * Team scope — REQUIRED. Every inbox query filters threads to
   * connected_accounts.team_id = this. Set by the page from the
   * signed-in user's team. Multi-tenancy depends on this being
   * non-optional.
   */
  currentTeamId: string;
  /**
   * Current user id. Required only when `mine` is true, but the
   * page always has it so we make it non-optional to keep the call
   * sites simple.
   */
  currentUserId: string;
  /**
   * When true, restrict threads to those flowing through the
   * current user's OWN connected_accounts rows. When false (default
   * for the inbox), show every team inbox so any operator can pick
   * up a thread.
   */
  mine?: boolean;
  /** 1-based page for offset pagination (Gmail-style, default 1). */
  page?: number;
  /** Rows per page (default 50). Capped at 200. */
  pageSize?: number;
  assignedStaffId?: string;
  /**
   * Narrow to threads on this specific city_campaign (campaign × city
   * pair). Granular: an operator clicking a specific city in the
   * campaign-info page passes this. URL param: `?campaign=<id>` where
   * the id is a city_campaign UUID.
   *
   * Mutually compatible with `campaignId` below — when both are set,
   * we apply the narrower cityCampaignId filter and effectively
   * ignore campaignId (the narrower constraint already implies the
   * broader one).
   */
  cityCampaignId?: string;
  /**
   * Default scope inherited from the global campaign switcher. Filters
   * threads to any city_campaign whose campaign_id matches. Set by the
   * inbox page when `?campaign=` is absent + `getCurrentCampaign()`
   * returns a campaign. Operators see only Halloween threads when
   * Halloween is the active campaign in the switcher, without having
   * to set up filters manually. Pass `null` (explicit) to scope to
   * "All campaigns" in the URL.
   */
  campaignId?: string;
  outreachBrandId?: string;
  /** Active team-label filter (URL param `label`). When set, narrows
   *  the thread list to those tagged with this label. */
  labelId?: string;
  /**
   * Filter to a specific connected Gmail account (connected_accounts.id).
   * When a user has multiple inbox addresses (up to ~3 per the new
   * model), this lets them focus on one at a time.
   */
  aliasId?: string;
  /**
   * Restrict threads to a subset of connected accounts. Set by the
   * Gmail-style AccountSwitcher dropdown via the `?accounts=<id>,<id>`
   * URL param. When undefined / empty, every account the operator can
   * see is included. The visibility scope above (team-level via
   * connected_accounts.team_id) still applies — this just narrows
   * within that.
   */
  accountIds?: string[];
  /**
   * Scope filter: "Unassigned" preset from InboxScopeBar — restricts
   * to threads with no assigned operator (assigned_staff_id IS NULL).
   * Distinct from passing assignedStaffId=undefined which means "no
   * assignment filter at all"; this is an explicit "show me what
   * nobody owns yet".
   */
  unassigned?: boolean;
  /**
   * Scope filter: "Stale" preset — restricts to threads currently
   * flagged stale by the cadence engine (is_stale = true). Existing
   * stale-tagger surface; this just exposes it as a top-level filter
   * for the scope bar.
   */
  staleOnly?: boolean;
  /**
   * Scope filter: "Unmatched" preset — restricts to inbound threads
   * that haven't been linked to a venue yet (venue_id IS NULL AND
   * direction = 'inbound'). Outbound threads can't be unmatched by
   * definition since the operator chose the recipient; we restrict
   * to inbound to keep the queue actionable.
   */
  unmatchedOnly?: boolean;
  /**
   * Scope filter: "Mentioned" preset — restricts to threads where
   * the calling user has unacknowledged @-mentions in any internal
   * note (Phase D).
   */
  mentionedOnly?: boolean;
  /**
   * Free-text search applied to subject, snippet, venue name, and
   * last-sender name via case-insensitive substring match. Empty or
   * whitespace-only inputs are ignored.
   */
  search?: string;
}

export interface InboxThreadRow {
  id: string;
  subject: string | null;
  snippet: string | null;
  lastMessageAt: Date;
  lastInboundAt: Date | null;
  lastSenderName: string | null;
  messageCount: number;
  unreadCount: number;
  state: ThreadStateValue;
  classification: string;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  /** Null when the thread hasn't been matched to a venue yet (the poll
      worker couldn't resolve the sender domain). Operator can attach
      one from the inbox UI. */
  venueId: string | null;
  venueName: string | null;
  cityName: string | null;
  /** null when the thread hasn't been attributed to a brand yet. */
  brandName: string | null;
  cityCampaignId: string | null;
  campaignName: string | null;
  eventDayPart: string | null;
  eventCrawlNumber: number | null;
  slaBreached: boolean;
  /** True when the stale-tagger has flagged this thread. */
  isStale: boolean;
  /** Short reason string the UI shows as a tooltip on the stale chip. */
  staleReason: string | null;
  /** Precomputed compact duration ("3h", "12m", "2d") since the
   *  thread first became stale in its current stale state. Rendered
   *  inline on the stale pill so triage sees lateness at a glance
   *  without expanding the tooltip. Null when isStale is false or
   *  stale_since wasn't recorded (legacy rows from pre-tagger). */
  staleDurationLabel: string | null;
  /** Gmail-style star. Operator can toggle via the star button. */
  isStarred: boolean;
  /** ISO snooze timestamp if the thread is snoozed; null otherwise.
   *  Surfaced so the row hover actions can show a current snooze state. */
  snoozeUntil: string | null;
  /** Team labels applied to this thread. */
  labels: Array<{ id: string; name: string; color: string | null }>;
  /** Gmail-synced labels on this thread — distinct across every
   *  message, joined to gmail_labels for name + Gmail's bg/text
   *  color. System labels (INBOX, UNREAD, etc) are intentionally
   *  excluded; only user-created labels surface here. */
  gmailLabels: Array<{
    gmailLabelId: string;
    name: string;
    backgroundColor: string | null;
    textColor: string | null;
  }>;
  /** Connected Gmail address this thread flows through. */
  accountEmail: string;
  accountId: string;
  /** Owner of the connected account (the staff member whose Gmail
   *  this is). Distinct from assignedStaff* which is who's working
   *  the thread. */
  accountOwnerId: string;
  accountOwnerName: string | null;
}

/**
 * The core list query. Backed by email_threads_state_last_msg_idx +
 * the FK chip indexes. Fast at 100k threads.
 *
 * Returns up to 200 rows ordered by recency. The middle pane scrolls
 * within that; if real usage hits 200+ unread we'll paginate.
 */
export async function fetchInboxThreads(filter: ThreadListFilter): Promise<InboxThreadRow[]> {
  const slaCutoff = new Date(Date.now() - INBOX_SLA_HOURS * 3_600_000);
  // Gmail-style offset pagination: 50/page by default.
  const pageSize = Math.min(Math.max(filter.pageSize ?? 50, 1), 200);
  const pageOffset = (Math.max(filter.page ?? 1, 1) - 1) * pageSize;

  // Aliased join target for the connected-account OWNER (the staff
  // member whose Gmail this is). Different from the existing
  // staffMembers join which resolves the ASSIGNED operator on the
  // thread. We surface both so thread rows can render "JC ·
  // jc@halloweenbrand.com" with both pieces visible at once.
  const accountOwners = aliasedTable(staffMembers, "account_owners");

  // Drafts + Scheduled are rendered from email_drafts, not threads.
  // Return empty here — the page will branch on the folder slug and
  // render a different middle pane.
  if (filter.folder === "drafts" || filter.folder === "scheduled") {
    return [];
  }

  // Parse Gmail-style operators out of the search string so
  // "from:sarah is:unread invoice" maps to from/isUnread predicates
  // plus a free-text residue ("invoice"). Operators stack with the
  // existing folder-specific predicate via AND.
  const parsed = parseSearchQuery(filter.search);

  // Build the folder-specific predicate. Three shapes:
  //   - Gmail mailbox views filter by direction / is_starred /
  //     snooze_until / deleted_at
  //   - Engine smart views filter by thread state via FOLDER_TO_STATES
  //   - All mailbox views except "trash" hide deleted_at IS NOT NULL
  //   - All mailbox views except "snoozed" hide active snoozes
  const folderPredicate = (() => {
    switch (filter.folder) {
      case "inbox":
        // Gmail "Inbox": active conversations with at least one
        // inbound message; not deleted, not archived, not snoozed.
        return and(
          isNull(emailThreads.deletedAt),
          or(eq(emailThreads.direction, "inbound"), eq(emailThreads.direction, "mixed")),
          ne(emailThreads.state, "archived"),
          or(isNull(emailThreads.snoozeUntil), sql`${emailThreads.snoozeUntil} <= now()`),
        );
      case "sent":
        // Threads we've sent at least one outbound on. Not deleted.
        return and(
          isNull(emailThreads.deletedAt),
          or(eq(emailThreads.direction, "outbound"), eq(emailThreads.direction, "mixed")),
        );
      case "starred":
        // Operator-flagged. Not deleted.
        return and(isNull(emailThreads.deletedAt), eq(emailThreads.isStarred, true));
      case "snoozed":
        // Threads waiting to re-surface. Future snooze only.
        return and(isNull(emailThreads.deletedAt), sql`${emailThreads.snoozeUntil} > now()`);
      case "all_mail":
        // Everything except deleted/trashed.
        return isNull(emailThreads.deletedAt);
      case "archive":
        // Archived conversations — operator manually archived via the
        // bulk toolbar / thread state action. Not deleted. State =
        // 'archived' is the filter — we don't intersect with direction
        // here so archived sent-only threads also surface (the operator
        // archived them for a reason; show them on unarchive).
        return and(isNull(emailThreads.deletedAt), eq(emailThreads.state, "archived"));
      case "trash":
        // Only deleted threads — recoverable view.
        return sql`${emailThreads.deletedAt} IS NOT NULL`;
      case "needs_reply":
      case "waiting":
      case "follow_up":
      case "closed": {
        const states = FOLDER_TO_STATES[filter.folder];
        return and(
          isNull(emailThreads.deletedAt),
          or(isNull(emailThreads.snoozeUntil), sql`${emailThreads.snoozeUntil} <= now()`),
          inArray(
            emailThreads.state,
            states as unknown as Array<
              | "needs_reply"
              | "waiting_on_them"
              | "follow_up_due"
              | "closed_won"
              | "closed_lost"
              | "closed_dnc"
              | "archived"
            >,
          ),
        );
      }
    }
  })();

  const rows = await db
    .select({
      id: emailThreads.id,
      subject: emailThreads.subject,
      snippet: emailThreads.snippet,
      lastMessageAt: emailThreads.lastMessageAt,
      lastInboundAt: emailThreads.lastInboundAt,
      lastSenderName: emailThreads.lastSenderName,
      messageCount: emailThreads.messageCount,
      unreadCount: emailThreads.unreadCount,
      state: emailThreads.state,
      classification: emailThreads.classification,
      assignedStaffId: emailThreads.assignedStaffId,
      assignedStaffName: staffMembers.displayName,
      venueId: emailThreads.venueId,
      venueName: venues.name,
      cityName: cities.name,
      brandName: outreachBrands.displayName,
      cityCampaignId: emailThreads.cityCampaignId,
      campaignName: sql<
        string | null
      >`(SELECT name FROM campaigns WHERE id = ${cityCampaigns.campaignId})`.as("campaign_name"),
      eventDayPart: events.dayPart,
      eventCrawlNumber: events.crawlNumber,
      isStale: emailThreads.isStale,
      staleReason: emailThreads.staleReason,
      staleSince: emailThreads.staleSince,
      isStarred: emailThreads.isStarred,
      snoozeUntilDate: emailThreads.snoozeUntil,
      /** Connected Gmail address this thread flows through — surfaced
       *  on the row as a chip so operators can see "which mailbox"
       *  without opening the thread. Driven by the existing
       *  staffOutreachEmailId join. */
      accountEmail: connectedAccounts.emailAddress,
      accountId: connectedAccounts.id,
      /** Owner of the connected account (the staff member whose
       *  Gmail this is). Distinct from assignedStaffName, which is
       *  who's working the THREAD. */
      accountOwnerId: connectedAccounts.ownerUserId,
      accountOwnerName: accountOwners.displayName,
    })
    .from(emailThreads)
    .leftJoin(venues, eq(venues.id, emailThreads.venueId))
    .leftJoin(cities, eq(cities.id, venues.cityId))
    .leftJoin(outreachBrands, eq(outreachBrands.id, emailThreads.outreachBrandId))
    .leftJoin(staffMembers, eq(staffMembers.id, emailThreads.assignedStaffId))
    .leftJoin(cityCampaigns, eq(cityCampaigns.id, emailThreads.cityCampaignId))
    .leftJoin(events, eq(events.id, emailThreads.eventId))
    // Team-scope join: every thread is ingested through a
    // connected_accounts row (its staffOutreachEmailId). We INNER
    // JOIN to that row so the WHERE below can constrain by
    // team_id (default scope) and optionally owner_user_id
    // ("Mine" toggle). Threads with NULL staffOutreachEmailId
    // are historical / pre-multi-team and are intentionally
    // hidden from the new team-scoped inbox — they should be
    // backfilled with a connected_account before they reappear.
    .innerJoin(connectedAccounts, eq(connectedAccounts.id, emailThreads.staffOutreachEmailId))
    .leftJoin(accountOwners, eq(accountOwners.id, connectedAccounts.ownerUserId))
    .where(
      and(
        // Team scope: ALWAYS applied. Inbox is per-team.
        eq(connectedAccounts.teamId, filter.currentTeamId),
        // "Mine" filter: restricts to the current user's own
        // connected accounts. Off by default — operators want to
        // see the full team inbox so anyone can pick up a thread.
        filter.mine ? eq(connectedAccounts.ownerUserId, filter.currentUserId) : undefined,
        // Folder-specific predicate. Replaces the previous coupled
        // `archivedAt IS NULL + state IN (...)` shape — every folder
        // now declares its own visibility rules (see folderPredicate
        // above). Notably "all_mail" + "trash" intentionally allow
        // through what other views hide.
        folderPredicate,
        filter.assignedStaffId
          ? eq(emailThreads.assignedStaffId, filter.assignedStaffId)
          : undefined,
        filter.cityCampaignId ? eq(emailThreads.cityCampaignId, filter.cityCampaignId) : undefined,
        // campaignId default-scope filter from getCurrentCampaign().
        // Applied as a subquery against city_campaigns rather than a
        // join because we want this to be a constraint, not a
        // multiplier on the result set. When the operator sets a
        // specific cityCampaignId filter (URL ?campaign=<id>), that
        // narrower constraint takes precedence — we skip this filter
        // in that case to avoid redundant SQL.
        // Includes unattributed threads (city_campaign_id IS NULL) so
        // freshly-arrived inbound not yet linked to a city campaign is
        // NOT hidden by campaign scope. Without OR-NULL, selecting a
        // campaign made every unmatched inbound vanish from the inbox.
        filter.campaignId && !filter.cityCampaignId
          ? sql`(
              ${emailThreads.cityCampaignId} IN (
                SELECT id FROM city_campaigns WHERE campaign_id = ${filter.campaignId}
              )
              OR ${emailThreads.cityCampaignId} IS NULL
            )`
          : undefined,
        filter.outreachBrandId
          ? eq(emailThreads.outreachBrandId, filter.outreachBrandId)
          : undefined,
        // Team-label filter — EXISTS subquery on the join table so
        // multi-label threads aren't duplicated.
        filter.labelId
          ? sql`EXISTS (
              SELECT 1 FROM email_thread_labels etl
              WHERE etl.thread_id = ${emailThreads.id}
                AND etl.team_label_id = ${filter.labelId}
            )`
          : undefined,
        // Alias filter — match a specific connected_accounts row.
        filter.aliasId ? eq(emailThreads.staffOutreachEmailId, filter.aliasId) : undefined,
        // Account-switcher filter — narrow to a subset of connected
        // accounts. inArray over a UUID list is index-friendly via the
        // existing staff_outreach_email_id FK. Empty arrays would
        // collapse to "WHERE false" (matches nothing), so we skip
        // emitting the predicate when the list is empty — the
        // operator's intent for an empty list is "default to every
        // account I can see," handled at the URL-param parse layer.
        filter.accountIds && filter.accountIds.length > 0
          ? inArray(emailThreads.staffOutreachEmailId, filter.accountIds)
          : undefined,
        // Scope: Unassigned — threads with no assigned operator.
        filter.unassigned ? isNull(emailThreads.assignedStaffId) : undefined,
        // Scope: Stale — threads flagged by the stale-tagger.
        filter.staleOnly ? eq(emailThreads.isStale, true) : undefined,
        // Scope: Unmatched — inbound threads with no venue linked.
        // Restrict to inbound since outbound is operator-chosen and
        // can't meaningfully be "unmatched."
        filter.unmatchedOnly
          ? and(isNull(emailThreads.venueId), eq(emailThreads.direction, "inbound"))
          : undefined,
        // Scope: Mentioned — threads where the current user has at
        // least one unacknowledged @-mention. EXISTS subquery
        // against email_thread_mentions; the partial index on
        // (mentioned_user_id, created_at) WHERE acknowledged_at
        // IS NULL keeps this cheap (Phase D).
        filter.mentionedOnly
          ? sql`EXISTS (
              SELECT 1 FROM email_thread_mentions etm
              WHERE etm.thread_id = ${emailThreads.id}
                AND etm.mentioned_user_id = ${filter.currentUserId}
                AND etm.acknowledged_at IS NULL
            )`
          : undefined,
        // Operator-aware search. parseSearchQuery splits the raw input
        // into structured operators (`from:`, `subject:`, `is:starred`,
        // etc) + a free-text residue. Each operator becomes its own
        // AND predicate; free text drives the existing OR across
        // subject/snippet/venue/sender plus an EXISTS against the
        // full-text-indexed email_messages.search_tsv (Phase B).
        //
        // The body-search adds an EXISTS subquery using websearch_to_tsquery
        // — that variant accepts natural-language input including quoted
        // phrases ("foo bar") and OR operators without erroring on
        // malformed input. plainto_tsquery would 400 on quotes; we want
        // operators to type freely.
        //
        // Engine-specific operators (campaign:, brand:, venue:,
        // assigned:) override the corresponding top-level filter
        // when both are present — the parsed query is authoritative
        // since it came from the operator's explicit input.
        parsed.freeText
          ? or(
              ilike(emailThreads.subject, `%${parsed.freeText}%`),
              ilike(emailThreads.snippet, `%${parsed.freeText}%`),
              ilike(venues.name, `%${parsed.freeText}%`),
              ilike(emailThreads.lastSenderName, `%${parsed.freeText}%`),
              sql`EXISTS (
                SELECT 1 FROM email_messages em
                WHERE em.thread_id = ${emailThreads.id}
                  AND em.search_tsv @@ websearch_to_tsquery('english', ${parsed.freeText})
              )`,
            )
          : undefined,
        parsed.from ? ilike(emailThreads.lastSenderName, `%${parsed.from}%`) : undefined,
        parsed.subject ? ilike(emailThreads.subject, `%${parsed.subject}%`) : undefined,
        parsed.isStarred ? eq(emailThreads.isStarred, true) : undefined,
        parsed.isUnread ? sql`${emailThreads.unreadCount} > 0` : undefined,
        // is:snoozed override — the folder predicate already handles
        // the snoozed/non-snoozed split, but operators can use
        // is:snoozed from any view to add a snooze filter.
        parsed.isSnoozed ? sql`${emailThreads.snoozeUntil} > now()` : undefined,
        parsed.before ? lte(emailThreads.lastMessageAt, new Date(parsed.before)) : undefined,
        parsed.after ? gte(emailThreads.lastMessageAt, new Date(parsed.after)) : undefined,
        parsed.campaignId ? eq(emailThreads.cityCampaignId, parsed.campaignId) : undefined,
        parsed.brandId ? eq(emailThreads.outreachBrandId, parsed.brandId) : undefined,
        parsed.venueId ? eq(emailThreads.venueId, parsed.venueId) : undefined,
        parsed.assignedStaffId
          ? eq(emailThreads.assignedStaffId, parsed.assignedStaffId)
          : undefined,
        // label:NAME — EXISTS subquery against the join table.
        parsed.label
          ? sql`EXISTS (
              SELECT 1
              FROM email_thread_labels etl
              INNER JOIN team_labels tl ON tl.id = etl.team_label_id
              WHERE etl.thread_id = ${emailThreads.id}
                AND tl.name ILIKE ${`%${parsed.label}%`}
            )`
          : undefined,
      ),
    )
    // Sort by INBOUND activity, not last message: Gmail-style, sending an
    // email must NOT bump its thread to the top -- only a reply from the
    // other side does. Threads with no reply yet fall back to their creation
    // time (stable), so outbound-only cold threads don't jump around as the
    // operator sends. last_message_at still drives the relative-time display.
    .orderBy(sql`COALESCE(${emailThreads.lastInboundAt}, ${emailThreads.createdAt}) DESC`)
    .limit(pageSize)
    .offset(pageOffset);

  // Fetch the labels for all visible threads in one round trip, then
  // attach to the row. Tiny query — limited to the 200 row cap above.
  const threadIds = rows.map((r) => r.id);
  const labelRows = threadIds.length
    ? await db
        .select({
          threadId: emailThreadLabels.threadId,
          id: teamLabels.id,
          name: teamLabels.name,
          color: teamLabels.color,
        })
        .from(emailThreadLabels)
        .innerJoin(teamLabels, eq(teamLabels.id, emailThreadLabels.teamLabelId))
        .where(inArray(emailThreadLabels.threadId, threadIds))
    : [];
  const labelsByThread = new Map<
    string,
    Array<{ id: string; name: string; color: string | null }>
  >();
  for (const lr of labelRows) {
    const arr = labelsByThread.get(lr.threadId) ?? [];
    arr.push({ id: lr.id, name: lr.name, color: lr.color });
    labelsByThread.set(lr.threadId, arr);
  }

  // Gmail labels per thread — distinct labels across every message
  // on the thread, joined to gmail_labels for name + Gmail-synced
  // colors. Skip system labels (INBOX, SENT, UNREAD, etc) — those
  // aren't user-meaningful chips; they're already represented by
  // the folder columns + unread counts. Only "user" type labels
  // make it onto the row.
  const gmailLabelsByThread = new Map<
    string,
    Array<{
      gmailLabelId: string;
      name: string;
      backgroundColor: string | null;
      textColor: string | null;
    }>
  >();
  if (threadIds.length) {
    const gmailLabelRows = await db.execute<{
      thread_id: string;
      gmail_label_id: string;
      name: string;
      background_color: string | null;
      text_color: string | null;
    }>(sql`
      SELECT DISTINCT
        em.thread_id,
        gl.gmail_label_id,
        gl.name,
        gl.background_color,
        gl.text_color
      FROM email_messages em
      INNER JOIN email_threads et ON et.id = em.thread_id
      INNER JOIN gmail_labels gl
        ON gl.connected_account_id = et.staff_outreach_email_id
       AND gl.gmail_label_id = ANY(em.gmail_labels)
      WHERE em.thread_id IN (${sql.join(
        threadIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
        AND gl.type = 'user'
    `);
    const list = Array.isArray(gmailLabelRows)
      ? (gmailLabelRows as unknown as Array<{
          thread_id: string;
          gmail_label_id: string;
          name: string;
          background_color: string | null;
          text_color: string | null;
        }>)
      : ((
          gmailLabelRows as unknown as {
            rows: Array<{
              thread_id: string;
              gmail_label_id: string;
              name: string;
              background_color: string | null;
              text_color: string | null;
            }>;
          }
        ).rows ?? []);
    for (const r of list) {
      const arr = gmailLabelsByThread.get(r.thread_id) ?? [];
      arr.push({
        gmailLabelId: r.gmail_label_id,
        name: r.name,
        backgroundColor: r.background_color,
        textColor: r.text_color,
      });
      gmailLabelsByThread.set(r.thread_id, arr);
    }
  }

  return rows.map((r) => {
    const { snoozeUntilDate, staleSince, ...rest } = r;
    return {
      ...(rest as Omit<
        InboxThreadRow,
        "slaBreached" | "labels" | "gmailLabels" | "snoozeUntil" | "staleDurationLabel"
      >),
      snoozeUntil: snoozeUntilDate ? snoozeUntilDate.toISOString() : null,
      // Compact "Xm" / "Xh" / "Xd" label for the stale pill. Computed
      // server-side so the rendered list is deterministic for snapshot
      // tests + screen readers; the per-tick refresh is fine because
      // stale_since is preserved across ticks (see Rule 5 fix in
      // f9ff147 -- before that the timestamp churned and these
      // labels would have been useless).
      staleDurationLabel: r.isStale && staleSince ? formatStaleDuration(staleSince) : null,
      labels: labelsByThread.get(r.id) ?? [],
      gmailLabels: gmailLabelsByThread.get(r.id) ?? [],
      slaBreached:
        r.state === "needs_reply" && r.lastInboundAt != null && r.lastInboundAt < slaCutoff,
    };
  });
}

/**
 * Format the duration since a thread was first flagged stale as a
 * compact "Xm" / "Xh" / "Xd" label suitable for an inline pill.
 *
 * Thresholds:
 *   < 60 min        -> "Nm"   (e.g. "42m")
 *   < 48 h          -> "Nh"   (e.g. "26h")
 *   >= 48 h         -> "Nd"   (e.g. "3d")
 *
 * The label rounds down (28 minutes is "28m", not "<1h") to avoid
 * giving the operator false precision. Anything older than 1d
 * is bad enough that the exact hour count doesn't matter.
 */
function formatStaleDuration(staleSince: Date): string {
  const ms = Date.now() - staleSince.getTime();
  if (ms < 0) return "0m"; // clock skew defensiveness
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

// =========================================================================
// Folder counts (left sidebar)
// =========================================================================

export async function fetchFolderCounts(opts: {
  currentTeamId: string;
  currentUserId: string;
  mine?: boolean;
  /** Same scope filter as fetchInboxThreads — narrows the count CTE
   *  to a subset of connected accounts so the left-rail counts
   *  reflect what the operator will see when they click into a
   *  folder. */
  accountIds?: string[];
  /** Optional campaign-level scope from the global switcher. When
   *  set, restricts the count CTE to threads on city_campaigns
   *  belonging to this campaign — so left-rail counts match what
   *  the thread list will actually show with the same default scope. */
  campaignId?: string;
}): Promise<Record<InboxFolder, number> & { unassigned: number; assignedToMe: number }> {
  // Pull one count per logical predicate. Rather than one big GROUP BY
  // (which doesn't compose with the new direction / starred / snooze
  // predicates), run a single aggregate query that returns each count
  // in its own column via FILTER. Postgres optimizes this into one
  // table scan.
  //
  // accountIds binding: we pass each id as a separate sql placeholder
  // and join via the IN(...) form. inArray on raw sql is the safest
  // way to avoid string-interpolating UUIDs into a query — every id
  // becomes a $N parameter under the hood.
  const accountFilter =
    opts.accountIds && opts.accountIds.length > 0
      ? sql`AND ca.id IN (${sql.join(
          opts.accountIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`
      : sql``;
  // Campaign filter — IN-subquery against city_campaigns. Skipped
  // when no campaignId is set so the default counts span every
  // campaign on the team.
  const campaignFilter = opts.campaignId
    ? sql`AND (et.city_campaign_id IN (SELECT id FROM city_campaigns WHERE campaign_id = ${opts.campaignId}) OR et.city_campaign_id IS NULL)`
    : sql``;
  const result = await db.execute<{
    inbox: number;
    sent: number;
    starred: number;
    snoozed: number;
    archive: number;
    all_mail: number;
    trash: number;
    needs_reply: number;
    waiting: number;
    follow_up: number;
    closed: number;
    drafts: number;
    scheduled: number;
    unassigned: number;
    assigned_to_me: number;
  }>(sql`
    WITH scoped AS (
      SELECT et.*
      FROM email_threads et
      INNER JOIN connected_accounts ca ON ca.id = et.staff_outreach_email_id
      WHERE ca.team_id = ${opts.currentTeamId}
        ${opts.mine ? sql`AND ca.owner_user_id = ${opts.currentUserId}` : sql``}
        ${accountFilter}
        ${campaignFilter}
    ),
    draft_counts AS (
      SELECT
        COUNT(*) FILTER (WHERE sent_at IS NULL AND scheduled_for IS NULL)::int AS drafts,
        COUNT(*) FILTER (WHERE sent_at IS NULL AND scheduled_for IS NOT NULL)::int AS scheduled
      FROM email_drafts
      WHERE owner_user_id = ${opts.currentUserId}
        AND team_id = ${opts.currentTeamId}
        ${
          opts.campaignId
            ? sql`AND (city_campaign_id IN (SELECT id FROM city_campaigns WHERE campaign_id = ${opts.campaignId}) OR city_campaign_id IS NULL)`
            : sql``
        }
    )
    SELECT
      COUNT(*) FILTER (
        WHERE deleted_at IS NULL
          AND direction IN ('inbound','mixed')
          AND state <> 'archived'
          AND (snooze_until IS NULL OR snooze_until <= now())
      )::int AS inbox,
      COUNT(*) FILTER (
        WHERE deleted_at IS NULL
          AND direction IN ('outbound','mixed')
      )::int AS sent,
      COUNT(*) FILTER (
        WHERE deleted_at IS NULL AND is_starred = true
      )::int AS starred,
      COUNT(*) FILTER (
        WHERE deleted_at IS NULL AND snooze_until > now()
      )::int AS snoozed,
      COUNT(*) FILTER (
        WHERE deleted_at IS NULL
          AND state = 'archived'
      )::int AS archive,
      COUNT(*) FILTER (
        WHERE deleted_at IS NULL
      )::int AS all_mail,
      COUNT(*) FILTER (
        WHERE deleted_at IS NOT NULL
      )::int AS trash,
      COUNT(*) FILTER (
        WHERE deleted_at IS NULL
          AND (snooze_until IS NULL OR snooze_until <= now())
          AND state = 'needs_reply'
      )::int AS needs_reply,
      COUNT(*) FILTER (
        WHERE deleted_at IS NULL
          AND (snooze_until IS NULL OR snooze_until <= now())
          AND state = 'waiting_on_them'
      )::int AS waiting,
      COUNT(*) FILTER (
        WHERE deleted_at IS NULL
          AND (snooze_until IS NULL OR snooze_until <= now())
          AND state = 'follow_up_due'
      )::int AS follow_up,
      COUNT(*) FILTER (
        WHERE deleted_at IS NULL
          AND (snooze_until IS NULL OR snooze_until <= now())
          AND state IN ('closed_won','closed_lost','closed_dnc')
      )::int AS closed,
      -- Unassigned: needs_reply threads with no operator assignee.
      -- Mirror of the per-row "Unassigned" pill predicate so the
      -- FilterBar chip's count matches what the list would show
      -- with ?unassigned=1.
      COUNT(*) FILTER (
        WHERE deleted_at IS NULL
          AND (snooze_until IS NULL OR snooze_until <= now())
          AND state = 'needs_reply'
          AND assigned_staff_id IS NULL
      )::int AS unassigned,
      -- Assigned to me: threads where I'm the operator. State is
      -- not gated to needs_reply (operator may want to see waiting
      -- + follow-ups too); the FilterBar chip narrows further if
      -- needed. Snooze is excluded because snoozed-but-mine
      -- threads aren't on my plate right now.
      COUNT(*) FILTER (
        WHERE deleted_at IS NULL
          AND (snooze_until IS NULL OR snooze_until <= now())
          AND assigned_staff_id = ${opts.currentUserId}::uuid
      )::int AS assigned_to_me,
      (SELECT drafts FROM draft_counts) AS drafts,
      (SELECT scheduled FROM draft_counts) AS scheduled
    FROM scoped
  `);

  const list = Array.isArray(result)
    ? (result as unknown as Array<Record<string, number>>)
    : ((result as unknown as { rows: Array<Record<string, number>> }).rows ?? []);
  const r = list[0] ?? {};

  return {
    inbox: Number(r.inbox ?? 0),
    sent: Number(r.sent ?? 0),
    drafts: Number(r.drafts ?? 0),
    starred: Number(r.starred ?? 0),
    snoozed: Number(r.snoozed ?? 0),
    scheduled: Number(r.scheduled ?? 0),
    archive: Number(r.archive ?? 0),
    all_mail: Number(r.all_mail ?? 0),
    trash: Number(r.trash ?? 0),
    needs_reply: Number(r.needs_reply ?? 0),
    waiting: Number(r.waiting ?? 0),
    follow_up: Number(r.follow_up ?? 0),
    closed: Number(r.closed ?? 0),
    unassigned: Number(r.unassigned ?? 0),
    assignedToMe: Number(r.assigned_to_me ?? 0),
  };
}

// =========================================================================
// Thread detail (right pane)
// =========================================================================

export interface InboxThreadDetail {
  thread: {
    id: string;
    subject: string | null;
    state: ThreadStateValue;
    classification: string;
    /** AI-suggested classification (Phase A.1). Null when the
     *  thread is already operator-classified, or when ai-classify
     *  hasn't run yet for this thread. */
    suggestedClassification: string | null;
    suggestedClassificationConfidence: string | null;
    /** Cached AI 3-line thread summary (Phase A.3). null when
     *  the thread is too short, or hasn't been summarized yet.
     *  Refreshed lazily on view. */
    aiSummary: {
      headline: string;
      context: string;
      next: string;
    } | null;
    aiSummaryAt: Date | null;
    aiSummaryMessageCount: number | null;
    /** Cached AI-enriched next-action suggestion (Phase A.4).
     *  Refreshed lazily when classification or message_count
     *  changes. Layered on top of the rule-based
     *  suggestNextAction — the AI just sharpens the human-facing
     *  label + reason. */
    aiNextAction: {
      label: string;
      reason: string;
      urgency: "now" | "today" | "this_week" | "when_able";
      generatedAt: string;
      classification: string;
    } | null;
    /** Cached AI smart-reply chips (Haiku ROI #1). Array of 3 short
     *  reply suggestions surfaced above the inline reply composer.
     *  null when the thread isn't eligible or hasn't been generated. */
    aiQuickReplies: string[] | null;
    aiQuickRepliesAt: Date | null;
    aiQuickRepliesMessageCount: number | null;
    /** AI-only classification field, used by the smart-reply eligibility
     *  gate before chips are generated. Mirrors suggestedClassification
     *  but exposed under the canonical AI-prefixed name. */
    aiClassification: string | null;
    assignedStaffId: string | null;
    assignedStaffName: string | null;
    /** null when the thread hasn't been matched to a venue yet. */
    venueId: string | null;
    venueName: string | null;
    cityName: string | null;
    cityId: string | null;
    /** null when the thread hasn't been attributed to a brand yet. */
    brandName: string | null;
    cityCampaignId: string | null;
    campaignName: string | null;
    eventId: string | null;
    eventDayPart: string | null;
    eventCrawlNumber: number | null;
    lastMessageAt: Date;
    messageCount: number;
    /** Global unread count on the thread; used by inbox UI to drive
        the "auto mark as read on open" effect + unread badges. */
    unreadCount: number;
    /** Gmail-style star state. */
    isStarred: boolean;
    /** ISO timestamp when the thread re-surfaces from snooze; null = not snoozed. */
    snoozeUntil: string | null;
    /** Gmail's own thread id — used to construct an "Open in Gmail" link. */
    gmailThreadId: string;
  };
  messages: Array<{
    id: string;
    direction: "inbound" | "outbound" | "mixed";
    fromAddress: string;
    fromName: string | null;
    toAddresses: string[];
    ccAddresses: string[];
    subject: string;
    bodyText: string | null;
    bodyHtml: string | null;
    /**
     * Server-sanitized version of bodyHtml, safe to render via
     * dangerouslySetInnerHTML. NULL when the source was empty or
     * stripped to nothing by the sanitizer. See lib/email-sanitize.ts
     * for the strip list. The raw bodyHtml is kept on the type for
     * future use (e.g. download-raw debugging) but should not be
     * rendered in the UI.
     */
    bodySafeHtml: string | null;
    sentAt: Date;
    readAt: Date | null;
    sentByStaffName: string | null;
  }>;
}

export async function fetchThreadDetail(
  threadId: string,
  currentTeamId: string,
): Promise<InboxThreadDetail | null> {
  const threadRow = await db
    .select({
      id: emailThreads.id,
      subject: emailThreads.subject,
      state: emailThreads.state,
      classification: emailThreads.classification,
      // AI-suggested classification (Phase A.1) — null when the
      // thread is already operator-classified, or when ai-classify
      // hasn't run yet.
      suggestedClassification: emailThreads.suggestedClassification,
      suggestedClassificationConfidence: emailThreads.suggestedClassificationConfidence,
      // AI 3-line summary (Phase A.3) — lazy-generated on view
      // when message_count >= 10.
      aiSummary: emailThreads.aiSummary,
      aiSummaryAt: emailThreads.aiSummaryAt,
      aiSummaryMessageCount: emailThreads.aiSummaryMessageCount,
      // Phase A.4
      aiNextAction: emailThreads.aiNextAction,
      // Smart-reply chips cache (Haiku ROI #1)
      aiQuickReplies: emailThreads.aiQuickReplies,
      aiQuickRepliesAt: emailThreads.aiQuickRepliesAt,
      aiQuickRepliesMessageCount: emailThreads.aiQuickRepliesMessageCount,
      // AI-only classification (alias of suggestedClassification for
      // the canonical-named accessor used by the quick-replies
      // eligibility gate).
      aiClassification: emailThreads.suggestedClassification,
      assignedStaffId: emailThreads.assignedStaffId,
      assignedStaffName: staffMembers.displayName,
      venueId: emailThreads.venueId,
      venueName: venues.name,
      cityName: cities.name,
      cityId: venues.cityId,
      brandName: outreachBrands.displayName,
      cityCampaignId: emailThreads.cityCampaignId,
      campaignName: sql<
        string | null
      >`(SELECT name FROM campaigns WHERE id = ${cityCampaigns.campaignId})`.as("campaign_name"),
      eventId: emailThreads.eventId,
      eventDayPart: events.dayPart,
      eventCrawlNumber: events.crawlNumber,
      lastMessageAt: emailThreads.lastMessageAt,
      messageCount: emailThreads.messageCount,
      unreadCount: emailThreads.unreadCount,
      isStarred: emailThreads.isStarred,
      snoozeUntilDate: emailThreads.snoozeUntil,
      gmailThreadId: emailThreads.gmailThreadId,
    })
    .from(emailThreads)
    .leftJoin(venues, eq(venues.id, emailThreads.venueId))
    .leftJoin(cities, eq(cities.id, venues.cityId))
    .leftJoin(outreachBrands, eq(outreachBrands.id, emailThreads.outreachBrandId))
    .leftJoin(staffMembers, eq(staffMembers.id, emailThreads.assignedStaffId))
    .leftJoin(cityCampaigns, eq(cityCampaigns.id, emailThreads.cityCampaignId))
    .leftJoin(events, eq(events.id, emailThreads.eventId))
    // Team-scope guard: inner-join the connected account and require
    // it be on the operator's team, so a thread id from another team
    // returns null (cross-team IDOR via the /inbox/[threadId] route).
    .innerJoin(connectedAccounts, eq(connectedAccounts.id, emailThreads.staffOutreachEmailId))
    .where(and(eq(emailThreads.id, threadId), eq(connectedAccounts.teamId, currentTeamId)))
    .limit(1)
    .then((r) => r[0]);

  if (!threadRow) return null;

  // Reshape: snoozeUntilDate (Date|null) → snoozeUntil (string|null).
  const threadShaped = {
    ...threadRow,
    snoozeUntil: threadRow.snoozeUntilDate ? threadRow.snoozeUntilDate.toISOString() : null,
  } as InboxThreadDetail["thread"];

  const messageRows = await db
    .select({
      id: emailMessages.id,
      direction: emailMessages.direction,
      fromAddress: emailMessages.fromAddress,
      fromName: emailMessages.fromName,
      toAddresses: emailMessages.toAddresses,
      ccAddresses: emailMessages.ccAddresses,
      subject: emailMessages.subject,
      bodyText: emailMessages.bodyText,
      bodyHtml: emailMessages.bodyHtml,
      sentAt: emailMessages.sentAt,
      readAt: emailMessages.readAt,
      sentByStaffName: staffMembers.displayName,
    })
    .from(emailMessages)
    .leftJoin(staffMembers, eq(staffMembers.id, emailMessages.sentByStaffId))
    .where(eq(emailMessages.threadId, threadId))
    .orderBy(emailMessages.sentAt);

  return {
    thread: threadShaped,
    messages: messageRows.map((m) => ({
      ...m,
      // Server-sanitize the HTML body before we let the client touch
      // it. The raw bodyHtml stays on the response too, but the UI
      // should render bodySafeHtml instead.
      bodySafeHtml: sanitizeEmailHtml(m.bodyHtml),
    })) as InboxThreadDetail["messages"],
  };
}

// =========================================================================
// Outreach history rail (right pane CRM)
// =========================================================================

export interface VenueOutreachHistoryEntry {
  id: string;
  channel: string;
  outcome: string;
  subject: string | null;
  bodySnippet: string | null;
  createdAt: Date;
  staffName: string | null;
  brandName: string | null;
}

/**
 * Last N outreach_log entries for a venue across all brands. Powers the
 * "previous outreach history" section in the CRM rail.
 */
export async function fetchVenueOutreachHistory(
  venueId: string,
  limit = 12,
): Promise<VenueOutreachHistoryEntry[]> {
  const rows = await db
    .select({
      id: outreachLog.id,
      channel: outreachLog.channel,
      outcome: outreachLog.outcome,
      subject: outreachLog.subject,
      bodySnippet: outreachLog.bodySnippet,
      createdAt: outreachLog.createdAt,
      staffName: staffMembers.displayName,
      brandName: outreachBrands.displayName,
    })
    .from(outreachLog)
    .leftJoin(staffMembers, eq(staffMembers.id, outreachLog.staffMemberId))
    .leftJoin(outreachBrands, eq(outreachBrands.id, outreachLog.outreachBrandId))
    .where(eq(outreachLog.venueId, venueId))
    .orderBy(desc(outreachLog.createdAt))
    .limit(limit);

  return rows as VenueOutreachHistoryEntry[];
}

/**
 * Current venue_events bookings for this venue — shows whether the venue
 * already has a slot in some upcoming crawl.
 *
 * Note: venue_events does not have an archived_at column (see CLAUDE.md
 * — only entities with soft delete have it). venue_events lifecycle is
 * driven by status, not by archive.
 */
export async function fetchVenueCurrentBookings(venueId: string) {
  return db
    .select({
      venueEventId: venueEvents.id,
      status: venueEvents.status,
      role: venueEvents.role,
      eventId: venueEvents.eventId,
    })
    .from(venueEvents)
    .where(eq(venueEvents.venueId, venueId))
    .limit(20);
}

// =========================================================================
// Alias list for inbox filter (session 11 #027 — multi-alias)
// =========================================================================

/**
 * Email aliases (connected_accounts rows) available as inbox filter
 * options.
 *
 * Default scope (post commit 4): every connected account on the
 * current user's team. The inbox is now shared across the team, so
 * the alias picker shows ALL team accounts and the operator can
 * filter by any of them.
 *
 * `mine` narrows to the current user's accounts only — useful when
 * the operator wants to triage just their own inbox.
 *
 * Status filter excludes 'disconnected' aliases so the dropdown
 * doesn't show stale options; 'connected' AND 'needs_reauth' are
 * both visible so the operator can spot which alias is broken.
 */
import {
  emailThreadLabels,
  gmailLabels as gmailLabelsTable,
  staffOutreachEmails,
  teamLabels,
} from "@/db/schema";

export interface InboxAliasOption {
  id: string;
  emailAddress: string;
  staffDisplayName: string | null;
}

export async function fetchInboxAliases(opts: {
  currentTeamId: string;
  currentUserId: string;
  /** When true, only list the current user's own aliases. */
  mine?: boolean;
}): Promise<InboxAliasOption[]> {
  const rows = await db
    .select({
      id: staffOutreachEmails.id,
      emailAddress: staffOutreachEmails.emailAddress,
      staffDisplayName: staffMembers.displayName,
      ownerUserId: staffOutreachEmails.ownerUserId,
      teamId: staffOutreachEmails.teamId,
      status: staffOutreachEmails.status,
    })
    .from(staffOutreachEmails)
    .leftJoin(staffMembers, eq(staffMembers.id, staffOutreachEmails.ownerUserId))
    .where(
      and(
        eq(staffOutreachEmails.teamId, opts.currentTeamId),
        opts.mine ? eq(staffOutreachEmails.ownerUserId, opts.currentUserId) : undefined,
      ),
    );

  return rows
    .filter((r) => r.status === "connected" || r.status === "needs_reauth")
    .map((r) => ({
      id: r.id,
      emailAddress: r.emailAddress,
      staffDisplayName: r.staffDisplayName,
    }))
    .sort((a, b) => a.emailAddress.localeCompare(b.emailAddress));
}

export interface InboxFilterFacet {
  id: string;
  label: string;
  /** Open-thread count for this facet on the current scope. */
  count: number;
}

export interface InboxFilterFacets {
  campaigns: InboxFilterFacet[];
  brands: InboxFilterFacet[];
  /** Team labels with at least one OPEN thread attached.
   *  Each carries an optional color for the dot. */
  labels: Array<InboxFilterFacet & { color: string | null }>;
}

/**
 * Build the campaign + brand filter chips for the inbox left rail.
 *
 * Scoping rules:
 *   - Only facets that have at least one OPEN thread are returned
 *     (no point showing a dead brand with zero unread threads)
 *   - Open threads are everything except `archived`. The folder
 *     definitions in FOLDER_TO_STATES draw the same boundary.
 *   - Team-scoped via connected_accounts.team_id (same path as
 *     fetchInboxThreads — threads have no direct teamId)
 *   - When opts.mine is true, narrow to threads on the user's
 *     own connected_accounts only — matches the "Mine" toggle.
 *
 * Returned arrays are sorted by descending count (most-active
 * brand/campaign first), tie-broken by name. Caller decides
 * truncation; we don't cap here.
 */
export async function fetchInboxFilterFacets(opts: {
  currentTeamId: string;
  currentUserId: string;
  mine?: boolean;
}): Promise<InboxFilterFacets> {
  // One query each — joins to the brand/campaign rows so we can
  // surface display names + ids together.
  const campaignRows = await db
    .select({
      id: cityCampaigns.id,
      city: cities.name,
      campaignName: campaigns.name,
      count: sql<number>`count(${emailThreads.id})::int`,
    })
    .from(emailThreads)
    .innerJoin(connectedAccounts, eq(connectedAccounts.id, emailThreads.staffOutreachEmailId))
    .innerJoin(cityCampaigns, eq(cityCampaigns.id, emailThreads.cityCampaignId))
    .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
    .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
    .where(
      and(
        eq(connectedAccounts.teamId, opts.currentTeamId),
        opts.mine ? eq(connectedAccounts.ownerUserId, opts.currentUserId) : undefined,
        ne(emailThreads.state, "archived"),
      ),
    )
    .groupBy(cityCampaigns.id, cities.name, campaigns.name);

  const brandRows = await db
    .select({
      id: outreachBrands.id,
      displayName: outreachBrands.displayName,
      count: sql<number>`count(${emailThreads.id})::int`,
    })
    .from(emailThreads)
    .innerJoin(connectedAccounts, eq(connectedAccounts.id, emailThreads.staffOutreachEmailId))
    .innerJoin(outreachBrands, eq(outreachBrands.id, emailThreads.outreachBrandId))
    .where(
      and(
        eq(connectedAccounts.teamId, opts.currentTeamId),
        opts.mine ? eq(connectedAccounts.ownerUserId, opts.currentUserId) : undefined,
        ne(emailThreads.state, "archived"),
      ),
    )
    .groupBy(outreachBrands.id, outreachBrands.displayName);

  // Team labels — Gmail-style filter chips in the left rail. Same
  // scope rules as brand/campaign: open threads only, team-scoped,
  // honor the mine toggle. JOIN through email_thread_labels.
  const labelRows = await db
    .select({
      id: teamLabels.id,
      name: teamLabels.name,
      color: teamLabels.color,
      count: sql<number>`count(${emailThreads.id})::int`,
    })
    .from(emailThreads)
    .innerJoin(connectedAccounts, eq(connectedAccounts.id, emailThreads.staffOutreachEmailId))
    .innerJoin(emailThreadLabels, eq(emailThreadLabels.threadId, emailThreads.id))
    .innerJoin(teamLabels, eq(teamLabels.id, emailThreadLabels.teamLabelId))
    .where(
      and(
        eq(connectedAccounts.teamId, opts.currentTeamId),
        opts.mine ? eq(connectedAccounts.ownerUserId, opts.currentUserId) : undefined,
        ne(emailThreads.state, "archived"),
        isNull(emailThreads.deletedAt),
      ),
    )
    .groupBy(teamLabels.id, teamLabels.name, teamLabels.color);

  return {
    campaigns: campaignRows
      .map((r) => ({
        id: r.id,
        label: formatCampaignLabel(r.city, r.campaignName),
        count: r.count,
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    brands: brandRows
      .map((r) => ({ id: r.id, label: r.displayName, count: r.count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    labels: labelRows
      .map((r) => ({ id: r.id, label: r.name, count: r.count, color: r.color }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
  };
}

function formatCampaignLabel(city: string | null, campaignName: string | null): string {
  if (city && campaignName) return `${city} · ${campaignName}`;
  return city ?? campaignName ?? "(unnamed)";
}

// =========================================================================
// Drafts + Scheduled list (Gmail-style mailbox views)
// =========================================================================

export interface DraftListRow {
  id: string;
  subject: string;
  /** First non-empty body line — Gmail-style snippet. */
  snippet: string;
  toAddresses: string[];
  updatedAt: Date;
  scheduledFor: Date | null;
  /** Display name of the From inbox if connected_account_id is set. */
  fromEmailAddress: string | null;
  /** Composer auto-attached venue (when opened from a venue context). */
  venueName: string | null;
}

/**
 * List drafts visible to the operator. Two modes:
 *   - mode='drafts'    — sent_at IS NULL AND scheduled_for IS NULL
 *   - mode='scheduled' — sent_at IS NULL AND scheduled_for IS NOT NULL
 *
 * Owner-scoped (drafts are private to their creator, like Gmail). Team
 * admins could see other staff's drafts in a future iteration, but v1
 * keeps the privacy model conservative.
 */
export async function fetchDraftList(opts: {
  currentUserId: string;
  currentTeamId: string;
  mode: "drafts" | "scheduled";
  /** Optional campaign-level scope from the global switcher. When set,
   *  restricts the list to drafts on city_campaigns belonging to this
   *  campaign (OR unattributed drafts with city_campaign_id IS NULL) --
   *  the same predicate the draft_counts CTE in fetchFolderCounts uses,
   *  so the Drafts/Scheduled list matches its left-rail count under the
   *  same default scope. Skipped when undefined so drafts span every
   *  campaign on the team. */
  campaignId?: string;
}): Promise<DraftListRow[]> {
  const rows = await db
    .select({
      id: emailDrafts.id,
      subject: emailDrafts.subject,
      bodyText: emailDrafts.bodyText,
      toAddresses: emailDrafts.toAddresses,
      updatedAt: emailDrafts.updatedAt,
      scheduledFor: emailDrafts.scheduledFor,
      fromEmailAddress: connectedAccounts.emailAddress,
      venueName: venues.name,
    })
    .from(emailDrafts)
    .leftJoin(connectedAccounts, eq(connectedAccounts.id, emailDrafts.connectedAccountId))
    .leftJoin(venues, eq(venues.id, emailDrafts.venueId))
    .where(
      and(
        eq(emailDrafts.ownerUserId, opts.currentUserId),
        eq(emailDrafts.teamId, opts.currentTeamId),
        isNull(emailDrafts.sentAt),
        opts.mode === "scheduled"
          ? sql`${emailDrafts.scheduledFor} IS NOT NULL`
          : isNull(emailDrafts.scheduledFor),
        // Campaign default-scope filter -- mirrors the draft_counts CTE
        // in fetchFolderCounts so the list and its count stay
        // consistent. Includes unattributed drafts (city_campaign_id IS
        // NULL) so a freshly-composed draft not yet linked to a city
        // campaign is not hidden by campaign scope.
        opts.campaignId
          ? sql`(
              ${emailDrafts.cityCampaignId} IN (
                SELECT id FROM city_campaigns WHERE campaign_id = ${opts.campaignId}
              )
              OR ${emailDrafts.cityCampaignId} IS NULL
            )`
          : undefined,
      ),
    )
    .orderBy(
      // Scheduled view sorts by send-time ascending (next-to-go first);
      // Drafts view sorts by recency descending.
      opts.mode === "scheduled" ? asc(emailDrafts.scheduledFor) : desc(emailDrafts.updatedAt),
    )
    .limit(200);

  return rows.map((r) => ({
    id: r.id,
    subject: r.subject || "(no subject)",
    snippet: firstLine(r.bodyText),
    toAddresses: r.toAddresses ?? [],
    updatedAt: r.updatedAt,
    scheduledFor: r.scheduledFor,
    fromEmailAddress: r.fromEmailAddress,
    venueName: r.venueName,
  }));
}

function firstLine(s: string | null): string {
  if (!s) return "";
  const stripped = s.trim();
  if (!stripped) return "";
  const eol = stripped.indexOf("\n");
  return (eol === -1 ? stripped : stripped.slice(0, eol)).slice(0, 140);
}

// =========================================================================
// Gmail labels (left rail mirror)
// =========================================================================

export interface TeamGmailLabel {
  /** gmail_label_id — stable id from Gmail itself. */
  gmailLabelId: string;
  /** Display name (may include slashes for nested labels). */
  name: string;
  type: "user" | "system";
  /** Aggregate unread count across all the team's accounts that carry this label. */
  unreadCount: number;
  /** Background color from Gmail's color config, if set. */
  backgroundColor: string | null;
}

/**
 * Fetch the team's Gmail labels for the left rail. Aggregates across
 * every connected_account on the team — if two operators each have a
 * "Renewals" label in their own Gmail, the left rail shows one
 * "Renewals" entry with the combined unread count.
 *
 * Filters to user-defined labels (skips system labels like INBOX,
 * SENT, TRASH which duplicate our existing mailbox views).
 */
export async function fetchTeamGmailLabels(opts: {
  currentTeamId: string;
}): Promise<TeamGmailLabel[]> {
  // Pull the mirrored label metadata first (name + color from Gmail).
  const labelRows = await db
    .select({
      gmailLabelId: gmailLabelsTable.gmailLabelId,
      name: gmailLabelsTable.name,
      type: gmailLabelsTable.type,
      backgroundColor: gmailLabelsTable.backgroundColor,
    })
    .from(gmailLabelsTable)
    .innerJoin(connectedAccounts, eq(connectedAccounts.id, gmailLabelsTable.connectedAccountId))
    .where(
      and(eq(connectedAccounts.teamId, opts.currentTeamId), eq(gmailLabelsTable.type, "user")),
    );

  if (labelRows.length === 0) return [];

  // Derive unread counts from our own email_messages.gmail_labels
  // array — more accurate than gmail_labels.unread_count (which goes
  // stale between syncs) and zero extra Gmail API calls. Counts each
  // distinct thread that has an inbound message tagged with the label
  // and isn't archived / deleted on our side.
  //
  // This is one query per render rather than per-label since we use
  // unnest() + GROUP BY on the label id.
  const countRows = (await db.execute<{ label_id: string; unread: number }>(sql`
    SELECT label_id, COUNT(DISTINCT thread_id)::int AS unread
    FROM (
      SELECT
        unnest(em.gmail_labels) AS label_id,
        em.thread_id
      FROM email_messages em
      INNER JOIN email_threads et ON et.id = em.thread_id
      INNER JOIN connected_accounts ca ON ca.id = et.staff_outreach_email_id
      WHERE ca.team_id = ${opts.currentTeamId}
        AND et.deleted_at IS NULL
        AND et.state != 'archived'
        AND et.unread_count > 0
    ) labeled
    GROUP BY label_id
  `)) as unknown as
    | { rows?: Array<{ label_id: string; unread: number }> }
    | Array<{ label_id: string; unread: number }>;
  const countList = Array.isArray(countRows) ? countRows : (countRows.rows ?? []);
  const countByLabelId = new Map(countList.map((r) => [r.label_id, r.unread]));

  // Collapse identically-named labels across accounts. Pick the
  // first color we see for visual consistency. Sum unread counts
  // from countByLabelId across each Gmail label id that maps to
  // the same display name.
  const byName = new Map<string, TeamGmailLabel>();
  for (const r of labelRows) {
    const unread = countByLabelId.get(r.gmailLabelId) ?? 0;
    const cur = byName.get(r.name);
    if (cur) {
      cur.unreadCount += unread;
    } else {
      byName.set(r.name, {
        gmailLabelId: r.gmailLabelId,
        name: r.name,
        type: r.type as "user" | "system",
        unreadCount: unread,
        backgroundColor: r.backgroundColor,
      });
    }
  }

  return Array.from(byName.values()).sort(
    (a, b) => b.unreadCount - a.unreadCount || a.name.localeCompare(b.name),
  );
}

// =========================================================================
// fetchThreadTasks — Phase A.2
// =========================================================================

/**
 * Open tasks targeting this thread. Used by the inbox CRM rail
 * to surface AI-extracted follow-ups + any manual tasks the
 * operator has pinned to the conversation.
 *
 * Returns pending tasks only, ordered by due date (soonest
 * first). Capped at 10 — anything beyond that is in the main
 * tasks list, not the rail.
 */
export interface ThreadTaskRow {
  id: string;
  title: string;
  dueAt: Date | null;
  source: string;
  status: string;
  assignedStaffName: string | null;
  /** True when this task was auto-created by the AI extractor
   *  (source = 'smart_note'). Drives the violet "AI" badge. */
  isAi: boolean;
  /** Excerpted reason — first non-empty description line OR
   *  empty when the description was generic. Used in tooltips. */
  excerpt: string | null;
}

export async function fetchThreadTasks(threadId: string): Promise<ThreadTaskRow[]> {
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      dueAt: tasks.dueAt,
      source: tasks.source,
      status: tasks.status,
      description: tasks.description,
      assignedStaffName: staffMembers.displayName,
    })
    .from(tasks)
    .leftJoin(staffMembers, eq(staffMembers.id, tasks.assignedStaffId))
    .where(and(eq(tasks.targetType, "email_thread"), eq(tasks.targetId, threadId)))
    .orderBy(tasks.status, tasks.dueAt)
    .limit(10);

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    dueAt: r.dueAt,
    source: r.source,
    status: r.status,
    assignedStaffName: r.assignedStaffName,
    isAi: r.source === "smart_note",
    excerpt: r.description
      ? (r.description.split("\n").find((l) => l.trim().length > 0) ?? null)
      : null,
  }));
}
