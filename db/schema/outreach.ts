/**
 * Outreach activity tables.
 *
 * outreach_log — append-only audit trail of every contact attempt. Never
 *   updated; corrections are new rows. Spec §5.2.
 *
 * email_threads — links Gmail thread IDs to venues so replies thread back
 *   to the right record. One row per Gmail thread per staff inbox.
 *
 * reply_inbox — the unified reply triage view (Spec §6.7). One row per
 *   reply received that needs response. SLA timer drives the dashboard
 *   "stale replies" alerts.
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { archivedAt, auditColumns, idColumn, versionColumn } from "../types";
import { outreachBrands } from "./brands";
import { cityCampaigns } from "./city-campaigns";
import {
  cadenceState,
  outreachChannel,
  outreachOutcome,
  replyCategory,
  replyClassification,
  threadDirection,
  threadState,
} from "./enums";
import { events } from "./events";
import { staffMembers, staffOutreachEmails } from "./users";
import { venueEvents } from "./venue-events";
import { venues } from "./venues";

// =========================================================================
// outreach_log (append-only)
// =========================================================================

export const outreachLog = pgTable(
  "outreach_log",
  {
    ...idColumn,

    venueId: uuid("venue_id")
      .notNull()
      .references(() => venues.id, { onDelete: "restrict" }),

    // Specific venue_event context if applicable. Null for early outreach
    // when no event has been assigned yet.
    venueEventId: uuid("venue_event_id").references(() => venueEvents.id, {
      onDelete: "set null",
    }),

    // Brand context: "Eventsperse reached out to this venue on behalf of
    // Fright Crawl Halloween 2026." The outreach brand answers the
    // "from whom" question. CrawlBrand context comes via venueEventId →
    // event → cityCampaign → campaign → crawlBrand.
    outreachBrandId: uuid("outreach_brand_id")
      .notNull()
      .references(() => outreachBrands.id, { onDelete: "restrict" }),

    staffMemberId: uuid("staff_member_id")
      .notNull()
      .references(() => staffMembers.id, { onDelete: "restrict" }),

    // Specifically which inbox sent it (when channel = email).
    staffOutreachEmailId: uuid("staff_outreach_email_id").references(() => staffOutreachEmails.id, {
      onDelete: "set null",
    }),

    channel: outreachChannel("channel").notNull(),
    outcome: outreachOutcome("outcome").notNull(),

    subject: text("subject"),
    bodySnippet: text("body_snippet"), // First ~500 chars for log readability
    externalId: text("external_id"), // Gmail message ID, Quo call ID, etc.

    notes: text("notes"),

    /** Verbal-confirmation flag (migration 0110). An operator marks the logged
     *  CALL where a venue verbally confirmed a slot, so the venue detail card
     *  can surface the proof for dispute defense (symmetric to the email flag).
     *  flaggedBy/At record which operator filed it + when. These are the only
     *  mutable columns on this otherwise append-only table. */
    isConfirmation: boolean("is_confirmation").notNull().default(false),
    confirmationFlaggedBy: uuid("confirmation_flagged_by").references(() => staffMembers.id, {
      onDelete: "set null",
    }),
    confirmationFlaggedAt: timestamp("confirmation_flagged_at", { withTimezone: true }),

    // Append-only: no updatedAt, no version, no archive.
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (table) => ({
    venueCreatedAtIdx: index("outreach_log_venue_created_idx").on(table.venueId, table.createdAt),
    staffCreatedAtIdx: index("outreach_log_staff_created_idx").on(
      table.staffMemberId,
      table.createdAt,
    ),
    venueEventIdx: index("outreach_log_venue_event_idx").on(table.venueEventId),
    outreachBrandIdx: index("outreach_log_outreach_brand_idx").on(table.outreachBrandId),
    channelOutcomeIdx: index("outreach_log_channel_outcome_idx").on(table.channel, table.outcome),
    externalIdIdx: index("outreach_log_external_id_idx").on(table.externalId),
  }),
);

// =========================================================================
// email_threads
// =========================================================================

