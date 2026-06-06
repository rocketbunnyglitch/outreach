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

import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
    /** Template the engine auto-picked when this composer opened (Phase
     *  1.5). Distinct from template_id (the template currently loaded,
     *  which the operator may have swapped). Comparing the two yields the
     *  "operator overrode the engine" signal for misclassification review.
     *  ON DELETE SET NULL so a removed template never blocks a draft. See
     *  migration 0093. */
    enginePickedTemplateId: uuid("engine_picked_template_id"),
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
    /** Quoted original message for replies/forwards. Stored separate
     *  from bodyHtml so the composer can render it as a collapsible
     *  "..." block below the editable surface (Gmail parity). On
     *  send, compose-send-impl concatenates bodyHtml + quotedHtml so
     *  the recipient sees the full thread regardless of whether the
     *  operator expanded it. See migration 0065. */
    quotedHtml: text("quoted_html"),
    // --- Send-safety boundary (P0-1). "Engine drafts. Humans send." ---
    // The scheduled-send cron may ONLY dispatch a draft that is either
    // operator_scheduled with approved_at set, OR auto_allowed for a non-venue
    // recipient. Engine-generated drafts default to review_required and never
    // auto-send. See migration 0119 + lib/scheduled-send-runner.ts.
    /** review_required | operator_scheduled | auto_allowed */
    sendMode: text("send_mode")
      .$type<"review_required" | "operator_scheduled" | "auto_allowed">()
      .notNull()
      .default("review_required"),
    requiresHumanApproval: boolean("requires_human_approval").notNull().default(true),
    approvedByStaffId: uuid("approved_by_staff_id").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    scheduledByStaffId: uuid("scheduled_by_staff_id").references(() => users.id, {
      onDelete: "set null",
    }),
    autoSendAllowed: boolean("auto_send_allowed").notNull().default(false),
    /** venue | host | internal | system. Only non-venue may ever be auto_allowed. */
    recipientType: text("recipient_type")
      .$type<"venue" | "host" | "internal" | "system">()
      .notNull()
      .default("venue"),
    /** Template/touch code (e.g. T1, T9, T14) or category, for safety + analytics. */
    touchType: text("touch_type"),
    /** The specific venue_event/night this draft belongs to. Lets cancellation
     *  scope cleanup to ONE night of a multi-night venue. FK in migration 0119. */
    venueEventId: uuid("venue_event_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ownerIdx: index("email_drafts_owner_open_idx").on(t.ownerUserId, t.updatedAt),
    scheduledIdx: index("email_drafts_scheduled_idx").on(t.scheduledFor),
    venueIdx: index("email_drafts_venue_idx").on(t.venueId),
    venueEventIdx: index("email_drafts_venue_event_idx").on(t.venueEventId),
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
