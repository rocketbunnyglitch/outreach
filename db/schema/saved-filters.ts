/**
 * saved_filters — per-staff saved query/filter combinations for the global
 * search and list views (Spec §6.3).
 *
 * filter_json is a structured filter spec (key/value pairs over typed
 * predicates). Schema is enforced in the app layer, not the DB, since
 * filter shapes evolve with the UI.
 *
 * is_shared = true means admins can publish a filter team-wide.
 */

import { boolean, index, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { auditColumns, idColumn, versionColumn } from "../types";
import { staffMembers } from "./users";

export const savedFilters = pgTable(
  "saved_filters",
  {
    ...idColumn,

    staffMemberId: uuid("staff_member_id")
      .notNull()
      .references(() => staffMembers.id, { onDelete: "cascade" }),

    name: text("name").notNull(),

    // Which list this filter applies to: "cities" | "venues" | "venue_events"
    // | "campaigns" | "reply_inbox" | etc. Free-text intentionally; the UI
    // dispatches based on this string.
    targetView: text("target_view").notNull(),

    filterJson: jsonb("filter_json").notNull().default({}),

    isShared: boolean("is_shared").notNull().default(false),

    ...auditColumns,
    ...versionColumn,
  },
  (table) => ({
    staffNameUnique: uniqueIndex("saved_filters_staff_name_unique").on(
      table.staffMemberId,
      table.name,
    ),
    targetViewIdx: index("saved_filters_target_view_idx").on(table.targetView),
    sharedIdx: index("saved_filters_shared_idx").on(table.isShared),
  }),
);

export type SavedFilter = typeof savedFilters.$inferSelect;
export type NewSavedFilter = typeof savedFilters.$inferInsert;
