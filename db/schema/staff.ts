/**
 * Staff entities.
 *
 * staff_members: the people on the team (Bryle, JC, Yasue, Brandon...).
 * Persistent across brands and campaigns.
 *
 * staff_outreach_emails: one row per (staff_member × outreach_brand). Holds
 * the Gmail OAuth tokens, the brand-specific email address, and connection
 * health. When a staffer sends a cold email under Eventsperse, the engine
 * looks up THIS row, not the staff_member directly.
 *
 * Naming note: this junction is named `staff_outreach_emails` (not
 * `staff_brand_emails`) per DECISIONS.md#010 — only OutreachBrands have
 * email infrastructure; CrawlBrands do not.
 */

import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { archivedAt, auditColumns, idColumn, versionColumn } from "../types";
import { outreachBrands } from "./brands";
import { staffOutreachEmailStatus, staffRole, staffStatus } from "./enums";

// =========================================================================
// staff_members
// =========================================================================

export const staffMembers = pgTable(
  "staff_members",
  {
    ...idColumn,
    displayName: text("display_name").notNull(),
    primaryEmail: text("primary_email").notNull(), // Login email
    role: staffRole("role").notNull().default("outreach"),
    status: staffStatus("status").notNull().default("active"),

    // IANA timezone (e.g. "America/Toronto"). Used per DECISIONS.md#012 for
    // user-TZ display in cross-city views.
    timezone: text("timezone").notNull().default("America/Toronto"),

    // E.164 cell phone for the staffer. Powers Quo escalation handoff
    // (Yesu/JC escalate calls to Brandon) and future per-staffer call-from
    // routing. Migration 0023 seeds Yesu + JC. NULL allowed: not every
    // staffer needs one on file (e.g. Gela / Web & Graphics).
    phoneE164: text("phone_e164"),

    // Free-form display title shown in the UI ("Outreach Specialist",
    // "Outreach Manager", "Outreach Director", "Web & Graphics", etc).
    // Distinct from `role`, which gates permissions; `title` is purely
    // display. See DECISIONS.md and migration 0023.
    title: text("title"),

    // Top-down weekly goals (Section 7.4 of the spec). 0 = no goal set.
    weeklyEmailGoal: integer("weekly_email_goal").notNull().default(0),
    weeklyCallGoal: integer("weekly_call_goal").notNull().default(0),

    ...archivedAt,
    ...auditColumns,
    ...versionColumn,
  },
  (table) => ({
    primaryEmailUnique: uniqueIndex("staff_members_primary_email_unique").on(table.primaryEmail),
    statusIdx: index("staff_members_status_idx").on(table.status),
    roleIdx: index("staff_members_role_idx").on(table.role),
  }),
);

// =========================================================================
// staff_outreach_emails
// =========================================================================

export const staffOutreachEmails = pgTable(
  "staff_outreach_emails",
  {
    ...idColumn,

    staffMemberId: uuid("staff_member_id")
      .notNull()
      .references(() => staffMembers.id, { onDelete: "restrict" }),

    outreachBrandId: uuid("outreach_brand_id")
      .notNull()
      .references(() => outreachBrands.id, { onDelete: "restrict" }),

    // The actual email address used to send cold outreach.
    // e.g. "jc@eventsperse.com"
    emailAddress: text("email_address").notNull(),

    // Gmail OAuth refresh token, encrypted. Access tokens are short-lived
    // and refetched on demand; we only persist the refresh token.
    gmailOauthRefreshToken: text("gmail_oauth_refresh_token"),
    gmailOauthScopes: text("gmail_oauth_scopes").array(),

    // History API watchpoint for reply detection (Phase 6).
    gmailLastHistoryId: text("gmail_last_history_id"),

    // Per-staff phone line if it overrides the brand default
    quoLineE164Override: text("quo_line_e164_override"),

    // --- Send throttling (0006_send_throttle.sql) ---
    /**
     * Hard cap on cold sends per rolling 24-hour window. Default 30 —
     * the upper bound of the spam-safe range. Operator can lower to be
     * cautious or raise toward 50 once the inbox has proven reputation
     * (60+ days, bounce rate <2%, reply rate >5%).
     */
    dailySendLimit: integer("daily_send_limit").notNull().default(30),
    /** Cap per rolling 60min. Prevents bursting; default 10 (about 30/day ÷ 8 business hours). */
    hourlySendLimit: integer("hourly_send_limit").notNull().default(10),
    /** Spacing floor between consecutive sends, in seconds. */
    minSecondsBetweenSends: integer("min_seconds_between_sends").notNull().default(90),

    /**
     * Warm-up phase: when true, the effective daily cap is min(
     * dailySendLimit, 10 + daysSinceWarmupStarted * 2 ). At day 14
     * the ramp reaches 38, so the daily cap (30) takes over — at which
     * point warmupPhase flips to false on the next send.
     */
    warmupPhase: boolean("warmup_phase").notNull().default(true),
    warmupStartedAt: timestamp("warmup_started_at", { withTimezone: true }),

    /** Restrict sends to 9am-5pm in the staff member's local TZ. */
    businessHoursOnly: boolean("business_hours_only").notNull().default(true),
    weekdaysOnly: boolean("weekdays_only").notNull().default(true),

    /**
     * Auto-pause: set by the deliverability monitor when bounce rate
     * crosses 2% over a 30-day window. Operator must manually clear
     * (and presumably investigate) before sends resume.
     */
    autoPausedAt: timestamp("auto_paused_at", { withTimezone: true }),
    autoPausedReason: text("auto_paused_reason"),

    status: staffOutreachEmailStatus("status").notNull().default("disconnected"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),

    ...auditColumns,
    ...versionColumn,
  },
  (table) => ({
    // One staffer has at most one connected inbox per OutreachBrand.
    staffBrandUnique: uniqueIndex("staff_outreach_emails_staff_brand_unique").on(
      table.staffMemberId,
      table.outreachBrandId,
    ),
    emailAddressUnique: uniqueIndex("staff_outreach_emails_address_unique").on(table.emailAddress),
    statusIdx: index("staff_outreach_emails_status_idx").on(table.status),
  }),
);

// =========================================================================
// Inferred types
// =========================================================================

export type StaffMember = typeof staffMembers.$inferSelect;
export type NewStaffMember = typeof staffMembers.$inferInsert;
export type StaffOutreachEmail = typeof staffOutreachEmails.$inferSelect;
export type NewStaffOutreachEmail = typeof staffOutreachEmails.$inferInsert;
