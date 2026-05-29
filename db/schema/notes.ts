/**
 * Notes — meeting notes and action items attached to city_campaigns,
 * venues, or campaigns. Supports @mention of staff.
 *
 * Polymorphic target like tasks, enforced in app layer.
 */

import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { auditColumns, idColumn } from "../types";
import { noteTargetType } from "./enums";
import { staffMembers } from "./users";

export const notes = pgTable(
  "notes",
  {
    ...idColumn,

    targetType: noteTargetType("target_type").notNull(),
    targetId: uuid("target_id").notNull(),

    authorStaffId: uuid("author_staff_id")
      .notNull()
      .references(() => staffMembers.id, { onDelete: "restrict" }),

    body: text("body").notNull(),

    // Staff IDs @-mentioned in the note. Drives notifications.
    mentions: uuid("mentions").array().notNull().default([]),

    ...auditColumns,
    // No version — notes are short-lived and rarely concurrent-edited.
  },
  (table) => ({
    targetIdx: index("notes_target_idx").on(table.targetType, table.targetId),
    authorIdx: index("notes_author_idx").on(table.authorStaffId),
    createdAtIdx: index("notes_created_at_idx").on(table.createdAt),
  }),
);

export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;
