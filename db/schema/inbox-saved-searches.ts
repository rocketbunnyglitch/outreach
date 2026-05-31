/**
 * Saved searches — per-user pinned inbox queries.
 *
 * Phase B.2 of the email-system audit plan. Operators repeatedly
 * run the same searches; rather than retype "Toronto + warm +
 * last 7d" every time, they can save it once and one-click run
 * it from a sidebar dropdown.
 *
 * Storage:
 *   query_text is the raw search string. Goes through
 *   parseSearchQuery on every load (so saved searches benefit
 *   from any future operator-syntax improvements). Not
 *   pre-parsed.
 *
 * Migration 0070.
 */

import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { staffMembers } from "./users";

export const inboxSavedSearches = pgTable(
  "inbox_saved_searches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => staffMembers.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    queryText: text("query_text").notNull(),
    sortOrder: integer("sort_order"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userLabelUnique: uniqueIndex("inbox_saved_searches_user_label_unique").on(
      table.userId,
      // Note: the migration uses lower(label) for case-insensitive
      // uniqueness. Drizzle's uniqueIndex doesn't expose that;
      // the DB-side constraint is the source of truth. This
      // index spec is a best-approximation for tooling.
      table.label,
    ),
    userSortIdx: index("inbox_saved_searches_user_sort_idx").on(
      table.userId,
      table.sortOrder,
      table.label,
    ),
  }),
);

export type InboxSavedSearch = typeof inboxSavedSearches.$inferSelect;
export type NewInboxSavedSearch = typeof inboxSavedSearches.$inferInsert;
