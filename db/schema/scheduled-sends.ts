/**
 * Scheduled sends — Phase 2 controlled-send queue.
 *
 * Operator selects N venues + a template + a window, engine spaces them
 * across the day respecting inbox caps. Worker (lib/send-worker.ts)
 * polls every minute, claims due rows via SKIP LOCKED, renders the
 * template fresh, calls Gmail.
 */

import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { outreachBrands } from "./brands";
import { outreachLog } from "./outreach";
import { staffMembers, staffOutreachEmails } from "./staff";
import { emailTemplates } from "./templates";
import { venueEvents } from "./venue-events";
import { venues } from "./venues";

export const scheduledSends = pgTable(
  "scheduled_sends",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    staffMemberId: uuid("staff_member_id")
      .notNull()
      .references(() => staffMembers.id, { onDelete: "restrict" }),
    staffOutreachEmailId: uuid("staff_outreach_email_id")
      .notNull()
      .references(() => staffOutreachEmails.id, { onDelete: "restrict" }),
    outreachBrandId: uuid("outreach_brand_id")
      .notNull()
      .references(() => outreachBrands.id, { onDelete: "restrict" }),

    venueId: uuid("venue_id")
      .notNull()
      .references(() => venues.id, { onDelete: "cascade" }),
    venueEventId: uuid("venue_event_id").references(() => venueEvents.id, {
      onDelete: "set null",
    }),
    recipientEmail: text("recipient_email").notNull(),

    emailTemplateId: uuid("email_template_id")
      .notNull()
      .references(() => emailTemplates.id, { onDelete: "restrict" }),

    subjectOverride: text("subject_override"),
    bodyTextOverride: text("body_text_override"),

    /** 'pending' | 'sending' | 'sent' | 'failed' | 'canceled' */
    status: text("status").notNull().default("pending"),

    /**
     * 'cold' | 'follow_up' | 'transactional'. Transactional bypasses
     * the cold throttle since it's going to a confirmed relationship.
     */
    sendKind: text("send_kind").notNull().default("cold"),

    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }),
    windowEnd: timestamp("window_end", { withTimezone: true }),

    sentAt: timestamp("sent_at", { withTimezone: true }),
    outreachLogId: uuid("outreach_log_id").references(() => outreachLog.id, {
      onDelete: "set null",
    }),
    failureReason: text("failure_reason"),
    failureCount: integer("failure_count").notNull().default(0),

    batchId: uuid("batch_id"),
    batchLabel: text("batch_label"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
  },
  (table) => ({
    dueIdx: index("scheduled_sends_due_idx").on(table.scheduledFor),
    inboxIdx: index("scheduled_sends_inbox_idx").on(table.staffOutreachEmailId, table.scheduledFor),
    batchIdx: index("scheduled_sends_batch_idx").on(table.batchId),
  }),
);

export type ScheduledSend = typeof scheduledSends.$inferSelect;
export type NewScheduledSend = typeof scheduledSends.$inferInsert;
