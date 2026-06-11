import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { campaigns } from "./campaigns";
import { venues } from "./venues";

/**
 * The learning loop (migration 0134, operator request 2026-06-11):
 * example stores mined nightly from real email history so the
 * classifier and reply suggestions learn from how Kevin / Dan / JC /
 * Yesu actually corresponded with venues.
 *
 * NOTE: thread/message FKs are declared in SQL but typed loosely here
 * (plain uuid columns) to avoid a circular import with outreach.ts /
 * email-messages.ts. Joins go through raw ids.
 *
 * search_tsv columns are DB-generated (GENERATED ALWAYS AS) and are
 * intentionally NOT modeled — retrieval queries them via sql``.
 */

export const replyExamples = pgTable(
  "reply_examples",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    threadId: uuid("thread_id"),
    inboundMessageId: uuid("inbound_message_id"),
    replyMessageId: uuid("reply_message_id"),
    inboundText: text("inbound_text").notNull(),
    replyText: text("reply_text").notNull(),
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    classification: text("classification"),
    templateCode: text("template_code"),
    senderInbox: text("sender_inbox"),
    venueId: uuid("venue_id").references(() => venues.id, { onDelete: "set null" }),
    cityName: text("city_name"),
    cityPriority: smallint("city_priority"),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    /** 'pending' | 'confirmed' | 'declined' | 'ghosted' — stamped by the
     *  nightly labeler once the venue's post-reply trajectory is clear. */
    outcome: text("outcome").notNull().default("pending"),
    outcomeAt: timestamp("outcome_at", { withTimezone: true }),
    acceptedCount: integer("accepted_count").notNull().default(0),
    editedCount: integer("edited_count").notNull().default(0),
    rewrittenCount: integer("rewritten_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    inboundUnique: uniqueIndex("reply_examples_inbound_message_id_key").on(table.inboundMessageId),
    outcomeIdx: index("reply_examples_outcome_idx").on(table.outcome),
    inboxIdx: index("reply_examples_inbox_idx").on(table.senderInbox),
  }),
);

export const classificationExamples = pgTable(
  "classification_examples",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    messageId: uuid("message_id"),
    threadId: uuid("thread_id"),
    text: text("text").notNull(),
    finalLabel: text("final_label").notNull(),
    wasOverride: boolean("was_override").notNull().default(false),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    messageUnique: uniqueIndex("classification_examples_message_id_key").on(table.messageId),
    labelIdx: index("classification_examples_label_idx").on(table.finalLabel),
  }),
);

/** Shape stored in email_drafts.suggestion_meta when a draft is seeded
 *  from an AI suggestion (quick-reply chip). */
export interface SuggestionMeta {
  /** reply_examples ids that grounded the suggestion (may be empty). */
  exampleIds: string[];
  /** The exact text the draft was seeded with, for the sent-as-is /
   *  edited / rewritten comparison at send time. */
  seededBody: string;
  source: "quick_reply_chip";
}
