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
import { staffMembers } from "./users";

export const notificationKind = pgEnum("notification_kind", [
  "reply",
  "mention",
  "email_invalid",
  "ai_draft_failed",
  "edit_conflict",
  "admin_message",
  // Migration 0028 — fires when an outreach staffer escalates a
  // cold-outreach entry to a senior staffer (typically Brandon).
  // The notifications bell + dropdown surfaces this so the escalation
  // owner sees it immediately even if email is delayed/blocked.
  "escalation",
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

    // Acknowledgment + escalation (Phase 4.6). acknowledged_* is the stronger
    // "I've got this" for cancellation alerts; escalate_after/escalated_at drive
    // the escalation cron.
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedBy: uuid("acknowledged_by").references(() => staffMembers.id, {
      onDelete: "set null",
    }),
    escalateAfter: timestamp("escalate_after", { withTimezone: true }),
    escalatedAt: timestamp("escalated_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    staffUnreadIdx: index("notifications_staff_unread_idx").on(table.staffId, table.createdAt),
    staffRecentIdx: index("notifications_staff_recent_idx").on(table.staffId, table.createdAt),
  }),
);

export type Notification = typeof notifications.$inferSelect;
export type NotificationInsert = typeof notifications.$inferInsert;
