/**
 * email_drafts — backing table for the global Gmail-style composer.
 * See migration 0055.
 *
 * Lifecycle:
 *   - Created when the operator opens a new composer (first autosave)
 *   - Updated on every autosave tick + manual Save-as-draft click
 *   - Either sent (sent_at + sent_thread_id populated) or discarded
 *     (row deleted)
 */

import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { teams } from "./teams";
import { connectedAccounts, users } from "./users";

export const emailDrafts = pgTable(
  "email_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    connectedAccountId: uuid("connected_account_id").references(() => connectedAccounts.id, {
      onDelete: "set null",
    }),
    toAddresses: text("to_addresses").array().notNull().default([]),
    ccAddresses: text("cc_addresses").array().notNull().default([]),
    bccAddresses: text("bcc_addresses").array().notNull().default([]),
    subject: text("subject").notNull().default(""),
    bodyText: text("body_text").notNull().default(""),
    bodyHtml: text("body_html"),
    venueId: uuid("venue_id"),
    cityCampaignId: uuid("city_campaign_id"),
    templateId: uuid("template_id"),
    attachments: jsonb("attachments").notNull().default([]),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    sentThreadId: uuid("sent_thread_id"),
    /** Compose mode: "new" | "reply" | "reply_all" | "forward". Drives
     *  the Gmail-shaped UI affordances + the threading behavior on
     *  send. NULL implies "new" for backward compatibility with
     *  drafts created before migration 0058. */
    mode: text("mode"),
    /** Thread the operator is replying to/forwarding from. When set,
     *  the compose pipeline reuses that thread's gmail_thread_id +
     *  adds In-Reply-To/References headers so Gmail threads the
     *  outbound message correctly. NULL for "new" drafts. */
    replyToThreadId: uuid("reply_to_thread_id"),
    /** Specific message within the reply thread to anchor the reply
     *  against. NULL falls back to the latest message. Used for the
     *  message-level "Reply to this" action. */
    replyToMessageId: uuid("reply_to_message_id"),
    /** team_labels.id[] queued during compose to be applied to the
     *  resulting thread after send. Only used for NEW (non-reply)
     *  compose where there's no thread yet to apply to immediately.
     *  Replies apply labels directly to their existing thread via
     *  applyLabelToThreadAction at toggle time. See migration 0064. */
    pendingLabelIds: uuid("pending_label_ids").array().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ownerIdx: index("email_drafts_owner_open_idx").on(t.ownerUserId, t.updatedAt),
    scheduledIdx: index("email_drafts_scheduled_idx").on(t.scheduledFor),
    venueIdx: index("email_drafts_venue_idx").on(t.venueId),
  }),
);

export type EmailDraft = typeof emailDrafts.$inferSelect;
export type NewEmailDraft = typeof emailDrafts.$inferInsert;

/** Attachment metadata stored in the JSONB column.
 *  storage_key is the future S3/GCS path — absent until file storage
 *  is wired. */
export interface EmailDraftAttachment {
  name: string;
  size: number;
  mime: string;
  storage_key?: string;
}
