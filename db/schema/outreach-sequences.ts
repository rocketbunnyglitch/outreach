/**
 * Phase 3 — Follow-up cadence + sequence state.
 *
 * outreachCadenceSteps: per-brand sequence definition.
 * outreachSequenceState: per-(venue, brand) tracking of which step
 *   was last sent and when the next is due. Stops on reply/bounce/etc.
 */

import { index, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { outreachBrands } from "./brands";
import { staffMembers, staffOutreachEmails } from "./staff";
import { emailTemplates } from "./templates";
import { venues } from "./venues";

export const outreachCadenceSteps = pgTable(
  "outreach_cadence_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    outreachBrandId: uuid("outreach_brand_id")
      .notNull()
      .references(() => outreachBrands.id, { onDelete: "cascade" }),

    /** 1-indexed; 1 = cold first-touch, 2+ = auto follow-ups. */
    stepNumber: smallint("step_number").notNull(),

    emailTemplateId: uuid("email_template_id")
      .notNull()
      .references(() => emailTemplates.id, { onDelete: "restrict" }),

    /** Days to wait after the previous step's send time. */
    delayDays: smallint("delay_days").notNull(),

    /** Optional hour-of-day override (e.g. always 10am local). */
    sendHour: smallint("send_hour"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
  },
  (table) => ({
    brandStepUnique: uniqueIndex("outreach_cadence_steps_brand_step_unique").on(
      table.outreachBrandId,
      table.stepNumber,
    ),
  }),
);

export type OutreachCadenceStep = typeof outreachCadenceSteps.$inferSelect;
export type NewOutreachCadenceStep = typeof outreachCadenceSteps.$inferInsert;

export const outreachSequenceState = pgTable(
  "outreach_sequence_state",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    venueId: uuid("venue_id")
      .notNull()
      .references(() => venues.id, { onDelete: "cascade" }),
    outreachBrandId: uuid("outreach_brand_id")
      .notNull()
      .references(() => outreachBrands.id, { onDelete: "cascade" }),
    staffMemberId: uuid("staff_member_id")
      .notNull()
      .references(() => staffMembers.id, { onDelete: "restrict" }),
    staffOutreachEmailId: uuid("staff_outreach_email_id")
      .notNull()
      .references(() => staffOutreachEmails.id, { onDelete: "restrict" }),
    recipientEmail: text("recipient_email").notNull(),

    /** 1 = cold sent. Bumped as follow-ups go out. */
    lastStepSent: smallint("last_step_sent").notNull().default(1),
    lastStepSentAt: timestamp("last_step_sent_at", { withTimezone: true }).notNull().defaultNow(),

    /** Next step number for the worker. NULL = sequence complete. */
    nextStepNumber: smallint("next_step_number"),
    nextStepDueAt: timestamp("next_step_due_at", { withTimezone: true }),

    unsubscribeToken: text("unsubscribe_token").notNull(),

    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
    /** 'replied' | 'bounced' | 'unsubscribed' | 'declined' | 'manual' | 'completed' */
    stoppedReason: text("stopped_reason"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
  },
  (table) => ({
    dueIdx: index("outreach_sequence_state_due_idx").on(table.nextStepDueAt),
    tokenUnique: uniqueIndex("outreach_sequence_state_token_unique").on(table.unsubscribeToken),
    venueIdx: index("outreach_sequence_state_venue_idx").on(table.venueId),
  }),
);

export type OutreachSequenceState = typeof outreachSequenceState.$inferSelect;
export type NewOutreachSequenceState = typeof outreachSequenceState.$inferInsert;
