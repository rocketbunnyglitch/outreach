/**
 * gmail_labels — per-connected-account mirror of Gmail's labels.
 * See migration 0059.
 *
 * Synced from Gmail's labels.list endpoint via the existing poll
 * worker (lib/gmail-poll-worker.ts) on a sub-cadence — each
 * connected account refreshes its labels every N message polls.
 *
 * Storage is per-account (not per-team) since Gmail labels are a
 * user-level construct. The left rail collapses identically-named
 * labels across accounts at render time.
 */

import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { connectedAccounts } from "./users";

export const gmailLabels = pgTable(
  "gmail_labels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectedAccountId: uuid("connected_account_id")
      .notNull()
      .references(() => connectedAccounts.id, { onDelete: "cascade" }),
    /** Gmail's id — stable across renames so we can update in place. */
    gmailLabelId: text("gmail_label_id").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(), // 'user' | 'system'
    /** Parent's gmail_label_id when Gmail nests labels via "Parent/Child". */
    parentLabelId: text("parent_label_id"),
    /** Optional colors from Gmail's color config. */
    backgroundColor: text("background_color"),
    textColor: text("text_color"),
    /** Counts cached at sync time; stale between polls. */
    unreadCount: integer("unread_count").notNull().default(0),
    totalCount: integer("total_count").notNull().default(0),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    accountLabelIdx: uniqueIndex("gmail_labels_account_label_idx").on(
      t.connectedAccountId,
      t.gmailLabelId,
    ),
    accountIdx: index("gmail_labels_account_idx").on(t.connectedAccountId),
  }),
);

export type GmailLabel = typeof gmailLabels.$inferSelect;
export type NewGmailLabel = typeof gmailLabels.$inferInsert;
