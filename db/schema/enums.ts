/**
 * All pgEnum definitions, in one place for easy discovery and to ensure
 * consistent naming. Drizzle generates `CREATE TYPE x AS ENUM (...)` per
 * enum on first migration. Adding a value to an existing enum requires a
 * new migration with `ALTER TYPE ... ADD VALUE`.
 *
 * Naming: snake_case for the Postgres type, matching the table-style
 * naming used everywhere else.
 */

import { pgEnum } from "drizzle-orm/pg-core";

// =========================================================================
// Brand-related
// =========================================================================

export const outreachBrandStatus = pgEnum("outreach_brand_status", ["active", "retired"]);

export const crawlBrandStatus = pgEnum("crawl_brand_status", ["active", "retired"]);

export const crawlBrandGeography = pgEnum("crawl_brand_geography", ["toronto", "international"]);

export const holidayType = pgEnum("holiday_type", ["stpaddys", "halloween", "newyears", "custom"]);

// =========================================================================
// Staff
// =========================================================================

export const staffRole = pgEnum("staff_role", ["admin", "lead", "outreach", "readonly"]);

export const staffStatus = pgEnum("staff_status", ["active", "inactive"]);

export const staffOutreachEmailStatus = pgEnum("staff_outreach_email_status", [
  "connected",
  "needs_reauth",
  "disconnected",
]);

// =========================================================================
// Campaigns + events
// =========================================================================

export const campaignStatus = pgEnum("campaign_status", [
  "planning",
  "active",
  "completed",
  "archived",
]);

export const cityCampaignStatus = pgEnum("city_campaign_status", [
  "planning",
  "active",
  "confirmed",
  "contract_signed",
  "cancelled",
]);

export const eventStatus = pgEnum("event_status", [
  "planned",
  "confirmed",
  "contract_signed",
  "completed",
  "cancelled",
]);

/** Crawl shape — drives the tracker row format + completion predicate.
 *  - 'standard': wristband + 2 middles + final (4 venues)
 *  - 'day_party': wristband + 2 middles, NO final (3 venues). Day
 *    parties wrap before the final hour. Migration 0074. */
export const crawlFormat = pgEnum("crawl_format", ["standard", "day_party"]);

/** Crawl management deliverables (Migration 0075). One row per
 *  (venue_event, deliverable_type) in the crawl_deliverables table.
 *  The 'wristbands' deliverable is informational on this side —
 *  actual status comes from the existing wristbands table. */
export const crawlDeliverableType = pgEnum("crawl_deliverable_type", [
  "social_media_graphics",
  "staff_sheet",
  "participant_poster",
  "wristbands",
  "week_of_confirmation",
]);

export const crawlDeliverableStatus = pgEnum("crawl_deliverable_status", [
  "pending",
  "done",
  "n_a",
]);

// =========================================================================
// Venues
// =========================================================================

export const venueRole = pgEnum("venue_role", ["wristband", "middle", "final", "alt_final"]);

export const venueEventStatus = pgEnum("venue_event_status", [
  "lead",
  "contacted",
  "interested",
  "negotiating",
  "confirmed",
  "scheduled",
  "contract_signed",
  "declined",
  "cancelled",
]);

// =========================================================================
// Outreach
// =========================================================================

export const outreachChannel = pgEnum("outreach_channel", [
  "email",
  "call",
  "sms",
  "viber",
  "instagram",
  "form",
  "in_person",
]);

export const outreachOutcome = pgEnum("outreach_outcome", [
  "sent",
  "bad_email",
  "bounced",
  "no_answer",
  "voicemail",
  "callback_requested",
  "declined",
  "interested",
  "confirmed",
  "contract_signed",
  "wrong_number",
  "email_collected",
  "competing_event",
  "hours_mismatch",
]);

export const replyCategory = pgEnum("reply_category", [
  "yes",
  "no",
  "question",
  "out_of_office",
  "unclear",
]);

// =========================================================================
// Wristbands
// =========================================================================

export const wristbandStatus = pgEnum("wristband_status", [
  "pending",
  "ready_to_ship",
  "shipped",
  "delivered",
  "issue",
]);

// =========================================================================
// Tasks
// =========================================================================

export const taskSource = pgEnum("task_source", ["auto", "manual", "smart_note"]);

