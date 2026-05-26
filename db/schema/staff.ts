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

import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
