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
    revenueGoalCents: bigint("revenue_goal_cents", { mode: "bigint" }),
    venueCountGoal: integer("venue_count_goal"),

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
