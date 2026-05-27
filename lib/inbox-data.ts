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
  cities,
  cityCampaigns,
  emailMessages,
  emailThreads,
  outreachBrands,
  outreachLog,
  staffMembers,
  venueEvents,
  venues,
} from "@/db/schema";
import { db } from "@/lib/db";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

// =========================================================================
// Folders
// =========================================================================

/**
 * URL slug → thread_state values it includes. "Closed" rolls up three
 * underlying states (won/lost/dnc) so the operator doesn't have to think
 * about the difference when triaging.
 */
export const FOLDER_TO_STATES: Record<InboxFolder, readonly ThreadStateValue[]> = {
  needs_reply: ["needs_reply"],
  waiting: ["waiting_on_them"],
  follow_up: ["follow_up_due"],
  closed: ["closed_won", "closed_lost", "closed_dnc"],
  all: [
    "needs_reply",
    "waiting_on_them",
    "follow_up_due",
    "closed_won",
    "closed_lost",
    "closed_dnc",
  ],
};

export const INBOX_FOLDERS = ["needs_reply", "waiting", "follow_up", "closed", "all"] as const;
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
  needs_reply: "Needs Reply",
  waiting: "Waiting On Them",
  follow_up: "Follow-Up Due",
  closed: "Closed",
  all: "All Mail",
};

export function isInboxFolder(value: string | undefined | null): value is InboxFolder {
  return value != null && (INBOX_FOLDERS as readonly string[]).includes(value);
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
  assignedStaffId?: string;
  cityCampaignId?: string;
  outreachBrandId?: string;
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
  venueId: string;
  venueName: string;
  cityName: string | null;
  brandName: string;
  cityCampaignId: string | null;
  campaignName: string | null;
  eventDayPart: string | null;
  eventCrawlNumber: number | null;
  slaBreached: boolean;
}

/**
 * The core list query. Backed by email_threads_state_last_msg_idx +
 * the FK chip indexes. Fast at 100k threads.
 *
 * Returns up to 200 rows ordered by recency. The middle pane scrolls
 * within that; if real usage hits 200+ unread we'll paginate.
 */
export async function fetchInboxThreads(filter: ThreadListFilter): Promise<InboxThreadRow[]> {
  const states = FOLDER_TO_STATES[filter.folder];
  const slaCutoff = new Date(Date.now() - INBOX_SLA_HOURS * 3_600_000);

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
    })
    .from(emailThreads)
    .innerJoin(venues, eq(venues.id, emailThreads.venueId))
    .leftJoin(cities, eq(cities.id, venues.cityId))
    .innerJoin(outreachBrands, eq(outreachBrands.id, emailThreads.outreachBrandId))
    .leftJoin(staffMembers, eq(staffMembers.id, emailThreads.assignedStaffId))
    .leftJoin(cityCampaigns, eq(cityCampaigns.id, emailThreads.cityCampaignId))
    .leftJoin(events, eq(events.id, emailThreads.eventId))
    .where(
      and(
        isNull(emailThreads.archivedAt),
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
        filter.assignedStaffId
          ? eq(emailThreads.assignedStaffId, filter.assignedStaffId)
          : undefined,
        filter.cityCampaignId ? eq(emailThreads.cityCampaignId, filter.cityCampaignId) : undefined,
        filter.outreachBrandId
          ? eq(emailThreads.outreachBrandId, filter.outreachBrandId)
          : undefined,
      ),
    )
    .orderBy(desc(emailThreads.lastMessageAt))
    .limit(200);

  return rows.map((r) => ({
    ...(r as Omit<InboxThreadRow, "slaBreached">),
    slaBreached:
      r.state === "needs_reply" && r.lastInboundAt != null && r.lastInboundAt < slaCutoff,
  }));
}

// =========================================================================
// Folder counts (left sidebar)
// =========================================================================

export async function fetchFolderCounts(): Promise<Record<InboxFolder, number>> {
  const rows = await db
    .select({
      state: emailThreads.state,
      count: sql<number>`count(*)::int`,
    })
    .from(emailThreads)
    .where(isNull(emailThreads.archivedAt))
    .groupBy(emailThreads.state);

  const byState = new Map<string, number>();
  for (const r of rows) byState.set(r.state, r.count);

  const sumStates = (states: readonly string[]): number =>
    states.reduce((acc, s) => acc + (byState.get(s) ?? 0), 0);

  return {
    needs_reply: sumStates(FOLDER_TO_STATES.needs_reply),
    waiting: sumStates(FOLDER_TO_STATES.waiting),
    follow_up: sumStates(FOLDER_TO_STATES.follow_up),
    closed: sumStates(FOLDER_TO_STATES.closed),
    all: sumStates(FOLDER_TO_STATES.all),
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
    assignedStaffId: string | null;
    assignedStaffName: string | null;
    venueId: string;
    venueName: string;
    cityName: string | null;
    cityId: string | null;
    brandName: string;
    cityCampaignId: string | null;
    campaignName: string | null;
    eventId: string | null;
    eventDayPart: string | null;
    eventCrawlNumber: number | null;
    lastMessageAt: Date;
    messageCount: number;
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
    sentAt: Date;
    readAt: Date | null;
    sentByStaffName: string | null;
  }>;
}

export async function fetchThreadDetail(threadId: string): Promise<InboxThreadDetail | null> {
  const threadRow = await db
    .select({
      id: emailThreads.id,
      subject: emailThreads.subject,
      state: emailThreads.state,
      classification: emailThreads.classification,
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
    })
    .from(emailThreads)
    .innerJoin(venues, eq(venues.id, emailThreads.venueId))
    .leftJoin(cities, eq(cities.id, venues.cityId))
    .innerJoin(outreachBrands, eq(outreachBrands.id, emailThreads.outreachBrandId))
    .leftJoin(staffMembers, eq(staffMembers.id, emailThreads.assignedStaffId))
    .leftJoin(cityCampaigns, eq(cityCampaigns.id, emailThreads.cityCampaignId))
    .leftJoin(events, eq(events.id, emailThreads.eventId))
    .where(eq(emailThreads.id, threadId))
    .limit(1)
    .then((r) => r[0]);

  if (!threadRow) return null;

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
    thread: threadRow as InboxThreadDetail["thread"],
    messages: messageRows as InboxThreadDetail["messages"],
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
