/**
 * goals — top-down targets set by admin (DECISIONS.md: top-down per owner).
 *
 * Polymorphic scope_id: depending on scope, points at campaigns,
 * outreach_brands, crawl_brands, city_campaigns, or staff_members.
 * App layer validates the FK shape per scope value.
 *
 * Metrics are numeric: revenue in cents, counts in plain integers.
 * target_value is BIGINT to fit revenue cents.
 *
 * Time window: period_start / period_end. For weekly staff goals, that's a
 * 7-day window. For campaign goals, the campaign's date range.
 */

import { bigint, date, index, pgTable, uuid } from "drizzle-orm/pg-core";
import { auditColumns, idColumn, versionColumn } from "../types";
import { goalMetric, goalScope } from "./enums";
import { staffMembers } from "./users";

export const goals = pgTable(
  "goals",
  {
    ...idColumn,

    scope: goalScope("scope").notNull(),
    // Polymorphic; enforced in app layer.
    scopeId: uuid("scope_id").notNull(),

    metric: goalMetric("metric").notNull(),
    targetValue: bigint("target_value", { mode: "bigint" }).notNull(),

    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),

    setByStaffId: uuid("set_by_staff_id")
      .notNull()
      .references(() => staffMembers.id, { onDelete: "restrict" }),

    ...auditColumns,
    ...versionColumn,
  },
  (table) => ({
    scopeIdIdx: index("goals_scope_id_idx").on(table.scope, table.scopeId),
    periodIdx: index("goals_period_idx").on(table.periodStart, table.periodEnd),
    metricIdx: index("goals_metric_idx").on(table.metric),
  }),
);

export type Goal = typeof goals.$inferSelect;
export type NewGoal = typeof goals.$inferInsert;
