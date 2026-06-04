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
  boolean,
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
import { staffMembers, staffOutreachEmails } from "./users";

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
     * Normalized address columns (migration 0083). The raw
     * fromAddress / toAddresses / ccAddresses / bccAddresses
     * preserve exactly what Gmail's header stored ("Mike Smith
     * <info@venue.com>"); these columns hold the lowercased,
     * display-name-stripped form ("info@venue.com") for matching,
     * duplicate detection, and venue-communication timeline
     * queries.
     *
     * Populated:
     *   - on Gmail ingest (lib/gmail-poll-worker.ts) via
     *     parseEmailHeader / parseEmailList
     *   - on outbound send (lib/compose-send-impl.ts and
     *     app/(admin)/inbox/_actions.ts) from the already-clean
     *     toList / ccList / bccList in compose scope
     *   - by the 0083 backfill for every historical row
     *
     * Always compare on the normalized columns — never the raw
     * fromAddress / toAddresses / ccAddresses / bccAddresses.
     * Comparing the raw columns silently misses any sender with
     * a display name.
     */
    fromEmailNormalized: text("from_email_normalized"),
    toEmailsNormalized: text("to_emails_normalized").array().notNull().default([]),
    ccEmailsNormalized: text("cc_emails_normalized").array().notNull().default([]),
    bccEmailsNormalized: text("bcc_emails_normalized").array().notNull().default([]),

    /**
     * Raw subject from this specific message. The Re:/Fwd:-stripped
     * canonical version is on email_threads.subject.
     */
    subject: text("subject").notNull(),

    bodyText: text("body_text"),
    bodyHtml: text("body_html"),
    snippet: text("snippet"),

    /**
     * Full-text search vector (Phase B). Generated column —
     * Postgres re-computes on insert/update from:
     *   subject (weight A) || body_text (weight B) || from_address (weight C)
     *
     * Drizzle doesn't model GENERATED ALWAYS AS (...) STORED
     * cleanly, so we declare it as a regular tsvector + ignore
     * writes. Migration 0069 creates the actual generated
     * column; this declaration is just so we can reference it
     * in `where` clauses.
     */
    searchTsv: text("search_tsv"),

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

    /** Written-confirmation flag (migration 0107). An operator marks the
     *  inbound email where a venue agreed to a slot, so the venue detail card
     *  can surface the proof for dispute defense. flaggedBy/At record which
     *  operator filed it + when. */
    isConfirmation: boolean("is_confirmation").notNull().default(false),
    confirmationFlaggedBy: uuid("confirmation_flagged_by").references(() => staffMembers.id, {
      onDelete: "set null",
    }),
    confirmationFlaggedAt: timestamp("confirmation_flagged_at", { withTimezone: true }),
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
    /**
     * Normalized From index for venue-communication matching +
     * duplicate-outreach detection. Both query paths boil down to
     * "find every message where from_email_normalized = ANY(...)";
     * a btree on that column is the right shape.
     *
     * The corresponding GIN indexes on to_emails_normalized and
     * cc_emails_normalized (for `... && ARRAY[...]` lookups) are
     * declared only in migration 0083 — Drizzle's index() helper
     * doesn't model the `USING GIN` syntax and we don't need to
     * round-trip them.
     */
    fromEmailNormalizedIdx: index("email_messages_from_email_normalized_idx").on(
      table.fromEmailNormalized,
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
