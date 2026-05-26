/**
 * notifications — per-staff inbox of items needing attention.
 *
 * Populated by various app events (inbound replies, ZeroBounce
 * 'invalid' results, conflicts on edits, etc.). Surfaced via a bell
 * icon in the top nav with an unread count + dropdown list of recent
 * items.
 *
 * Spec §11.x notifications (Sheets-parity gap #10).
 */

import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { staffMembers } from "./staff";

export const notificationKind = pgEnum("notification_kind", [
  "reply",
  "mention",
  "email_invalid",
  "ai_draft_failed",
  "edit_conflict",
  "admin_message",
]);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staffMembers.id, { onDelete: "cascade" }),

    kind: notificationKind("kind").notNull(),

    title: text("title").notNull(),
    body: text("body"),
    linkPath: text("link_path"),

    metadata: jsonb("metadata").notNull().default({}),

    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    staffUnreadIdx: index("notifications_staff_unread_idx").on(table.staffId, table.createdAt),
    staffRecentIdx: index("notifications_staff_recent_idx").on(table.staffId, table.createdAt),
  }),
);

export type Notification = typeof notifications.$inferSelect;
export type NotificationInsert = typeof notifications.$inferInsert;
