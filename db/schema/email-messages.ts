/**
 * Email messages — one row per individual email in a thread.
 *
 * Why a new table?
 *   email_threads tracks thread-level metadata (state, owner, SLA).
 *   reply_inbox tracks the per-reply triage queue (category, SLA breach).
 *   Neither stores the actual message bodies — for the new Gmail-style
 *   inbox right-pane we need the full conversation.
 *
 * Populated by:
 *   • the 5-minute Gmail polling worker (inbound + outbound from sent items)
 *   • the in-app send-composer (immediately after Gmail send succeeds)
 *
 * See 0020_inbox.sql for the schema definition.
 */

import {
  bigint,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { messageKind, threadDirection } from "./enums";
import { emailThreads } from "./outreach";
import { staffMembers, staffOutreachEmails } from "./staff";

// =========================================================================
// email_messages
// =========================================================================

export const emailMessages = pgTable(
  "email_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    threadId: uuid("thread_id")
      .notNull()
      .references(() => emailThreads.id, { onDelete: "cascade" }),

    /**
     * Gmail's per-message ID. Required for dedup — the polling worker
     * may see the same message twice if histories overlap.
     */
    gmailMessageId: text("gmail_message_id").notNull(),

    /** RFC 5322 Message-ID header. Used for downstream threading. */
    rfcMessageId: text("rfc_message_id"),

    /** RFC 5322 In-Reply-To header. */
    inReplyTo: text("in_reply_to"),

    kind: messageKind("kind").notNull().default("email"),

    /**
     * 'inbound' or 'outbound' only. 'mixed' is meaningless on a single message
     * and is reserved for thread-level direction.
     */
    direction: threadDirection("direction").notNull(),

    fromAddress: text("from_address").notNull(),
    fromName: text("from_name"),
    toAddresses: text("to_addresses").array().notNull().default([]),
    ccAddresses: text("cc_addresses").array().notNull().default([]),
    bccAddresses: text("bcc_addresses").array().notNull().default([]),

    /**
     * Raw subject from this specific message. The Re:/Fwd:-stripped
     * canonical version is on email_threads.subject.
     */
    subject: text("subject").notNull(),

    bodyText: text("body_text"),
    bodyHtml: text("body_html"),
    snippet: text("snippet"),

    gmailLabels: text("gmail_labels").array().notNull().default([]),
    rawPayload: jsonb("raw_payload"),

    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),

    sentByStaffId: uuid("sent_by_staff_id").references(() => staffMembers.id, {
      onDelete: "set null",
    }),
    staffOutreachEmailId: uuid("staff_outreach_email_id").references(() => staffOutreachEmails.id, {
      onDelete: "set null",
    }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (table) => ({
    /**
     * Gmail message IDs are unique per Gmail account, not globally. Scope
     * by inbox so the same message landing in two staff inboxes (CC'd to
     * both) isn't deduped away.
     */
    gmailDedupe: uniqueIndex("email_messages_gmail_msg_inbox_unique").on(
      table.gmailMessageId,
      table.staffOutreachEmailId,
    ),
    threadSentAtIdx: index("email_messages_thread_sent_at_idx").on(table.threadId, table.sentAt),
    rfcIdIdx: index("email_messages_rfc_id_idx").on(table.rfcMessageId),
    inReplyToIdx: index("email_messages_in_reply_to_idx").on(table.inReplyTo),
    threadDirectionIdx: index("email_messages_thread_direction_idx").on(
      table.threadId,
      table.direction,
    ),
  }),
);

// =========================================================================
// email_attachments — metadata only; file bytes live in Gmail (v1) or B2
// =========================================================================

export const emailAttachments = pgTable(
  "email_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    messageId: uuid("message_id")
      .notNull()
      .references(() => emailMessages.id, { onDelete: "cascade" }),

    filename: text("filename").notNull(),
    contentType: text("content_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),

    /** Gmail attachment ID — fetched on demand when user clicks download. */
    gmailAttachmentId: text("gmail_attachment_id"),

    /** B2 URL if mirrored. Null until backfill worker runs. */
    storageUrl: text("storage_url"),

    /** For inline images (cid:...) embedded in body_html. */
    inlineContentId: text("inline_content_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    messageIdx: index("email_attachments_message_idx").on(table.messageId),
  }),
);

// =========================================================================
// Inferred types
// =========================================================================

export type EmailMessage = typeof emailMessages.$inferSelect;
export type NewEmailMessage = typeof emailMessages.$inferInsert;
export type EmailAttachment = typeof emailAttachments.$inferSelect;
export type NewEmailAttachment = typeof emailAttachments.$inferInsert;