export const taskStatus = pgEnum("task_status", [
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);

export const taskTargetType = pgEnum("task_target_type", [
  "venue_event",
  "venue",
  "city_campaign",
  "wristband",
  "misc",
  "email_thread",
]);

// =========================================================================
// Notes
// =========================================================================

export const noteTargetType = pgEnum("note_target_type", [
  "city_campaign",
  "venue",
  "campaign",
  "event",
]);

// =========================================================================
// Halloween-aware event model (Phase 8b)
// =========================================================================
export const dayPart = pgEnum("day_part", [
  "thursday_night",
  "friday_night",
  "saturday_day",
  "saturday_night",
  "sunday_day",
  "sunday_night",
  "other",
]);

// =========================================================================
// Email templates + validation
// =========================================================================

export const emailTemplateStage = pgEnum("email_template_stage", [
  "cold",
  "follow_up_1",
  "follow_up_2",
  "poster_delivery",
  "confirm_2_week",
  "confirm_1_week",
  "floor_staff_3_day",
  "custom",
]);

export const emailValidationStatus = pgEnum("email_validation_status", [
  "valid",
  "invalid",
  "catch_all",
  "unknown",
  "spamtrap",
  "abuse",
  "do_not_mail",
]);

// =========================================================================
// Goals
// =========================================================================

export const goalScope = pgEnum("goal_scope", [
  "campaign",
  "outreach_brand",
  "crawl_brand",
  "city_campaign",
  "staff_weekly",
]);

export const goalMetric = pgEnum("goal_metric", [
  "revenue_cents",
  "venue_count",
  "emails_sent",
  "calls_made",
  "confirmations",
  "replies_received",
]);

// =========================================================================
// Financial
// =========================================================================

export const financialLineType = pgEnum("financial_line_type", [
  "ticket_revenue",
  "platform_fee",
  "marketing",
  "wristband_cost",
  "staff_cost",
  "venue_cost",
  "other",
]);

// =========================================================================
// Inbox (Gmail-style threading + classification — 0020_inbox.sql)
// =========================================================================

/**
 * thread_state — the state machine that drives folder routing in the Inbox UI.
 *
 *   needs_reply     — inbound message waiting on us
 *   waiting_on_them — we replied, ball in their court
 *   follow_up_due   — cadence triggered; we should ping again
 *   closed_won      — they said yes / contract signed
 *   closed_lost     — declined
 *   closed_dnc      — do not contact (bounces, unsubscribes, opt-outs)
 *   archived        — manually archived, no decision implied
 */
export const threadState = pgEnum("thread_state", [
  "needs_reply",
  "waiting_on_them",
  "follow_up_due",
  "closed_won",
  "closed_lost",
  "closed_dnc",
  "archived",
]);

export const threadDirection = pgEnum("thread_direction", ["inbound", "outbound", "mixed"]);

/**
 * reply_classification — the AI classifier output, copied onto the thread
 * for fast list-view rendering. Superset of reply_category to add
 * callback_requested + unsubscribe + auto_reply + spam.
 */
export const replyClassification = pgEnum("reply_classification", [
  "interested",
  "warm",
  "confirmed",
  "question",
  "callback_requested",
  "decline",
  "unsubscribe",
  "auto_reply",
  "spam",
  "unclassified",
]);

export const messageKind = pgEnum("message_kind", ["email", "sms", "viber", "line", "manual_note"]);

/**
 * cadence_state - the per-thread state machine driving the new cadence engine
 * (Phase 1.7). Cold sequence: pending/sent for touches 1-3, then exhausted +
 * ready for cross-domain handoff. Warm sequence: pending-response then up to
 * three nudges. Terminal/exceptional states cover stalled-warm, declined,
 * opt-out, cancelled-by-them, confirmed, and lifecycle-active. See migration
 * 0094. [ReferenceDoc Section 6]
 */
export const cadenceState = pgEnum("cadence_state", [
  "cold_pending_touch_1",
  "cold_sent_touch_1",
  "cold_pending_touch_2",
  "cold_sent_touch_2",
  "cold_pending_touch_3",
  "cold_sent_touch_3",
  "cold_exhausted_ready_for_handoff",
  "warm_pending_response",
  "warm_responded_pending_nudge_1",
  "warm_nudge_1_sent",
  "warm_pending_nudge_2",
  "warm_nudge_2_sent",
  "warm_pending_nudge_3",
  "warm_nudge_3_sent",
  "stalled_warm",
  "declined_this_campaign",
  "opt_out_permanent",
  "cancelled_by_them",
  "confirmed",
  "lifecycle_active",
]);

export type CadenceState = (typeof cadenceState.enumValues)[number];

// Payment rails for paying hosts (internal staff + external contractors).
export const paymentMethod = pgEnum("payment_method", [
  "venmo",
  "bank",
  "interac",
  "zelle",
  "paypal",
  "wise",
]);

// Which host roster a crawl_hosts row points at.
export const hostKind = pgEnum("host_kind", ["internal", "external"]);

// =========================================================================
// Crawl issues (live-support issue logging)
// =========================================================================

export const crawlIssueType = pgEnum("crawl_issue_type", [
  "venue_not_expecting",
  "capacity",
  "door_line",
  "wristband_checkin",
  "final_venue",
  "wrong_address",
  "manager_unavailable",
  "schedule_confusion",
  "attendee_complaint",
  "staff_no_show",
  "other",
]);

export const crawlIssueSeverity = pgEnum("crawl_issue_severity", [
  "low",
  "medium",
  "high",
  "critical",
]);

export const crawlIssueStatus = pgEnum("crawl_issue_status", ["open", "in_progress", "resolved"]);

// =========================================================================
// Call logs (live-support telephony)
// =========================================================================

export const callDirection = pgEnum("call_direction", ["incoming", "outgoing"]);

// How confidently an inbound call was attributed. "area_code" is a WEAK hint
// (never treat as confirmed); "none" = unmatched (surface prominently).
export const callMatchType = pgEnum("call_match_type", [
  "venue",
  "staff",
  "prior",
  "area_code",
  "none",
]);

// =========================================================================
// Audit
// =========================================================================

export const auditOperation = pgEnum("audit_operation", ["INSERT", "UPDATE", "DELETE"]);