export const emailThreads = pgTable(
  "email_threads",
  {
    ...idColumn,

    // Nullable: threads can ingest into the shared team inbox WITHOUT
    // a venue match. The poll worker tries to resolve a venue from
    // the sender domain; if that fails, the thread still ingests with
    // venueId = null and an operator can attach a venue post-triage
    // from the inbox UI. Migration 0046 dropped the NOT NULL.
    venueId: uuid("venue_id").references(() => venues.id, { onDelete: "restrict" }),

    // Nullable: threads ingest into the team's shared inbox WITHOUT a
    // brand attribution. The brand (and/or campaign) gets attached
    // later, after triage, via a dedicated assignment UI. Migration
    // 0045 dropped the NOT NULL on the underlying column.
    outreachBrandId: uuid("outreach_brand_id").references(() => outreachBrands.id, {
      onDelete: "restrict",
    }),

    staffOutreachEmailId: uuid("staff_outreach_email_id")
      .notNull()
      .references(() => staffOutreachEmails.id, { onDelete: "restrict" }),

    gmailThreadId: text("gmail_thread_id").notNull(),
    subject: text("subject"),

    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),

    // -------------------------------------------------------------------
    // Inbox UI fields (0020_inbox.sql)
    // -------------------------------------------------------------------
    /**
     * State machine driving folder routing. New inbound message →
     * needs_reply. We send a reply → waiting_on_them. Etc.
     */
    state: threadState("state").notNull().default("needs_reply"),

    /**
     * Latest reply classification copied onto the thread for fast list
     * rendering. Updated when the classifier runs on a new inbound msg.
     */
    classification: replyClassification("classification").notNull().default("unclassified"),

    /**
     * AI-suggested classification for the most recent inbound. Distinct
     * from `classification` so the operator-confirmed value isn't
     * overwritten by re-classification. The inbox UI shows this next
     * to the (unclassified) pill as a one-click confirm; once the
     * operator either confirms or overrides, this column is cleared
     * back to NULL.
     *
     * Migration 0066.
     */
    suggestedClassification: replyClassification("suggested_classification"),
    suggestedClassificationConfidence: numeric("suggested_classification_confidence", {
      precision: 4,
      scale: 3,
    }),
    suggestedClassificationAt: timestamp("suggested_classification_at", { withTimezone: true }),

    /**
     * AI-generated 3-line thread summary (Phase A.3). Cached on the
     * thread row so the model isn't called per page-load. Regenerated
     * lazily when message_count > ai_summary_message_count and the
     * operator opens the thread.
     *
     * Shape: { "headline": "...", "context": "...", "next": "..." }
     *
     * Migration 0067.
     */
    aiSummary: jsonb("ai_summary").$type<{
      headline: string;
      context: string;
      next: string;
    } | null>(),
    aiSummaryAt: timestamp("ai_summary_at", { withTimezone: true }),
    aiSummaryMessageCount: integer("ai_summary_message_count"),

    /**
     * AI-enriched next-action suggestion (Phase A.4). Augments the
     * rule-based suggestNextAction with a thread-context-aware
     * recommendation for ambiguous cases. Cached on the row; lazy-
     * regenerated when classification or message_count changes.
     *
     * Shape: {
     *   "label": "...",
     *   "reason": "...",
     *   "urgency": "now" | "today" | "this_week" | "when_able",
     *   "generatedAt": "...",
     *   "classification": "..."
     * }
     *
     * Migration 0068.
     */
    aiNextAction: jsonb("ai_next_action").$type<Record<string, unknown> | null>(),
    aiNextActionAt: timestamp("ai_next_action_at", { withTimezone: true }),
    aiNextActionMessageCount: integer("ai_next_action_message_count"),

    /**
     * Smart-reply chips cache (Haiku ROI sprint — Tier S #1).
     *
     * 3 short one-tap reply suggestions surfaced above the reply
     * buttons in the inbox thread page. Generated lazily on first
     * view when the thread qualifies (latest message inbound,
     * classification needs-reply, AI configured). Regenerated when
     * message_count exceeds ai_quick_replies_message_count.
     *
     * Shape (legacy v1): ["short reply 1", "medium reply 2", "polite-no reply 3"]
     * Shape (v2, learning loop 2026-06-11):
     *   { v: 2, chips: string[], exampleIds: string[] }
     * exampleIds = the reply_examples rows that grounded the chips, so
     * the composer can record sent-as-is/edited/rewritten feedback.
     * Readers normalize both shapes (see QuickReplyChips
     * normalizeQuickReplies). Each chip ≤ 280 chars (mobile-tappable).
     *
     * Migration 0076 (column); v2 shape needs no migration (jsonb).
     */
    aiQuickReplies: jsonb("ai_quick_replies").$type<
      string[] | { v: 2; chips: string[]; exampleIds: string[] } | null
    >(),
    aiQuickRepliesAt: timestamp("ai_quick_replies_at", { withTimezone: true }),
    aiQuickRepliesMessageCount: integer("ai_quick_replies_message_count"),

    /**
     * Initial direction. 'mixed' once both inbound and outbound exist.
     */
    direction: threadDirection("direction").notNull().default("inbound"),

    /** Updated on every inbound message; drives SLA breach computation. */
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),

    /** Updated on every reply we send. */
    lastOutboundAt: timestamp("last_outbound_at", { withTimezone: true }),

    /** True when the stale-tagger has flagged this thread as past SLA.
     *  Set by lib/stale-tagger.ts on a periodic scan; cleared on
     *  operator action (reply sent, archive, state change). Migration 0050. */
    isStale: boolean("is_stale").notNull().default(false),

    /** When the thread first crossed the SLA threshold. Null when
     *  is_stale=false. */
    staleSince: timestamp("stale_since", { withTimezone: true }),

    /** Short human-readable reason the thread is stale. Used as a
     *  tooltip on the stale chip. */
    staleReason: text("stale_reason"),

    /** True when an inbound reply needs human triage: the auto-classifier
     *  landed BELOW the confidence floor (Reference Doc 8.4: act only at
     *  >=90%), or (Phase 2.9) the engine could not produce a suggested
     *  response. Distinct from is_stale (SLA staleness). Set by the classifier;
     *  cleared on operator triage (setThreadNeedsAttention). The worklist
     *  (Phase 2) surfaces these first. Migration 0104. [ReferenceDoc 8.4] */
    needsAttention: boolean("needs_attention").notNull().default(false),

    /** Follow-up cadence stage. 0=initial cold send, 1=follow_up_due
     *  flipped by cadence cron, 2=call task auto-created. Reset to 0
     *  when an operator action (reply, state change) interrupts the
     *  cadence. Added in migration 0051. */
    followUpStage: smallint("follow_up_stage").notNull().default(0),

    /** When the next cadence step should fire for this thread. NULL
     *  means no pending cadence (replied, closed, or reached the
     *  terminal stage). The cadence cron scans for rows with
     *  follow_up_next_due_at <= NOW(). */
    followUpNextDueAt: timestamp("follow_up_next_due_at", { withTimezone: true }),

    /** When the last cadence advance happened. Audit / debugging. */
    followUpLastAdvancedAt: timestamp("follow_up_last_advanced_at", { withTimezone: true }),

    /** ~140-char preview of the latest message body, denormalized. */
    snippet: text("snippet"),

    /** Total messages in thread; denormalized for list-view speed. */
    messageCount: integer("message_count").notNull().default(0),

    /** Global unread count (not per-staff in v1). */
    unreadCount: integer("unread_count").notNull().default(0),

    /** Display name of the latest sender — "Sarah at Lavelle". */
    lastSenderName: text("last_sender_name"),

    /**
     * Owner of the thread. Defaults to original sender; admin can reassign.
     * Note: this overlaps with reply_inbox.assigned_staff_id — the thread
     * value is canonical and wins on conflict.
     */
    assignedStaffId: uuid("assigned_staff_id").references(() => staffMembers.id, {
      onDelete: "set null",
    }),

    /** Campaign context — shows as chip in the list, filters URL params. */
    cityCampaignId: uuid("city_campaign_id").references(() => cityCampaigns.id, {
      onDelete: "set null",
    }),

    /** Event context — shows as chip in the list. */
    eventId: uuid("event_id").references(() => events.id, {
      onDelete: "set null",
    }),

    /** Gmail-style star. Operator-toggled, rendered as a yellow star on
     *  thread rows + drives the Starred mailbox view. Engine-side only
     *  in v1; a future cron can two-way sync to Gmail via the API since
     *  connected accounts carry OAuth creds. Added in migration 0057. */
    isStarred: boolean("is_starred").notNull().default(false),

    /** Gmail-style snooze. When set, the thread hides from default
     *  mailbox views until the timestamp passes. NULL = not snoozed.
     *  Added in migration 0057. */
    snoozeUntil: timestamp("snooze_until", { withTimezone: true }),

    /** Soft-trash. Set when an operator clicks Delete on the thread;
     *  the UI treats deleted_at IS NOT NULL as "in trash" — recoverable,
     *  not hard-deleted. Distinct from archivedAt so trash + untrash
     *  don't disturb the audit lineage. Added in migration 0057. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),

    /** Persisted venue-match classification. loadVenueCommunication
     *  (lib/venue-communication.ts) otherwise recomputes the match
     *  signal on every render. These columns let a future poller write
     *  (lib/gmail-poll-worker.ts) persist the resolved value once so the
     *  timeline loader can read it back instead of recomputing.
     *
     *  match_source: one of "venue_id" | "email_match" | "domain_match"
     *  (mirrors VenueCommunicationSource). NULL = not yet persisted; the
     *  loader falls back to the computed value.
     *  match_confidence: free-form confidence label (e.g. "high" for the
     *  direct venue_id case, "low" for domain_match).
     *  Added in migration 0089. */
    matchSource: text("match_source"),
    matchConfidence: text("match_confidence"),

    /**
     * Cadence engine state machine (Phase 1.7). NULL for threads created
     * before the cadence rewrite / not yet migrated (see Phase 1.11).
     * cadenceNextDueAt is when the next touch or nudge falls due; the daily
     * cadence cron scans on it. The supporting indexes (incl. the partial
     * `email_threads_cadence_due_idx WHERE cadence_state IS NOT NULL`) live in
     * migration 0094 -- drizzle-kit cannot express partial indexes and this
     * repo hand-writes migrations. [ReferenceDoc Section 6]
     */
    cadenceState: cadenceState("cadence_state"),
    cadenceNextDueAt: timestamp("cadence_next_due_at", { withTimezone: true }),

    /**
     * Slot-change reply flag (Phase 3.5, migration 0117). [ReferenceDoc 9.4]
     * Raised by lib/slot-change-detect (a pure phrase heuristic, NOT an AI
     * reply_classification value) when a CONFIRMED venue replies asking to move
     * to a different day/slot. The /worklist "Slot change requested" section
     * reads it; the operator then drives the cancel-old / confirm-new swap.
     * slotChangePhrase is the change-intent phrase that matched, for display.
     */
    slotChangeRequested: boolean("slot_change_requested").notNull().default(false),
    slotChangeDetectedAt: timestamp("slot_change_detected_at", { withTimezone: true }),
    slotChangePhrase: text("slot_change_phrase"),

    ...auditColumns,
    ...archivedAt,
    ...versionColumn,
  },
  (table) => ({
    threadStaffUnique: uniqueIndex("email_threads_thread_staff_unique").on(
      table.gmailThreadId,
      table.staffOutreachEmailId,
    ),
    venueIdx: index("email_threads_venue_idx").on(table.venueId),
    lastMessageIdx: index("email_threads_last_message_idx").on(table.lastMessageAt),
    stateLastMsgIdx: index("email_threads_state_last_msg_idx").on(table.state, table.lastMessageAt),
    assignedStateIdx: index("email_threads_assigned_state_idx").on(
      table.assignedStaffId,
      table.state,
      table.lastMessageAt,
    ),
    cityCampaignStateIdx: index("email_threads_city_campaign_state_idx").on(
      table.cityCampaignId,
      table.state,
      table.lastMessageAt,
    ),
    eventStateIdx: index("email_threads_event_state_idx").on(
      table.eventId,
      table.state,
      table.lastMessageAt,
    ),
    brandStateIdx: index("email_threads_brand_state_idx").on(
      table.outreachBrandId,
      table.state,
      table.lastMessageAt,
    ),
    needsReplyInboundIdx: index("email_threads_needs_reply_inbound_idx").on(table.lastInboundAt),
  }),
);

