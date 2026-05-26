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
  "cancelled",
]);

export const eventStatus = pgEnum("event_status", [
  "planned",
  "confirmed",
  "completed",
  "cancelled",
]);

// =========================================================================
// Venues
// =========================================================================

export const venueRole = pgEnum("venue_role", ["wristband", "middle", "final"]);

export const venueEventStatus = pgEnum("venue_event_status", [
  "lead",
  "contacted",
  "interested",
  "negotiating",
  "confirmed",
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
  "wrong_number",
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
]);

// =========================================================================
// Notes
// =========================================================================

export const noteTargetType = pgEnum("note_target_type", ["city_campaign", "venue", "campaign"]);

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
// Audit
// =========================================================================

export const auditOperation = pgEnum("audit_operation", ["INSERT", "UPDATE", "DELETE"]);
