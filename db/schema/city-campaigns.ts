/**
 * city_campaigns — the junction table representing "this city under this
 * campaign," with per-campaign priority and targets.
 *
 * Per DECISIONS.md#007: priority lives HERE, not on cities. A college town
 * may be priority 1 for St. Paddy's and priority 4 for Halloween.
 */

import { sql } from "drizzle-orm";
import { bigint, index, pgTable, smallint, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { auditColumns, idColumn, versionColumn } from "../types";
import { campaigns } from "./campaigns";
import { cityCampaignStatus } from "./enums";
import { cities } from "./geography";
import { staffMembers } from "./users";

export const cityCampaigns = pgTable(
  "city_campaigns",
  {
    ...idColumn,

    cityId: uuid("city_id")
      .notNull()
      .references(() => cities.id, { onDelete: "restrict" }),

    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),

    // 1 = highest priority, 10 = lowest. Per-campaign (#007).
    priority: smallint("priority").notNull().default(5),

    // Target venue mix for this city/campaign. Defaults match the operator's
    // standard crawl shape (1 wristband + 2 middle + 1 final = 4 venues).
    targetVenueCount: smallint("target_venue_count").notNull().default(4),
    targetWristbandCount: smallint("target_wristband_count").notNull().default(1),
    targetFinalCount: smallint("target_final_count").notNull().default(1),
    targetMiddleCount: smallint("target_middle_count").notNull().default(2),

    // Live sales figure (synced from Eventbrite payouts, Phase 8).
    // Gross REVENUE in cents for the whole city x campaign — read-only
    // synced, never operator-edited. Do NOT confuse with
    // events.ticket_sales_count, which is a per-crawl ticket COUNT
    // (that one drives effective priority + cancellation review).
    currentSalesCents: bigint("current_sales_cents", { mode: "bigint" }).notNull().default(sql`0`),

    // Per-city revenue target if set by admin (Section 7.4 goals).
    salesGoalCents: bigint("sales_goal_cents", { mode: "bigint" }),

    // Who owns this city for this campaign. Used by the workload balancer.
    leadStaffId: uuid("lead_staff_id").references(() => staffMembers.id),

    /**
     * Short free-text note shown inline on the tracker dashboard.
     * One-liner like "JC chasing 2-week confirm" — separate from the
     * polymorphic notes table (which is author-attributed + longer).
     * Any operator can edit; no history.
     */
    dashboardNote: text("dashboard_note"),

    status: cityCampaignStatus("status").notNull().default("planning"),

    ...auditColumns,
    ...versionColumn,
  },
  (table) => ({
    cityCampaignUnique: uniqueIndex("city_campaigns_city_campaign_unique").on(
      table.cityId,
      table.campaignId,
    ),
    campaignPriorityIdx: index("city_campaigns_campaign_priority_idx").on(
      table.campaignId,
      table.priority,
    ),
    leadStaffIdx: index("city_campaigns_lead_staff_idx").on(table.leadStaffId),
    statusIdx: index("city_campaigns_status_idx").on(table.status),
  }),
);

export type CityCampaign = typeof cityCampaigns.$inferSelect;
export type NewCityCampaign = typeof cityCampaigns.$inferInsert;
