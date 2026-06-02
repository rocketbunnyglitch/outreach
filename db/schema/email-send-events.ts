/**
 * Per-send audit + counter source for the daily cold-send cap.
 * See migration 0049 for the table layout.
 */

import { boolean, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { emailThreads } from "./outreach";
import { teams } from "./teams";
import { emailTemplates } from "./templates";
import { staffOutreachEmails, users } from "./users";

export const emailSendEvents = pgTable(
  "email_send_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectedAccountId: uuid("connected_account_id")
      .notNull()
      .references(() => staffOutreachEmails.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id").references(() => emailThreads.id, { onDelete: "set null" }),
    sentByUserId: uuid("sent_by_user_id").references(() => users.id, { onDelete: "set null" }),
    recipientEmail: text("recipient_email").notNull(),
    /** 'cold' counts against the cap; 'warm' does not. v1 stores
     *  these two values; a later migration may expand to the full
     *  spec set (follow_up / operational / internal). */
    category: text("category").notNull(),
    /** Operational send-type taxonomy (migration 0088). Distinct from
     *  `category` (cold/warm cap classification): send_type records the
     *  operational intent of the mail -- 'cold' | 'warm' | 'operational'
     *  -- so operational mail (e.g. transactional/internal) can be
     *  excluded from the 30/day cold budget while still being audited.
     *  Defaults to 'cold' for backward compatibility; existing rows are
     *  backfilled from `category`. countedAgainstCap remains the
     *  authoritative cap flag. */
    sendType: text("send_type").notNull().default("cold"),
    countedAgainstCap: boolean("counted_against_cap").notNull(),
    /** True when an admin pushed the send through despite the cap. */
    capBypassed: boolean("cap_bypassed").notNull().default(false),
    /** Template used for this send (Phase C.1). NULL = freeform
     *  compose with no template. */
    templateId: uuid("template_id").references(() => emailTemplates.id, {
      onDelete: "set null",
    }),
    /** Owning team — denormalized from the connected account so
     *  analytics queries can scope directly without a join.
     *  Migration 0071. */
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    accountIdx: index("email_send_events_account_sent_at_idx").on(t.connectedAccountId, t.sentAt),
    userIdx: index("email_send_events_user_sent_at_idx").on(t.sentByUserId, t.sentAt),
    threadIdx: index("email_send_events_thread_idx").on(t.threadId),
    templateIdx: index("email_send_events_template_idx").on(t.templateId, t.sentAt),
    teamIdx: index("email_send_events_team_idx").on(t.teamId, t.sentAt),
  }),
);

export type EmailSendEvent = typeof emailSendEvents.$inferSelect;
export type NewEmailSendEvent = typeof emailSendEvents.$inferInsert;

export type SendCategory = "cold" | "warm";

/** Operational send-type taxonomy (migration 0088). 'cold' and 'warm'
 *  mirror the cap classification; 'operational' marks mail that must
 *  NOT consume the daily cold budget (countedAgainstCap=false). */
export type SendType = "cold" | "warm" | "operational";
