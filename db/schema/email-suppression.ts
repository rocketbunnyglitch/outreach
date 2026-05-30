/**
 * Email suppression — per-team list of addresses we should never
 * send to. See migration 0050.
 */

import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { emailThreads } from "./outreach";
import { teams } from "./teams";
import { users } from "./users";

export const emailSuppression = pgTable(
  "email_suppression",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    /** Lowercased + trimmed before insert. */
    email: text("email").notNull(),
    /** 'manual' | 'bounced' | 'complained' | 'unsubscribe'. */
    reason: text("reason").notNull(),
    notes: text("notes"),
    sourceThreadId: uuid("source_thread_id").references(() => emailThreads.id, {
      onDelete: "set null",
    }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    teamEmailUnique: uniqueIndex("email_suppression_team_email_unique").on(t.teamId, t.email),
    teamIdx: index("email_suppression_team_idx").on(t.teamId),
  }),
);

export type EmailSuppression = typeof emailSuppression.$inferSelect;
export type NewEmailSuppression = typeof emailSuppression.$inferInsert;
export type SuppressionReason = "manual" | "bounced" | "complained" | "unsubscribe";
