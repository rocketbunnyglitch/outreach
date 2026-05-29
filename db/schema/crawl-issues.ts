/**
 * Crawl issues — live-support issue logging.
 *
 * Raised during (or about) a crawl, often from an incoming call: "venue isn't
 * expecting us", "door is turning people away", etc. Links loosely to a crawl
 * (event), venue, and city_campaign so the support tab can group + scope them;
 * all are nullable because an issue can be logged before it's fully attributed.
 */

import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { auditColumns, idColumn, versionColumn } from "../types";
import { cityCampaigns } from "./city-campaigns";
import { crawlIssueSeverity, crawlIssueStatus, crawlIssueType } from "./enums";
import { events } from "./events";
import { staffMembers } from "./users";
import { venues } from "./venues";

export const crawlIssues = pgTable(
  "crawl_issues",
  {
    ...idColumn,

    // Loose attribution — any may be null. event_id pins the specific crawl;
    // city_campaign_id scopes to campaign/city when no event is chosen.
    cityCampaignId: uuid("city_campaign_id").references(() => cityCampaigns.id, {
      onDelete: "set null",
    }),
    eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
    venueId: uuid("venue_id").references(() => venues.id, { onDelete: "set null" }),

    issueType: crawlIssueType("issue_type").notNull(),
    severity: crawlIssueSeverity("severity").notNull().default("medium"),
    status: crawlIssueStatus("status").notNull().default("open"),

    /** Free-text caller/contact (name or number) — links to call_logs later. */
    callerContact: text("caller_contact"),
    assignedStaffId: uuid("assigned_staff_id").references(() => staffMembers.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),

    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by").references(() => staffMembers.id, { onDelete: "set null" }),

    ...auditColumns,
    ...versionColumn,
  },
  (table) => ({
    statusIdx: index("crawl_issues_status_idx").on(table.status),
    eventIdx: index("crawl_issues_event_idx").on(table.eventId),
    cityCampaignIdx: index("crawl_issues_city_campaign_idx").on(table.cityCampaignId),
    assignedIdx: index("crawl_issues_assigned_idx").on(table.assignedStaffId),
    createdAtIdx: index("crawl_issues_created_at_idx").on(table.createdAt),
  }),
);

export type CrawlIssue = typeof crawlIssues.$inferSelect;
export type NewCrawlIssue = typeof crawlIssues.$inferInsert;
