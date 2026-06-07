/**
 * Campaign — a holiday or themed event series under both an OutreachBrand
 * and a CrawlBrand (DECISIONS.md#010).
 *
 * Example: "St. Paddy's 2026 Boston, presented as StPaddysCrawl, with outreach
 * handled by Eventsperse" is one Campaign with crawl_brand_id = stpaddyscrawl
 * and outreach_brand_id = eventsperse.
 *
 * 2–3 campaigns concurrently active is the normal operating envelope.
 */

import {
  bigint,
  date,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { archivedAt, auditColumns, idColumn, versionColumn } from "../types";
import { crawlBrands, outreachBrands } from "./brands";
import { campaignStatus, holidayType } from "./enums";

export const campaigns = pgTable(
  "campaigns",
  {
    ...idColumn,

    slug: text("slug").notNull(),
    name: text("name").notNull(), // e.g. "St. Paddy's 2026"
    /** Short label for tight/mobile UI (e.g. "IHLWN26"). NULL -> fall back to
     *  `name` (truncated). Migration 0122. */
    shortName: text("short_name"),

    // Both brand FKs are NOT NULL. Every campaign has one of each.
    outreachBrandId: uuid("outreach_brand_id")
      .notNull()
      .references(() => outreachBrands.id, { onDelete: "restrict" }),

    crawlBrandId: uuid("crawl_brand_id")
      .notNull()
      .references(() => crawlBrands.id, { onDelete: "restrict" }),

    holidayType: holidayType("holiday_type").notNull(),
    status: campaignStatus("status").notNull().default("planning"),

    startDate: date("start_date"),
    endDate: date("end_date"),

    // Optional public subdomain for the external map page consuming the
    // public JSON API. e.g. "stpaddys2026" → stpaddys2026.stpaddyscrawl.com.
    // The engine doesn't host this; the JSON API is the integration point.
    publicSubdomain: text("public_subdomain"),

    // Top-down goals (Section 7.4 of the spec).
    //
    // OLD goal columns — kept for backwards compatibility with the
    // existing UI but deprecated. They will be dropped in a follow-up
    // migration once decision #025 is fully shipped.
    revenueGoalCents: bigint("revenue_goal_cents", { mode: "bigint" }),
    venueCountGoal: integer("venue_count_goal"),

    // NEW goal columns (DECISIONS.md #025, migration 0026):
    /**
     * Outreach-team goal: how many cities should have crawls
     * scheduled by end of campaign window. Visible to all roles.
     */
    targetCitiesScheduled: integer("target_cities_scheduled"),
    /**
     * Outreach-team goal: cities with priority <= this number must
     * be scheduled before lower-priority work. Visible to all roles.
     */
    maxPriorityForScheduling: integer("max_priority_for_scheduling"),
    /**
     * Admin-only goal: total ticket sales target across all cities
     * in the campaign. NOT cents — a count of tickets sold.
     * Editable on /admin/goals.
     */
    targetTicketSalesCount: integer("target_ticket_sales_count"),

    // Gmail label the engine auto-applies to threads it sends for this
    // campaign, mirrored to Gmail so engine + manual sends are tagged
    // identically (e.g. "halloween 2026"). NULL = no auto-tagging.
    // Set on /campaign-info. The city name is applied as a second label
    // when the send is attributed to a city.
    outreachGmailLabel: text("outreach_gmail_label"),

    ...archivedAt,
    ...auditColumns,
    ...versionColumn,
  },
  (table) => ({
    slugUnique: uniqueIndex("campaigns_slug_unique").on(table.slug),
    outreachBrandIdx: index("campaigns_outreach_brand_idx").on(table.outreachBrandId),
    crawlBrandIdx: index("campaigns_crawl_brand_idx").on(table.crawlBrandId),
    statusIdx: index("campaigns_status_idx").on(table.status),
    holidayIdx: index("campaigns_holiday_idx").on(table.holidayType),
    dateRangeIdx: index("campaigns_date_range_idx").on(table.startDate, table.endDate),
  }),
);

export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
