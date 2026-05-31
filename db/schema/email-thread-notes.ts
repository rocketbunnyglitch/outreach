/**
 * Internal thread notes + mentions — Phase D of the email-system
 * audit. Per-thread notes the team writes to coordinate
 * ("I called this owner already, mention pricing again"); @-tags
 * notify other operators and surface in their inbox scope.
 *
 * Tables:
 *   email_thread_notes      free-form notes attached to a thread
 *   email_thread_mentions   one row per @-tagged user per note,
 *                            for the "mentioned" inbox scope.
 *
 * Migration 0072.
 */

import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { emailThreads } from "./outreach";
import { staffMembers } from "./users";

export const emailThreadNotes = pgTable(
  "email_thread_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => emailThreads.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => staffMembers.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    threadIdx: index("email_thread_notes_thread_idx").on(t.threadId, t.createdAt),
    authorIdx: index("email_thread_notes_author_idx").on(t.authorId, t.createdAt),
  }),
);

export const emailThreadMentions = pgTable(
  "email_thread_mentions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => emailThreads.id, { onDelete: "cascade" }),
    noteId: uuid("note_id")
      .notNull()
      .references(() => emailThreadNotes.id, { onDelete: "cascade" }),
    mentionedUserId: uuid("mentioned_user_id")
      .notNull()
      .references(() => staffMembers.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => staffMembers.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** NULL = unread. Set when operator dismisses or replies. */
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  },
  (t) => ({
    userUnackIdx: index("email_thread_mentions_user_unack_idx").on(t.mentionedUserId, t.createdAt),
    threadIdx: index("email_thread_mentions_thread_idx").on(t.threadId),
  }),
);

export type EmailThreadNote = typeof emailThreadNotes.$inferSelect;
export type EmailThreadMention = typeof emailThreadMentions.$inferSelect;
