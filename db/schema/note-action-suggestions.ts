/**
 * Note Action Suggestions — Smart Notes outputs.
 *
 * When a staffer writes a note, lib/smart-notes scans for actionable
 * language + date references and writes rows here with status='pending'.
 * The operator clicks Create / Edit / Dismiss to triage. Accepted
 * suggestions get a task_id pointing to the newly-created tasks row.
 *
 * Dismissed suggestions remain in the table so dismissed-then-edited
 * notes don't re-suggest the same thing. New scans key on a content
 * hash; old hash dismissals stay dismissed, new hash gets fresh
 * suggestions.
 */

import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { auditColumns, idColumn } from "../types";
import { notes } from "./notes";
import { tasks } from "./tasks";
import { venues } from "./venues";

export const noteActionSuggestions = pgTable(
  "note_action_suggestions",
  {
    ...idColumn,

    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),

    /** SHA-256 of note body at extraction time. */
    noteContentHash: text("note_content_hash").notNull(),

    /** 'pending' | 'accepted' | 'dismissed' — see migration check constraint */
    status: text("status").notNull().default("pending"),

    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    /**
     * 'call' | 'follow_up_email' | 'venue_callback' |
     * 'confirmation_reminder' | 'poster_send' | 'wristband_task' |
     * 'missing_info_task' | 'reminder' | 'custom'
     */
    actionType: text("action_type").notNull(),

    dueAt: timestamp("due_at", { withTimezone: true }),
    timezone: text("timezone").notNull(),

    venueId: uuid("venue_id").references(() => venues.id, {
      onDelete: "set null",
    }),
    phoneE164: text("phone_e164"),

    /** 'high' | 'medium' — see migration check constraint */
    confidence: text("confidence").notNull().default("medium"),

    /** Exact phrase from note body that triggered extraction. */
    sourceText: text("source_text").notNull(),

    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),

    ...auditColumns,
  },
  (table) => ({
    noteIdx: index("note_action_suggestions_note_idx").on(table.noteId),
    statusIdx: index("note_action_suggestions_status_idx").on(table.status),
    venueIdx: index("note_action_suggestions_venue_idx").on(table.venueId),
    dueIdx: index("note_action_suggestions_due_idx").on(table.dueAt),
  }),
);

export type NoteActionSuggestion = typeof noteActionSuggestions.$inferSelect;
export type NewNoteActionSuggestion = typeof noteActionSuggestions.$inferInsert;