// =========================================================================
// reply_inbox
// =========================================================================

export const replyInbox = pgTable(
  "reply_inbox",
  {
    ...idColumn,

    emailThreadId: uuid("email_thread_id")
      .notNull()
      .references(() => emailThreads.id, { onDelete: "cascade" }),

    venueId: uuid("venue_id")
      .notNull()
      .references(() => venues.id, { onDelete: "restrict" }),

    // Default to the staffer who sent the original. Admin can reassign.
    assignedStaffId: uuid("assigned_staff_id").references(() => staffMembers.id, {
      onDelete: "set null",
    }),

    category: replyCategory("category").notNull().default("unclear"),

    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),

    // Set when the SLA threshold elapses without response. Drives alerts.
    slaBreachedAt: timestamp("sla_breached_at", { withTimezone: true }),

    // ~200-char preview for the triage list.
    summary: text("summary"),

    ...auditColumns,
  },
  (table) => ({
    assignedStaffIdx: index("reply_inbox_assigned_staff_idx").on(table.assignedStaffId),
    receivedAtIdx: index("reply_inbox_received_at_idx").on(table.receivedAt),
    respondedAtIdx: index("reply_inbox_responded_at_idx").on(table.respondedAt),
    slaBreachedIdx: index("reply_inbox_sla_breached_idx").on(table.slaBreachedAt),
    venueIdx: index("reply_inbox_venue_idx").on(table.venueId),
  }),
);

// =========================================================================
// Inferred types
// =========================================================================

export type OutreachLogEntry = typeof outreachLog.$inferSelect;
export type NewOutreachLogEntry = typeof outreachLog.$inferInsert;
export type EmailThread = typeof emailThreads.$inferSelect;
export type NewEmailThread = typeof emailThreads.$inferInsert;
export type ReplyInboxItem = typeof replyInbox.$inferSelect;
export type NewReplyInboxItem = typeof replyInbox.$inferInsert;
