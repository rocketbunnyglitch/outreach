/**
 * Auth + identity tables.
 *
 * users: the people on the team. Authenticated by email + password
 *   (NextAuth Credentials provider). Was `staff_members` until
 *   migration 0041; the rename consolidated "staff" and "user" into
 *   one concept since every staff member is the only kind of user.
 *
 * connected_accounts: one row per connected Gmail inbox. A user may
 *   own multiple — typically up to three Workspace accounts across
 *   different orgs. The inbox surface reads across every row tied
 *   to the user's team (with a "Mine" toggle to filter to just
 *   their own). Was `staff_outreach_emails` until migration 0042;
 *   the rename dropped the brand FK since cold-outreach sending is
 *   being decommissioned, but kept every other column intact so
 *   the send-throttling logic can be revisited in a follow-up.
 *
 * Both tables get a team_id FK pinning them to the seeded
 * BarCrawlConnect team. Multi-tenancy is not currently a product
 * goal — the column exists so the inbox can filter by team without
 * hard-coding tenancy.
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
import { staffOutreachEmailStatus, staffRole, staffStatus } from "./enums";
import { teams } from "./teams";

// =========================================================================
// users (was staff_members)
// =========================================================================

export const users = pgTable(
  "users",
  {
    ...idColumn,
    displayName: text("display_name").notNull(),
    primaryEmail: text("primary_email").notNull(), // Login email
    role: staffRole("role").notNull().default("outreach"),
    status: staffStatus("status").notNull().default("active"),

    // Team scope — set on every row, defaulted via the migration to
    // the single seeded BarCrawlConnect team. The inbox surface
    // filters connected_accounts on this column so users only see
    // their own team's inboxes.
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),

    // ----------------------------------------------------------------
    // Password auth (migration 0042)
    // ----------------------------------------------------------------
    // Bcrypt hash of the user's login password. Nullable on purpose:
    //   - invited-but-not-yet-onboarded users may exist without one
    //     while an invite_tokens row is pending
    //   - admins can create users via "send invite link" which
    //     defers password setup to the user
    // The auth signIn callback rejects login attempts where this
    // column is NULL.
    passwordHash: text("password_hash"),
    /** Last time the password was changed; null if never set. */
    passwordSetAt: timestamp("password_set_at", { withTimezone: true }),
    /** When true, the user is forced through /set-password on next
     *  login (e.g. admin-initiated reset). */
    passwordMustChange: boolean("password_must_change").notNull().default(false),

    // ----------------------------------------------------------------
    // Existing operational columns
    // ----------------------------------------------------------------
    // Reporting line for task visibility: a lead sees their own + their direct
    // reports' tasks. Self-FK (-> users.id) added in the original migration to
    // avoid the self-reference typing dance here. NULL = no manager.
    managerId: uuid("manager_id"),

    // IANA timezone (e.g. "America/Toronto"). Used per DECISIONS.md#012 for
    // user-TZ display in cross-city views.
    timezone: text("timezone").notNull().default("America/Toronto"),

    // E.164 cell phone for the user. Powers Quo escalation handoff
    // (Yesu/JC escalate calls to Brandon) and future per-user call-from
    // routing. Migration 0023 seeded Yesu + JC originally. NULL allowed:
    // not every user needs one on file.
    phoneE164: text("phone_e164"),

    // Free-form display title shown in the UI ("Outreach Specialist",
    // "Outreach Manager", "Web & Graphics", etc). Distinct from `role`,
    // which gates permissions; `title` is purely display.
    title: text("title"),

    // Top-down weekly goals (Section 7.4 of the spec). 0 = no goal set.
    weeklyEmailGoal: integer("weekly_email_goal").notNull().default(0),
    weeklyCallGoal: integer("weekly_call_goal").notNull().default(0),

    /** Last time the daily digest was sent to this user (Phase D.4).
     *  NULL = never sent. The cron uses this as a per-day idempotency
     *  guard so re-running on the same UTC day no-ops. */
    digestSentAt: timestamp("digest_sent_at", { withTimezone: true }),

    ...archivedAt,
    ...auditColumns,
    ...versionColumn,
  },
  (table) => ({
    primaryEmailUnique: uniqueIndex("users_primary_email_unique").on(table.primaryEmail),
    statusIdx: index("staff_members_status_idx").on(table.status),
    roleIdx: index("staff_members_role_idx").on(table.role),
    teamIdx: index("users_team_id_idx").on(table.teamId),
  }),
);

// =========================================================================
// connected_accounts (was staff_outreach_emails)
// =========================================================================

export const connectedAccounts = pgTable(
  "connected_accounts",
  {
    ...idColumn,

    // Team scope — same default seed as users.team_id.
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),

    // Owner of the connection — the user who connected this Gmail.
    // Was named staff_member_id before migration 0042.
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),

    // The actual email address connected. e.g. "jc@eventsperse.com".
    // Globally unique below — reconnecting an existing address
    // updates the row in place rather than inserting a duplicate.
    emailAddress: text("email_address").notNull(),

    // Gmail OAuth refresh token, encrypted via lib/crypto.ts. Access
    // tokens are short-lived (1h) and refetched on demand; we only
    // persist the refresh token. Never log or expose this value.
    gmailOauthRefreshToken: text("gmail_oauth_refresh_token"),
    gmailOauthScopes: text("gmail_oauth_scopes").array(),

    // History API watchpoint for reply detection.
    gmailLastHistoryId: text("gmail_last_history_id"),

    // Per-user phone line that overrides a future team default. Kept
    // because Quo escalation logic still reads it; can be revisited
    // when send-queue is decommissioned in a follow-up.
    quoLineE164Override: text("quo_line_e164_override"),

    // Send-throttling columns (daily_send_limit, hourly_send_limit,
    // warmup_phase, warmup_started_at, business_hours_only,
    // weekdays_only, auto_paused_at, auto_paused_reason,
    // min_seconds_between_sends) were dropped in migration 0043
    // along with the entire send-queue decommission. Inbox-only
    // model doesn't need per-account rate limits — each user just
    // sends from Gmail directly.

    status: staffOutreachEmailStatus("status").notNull().default("disconnected"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),

    /** Hard cap on cold sends per local day (sender user's timezone).
     *  Default 30 per the spec; admin can adjust per inbox in
     *  /admin/inboxes when an account is warming up. Added in
     *  migration 0049. */
    dailyColdSendCap: integer("daily_cold_send_cap").notNull().default(30),

    /** Cold-send pacing cooldown (migration 0106). After a cold send this is
     *  set to now() + a randomized 5-8 min; the send path blocks further cold
     *  sends from this inbox until it passes, and the composer shows a
     *  countdown ring. NULL = no active cooldown. Warm/replies are unaffected. */
    coldSendCooldownUntil: timestamp("cold_send_cooldown_until", { withTimezone: true }),

    /** Inbox warm-up ramp (migration 0125). When this inbox started warming
     *  up; NULL = established, full cap. A newly-connected inbox sends below
     *  its configured cap and ramps up over ~3 weeks. See lib/inbox-warmup.ts. */
    warmupStartedAt: timestamp("warmup_started_at", { withTimezone: true }),
    /** Deliverability pause (migration 0125). While true the send-cap preflight
     *  blocks COLD sends from this inbox (warm replies still go). Set by the
     *  bounce/complaint monitor or an admin toggle. */
    coldSendsPaused: boolean("cold_sends_paused").notNull().default(false),

    /** Optional HTML signature appended to outbound mail sent from
     *  this inbox. Edited from /settings/inboxes. The global composer
     *  appends it to the body if the operator hasn't already inlined
     *  a different signature in the draft.
     *
     *  Added in migration 0056. */
    signatureHtml: text("signature_html"),

    /** Google profile picture URL for this inbox, synced from the account's
     *  userinfo `picture` (migration 0109). NULL until the account connects/
     *  reconnects with the userinfo.profile scope. */
    avatarUrl: text("avatar_url"),

    ...auditColumns,
    ...versionColumn,
  },
  (table) => ({
    // Index on (team_id, owner_user_id) — every inbox query starts
    // with "filter by my team", and the optional ?mine=1 narrows to
    // the current user.
    teamOwnerIdx: index("connected_accounts_owner_idx").on(table.teamId, table.ownerUserId),
    teamIdx: index("connected_accounts_team_id_idx").on(table.teamId),
    // Globally unique — one row per connected Gmail address.
    // Reconnecting the same address updates the existing row
    // (see app/api/auth/google/callback/route.ts).
    emailAddressUnique: uniqueIndex("connected_accounts_address_unique").on(table.emailAddress),
    statusIdx: index("connected_accounts_status_idx").on(table.status),
  }),
);

// =========================================================================
// Inferred types
// =========================================================================

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type ConnectedAccount = typeof connectedAccounts.$inferSelect;
export type NewConnectedAccount = typeof connectedAccounts.$inferInsert;

// ---------------------------------------------------------------------------
// Back-compat aliases — short-lived bridge so the rename can ship before
// every importer in the codebase is updated. Will be removed in a
// follow-up cleanup PR; new code should import users / connectedAccounts
// directly.
//
// Both aliases point at the same Drizzle table objects so any code path
// using them continues to work without semantic change. The intent is
// to keep this commit's diff bounded — every call site doesn't have to
// move in one go. tsc + biome both accept these.
// ---------------------------------------------------------------------------
export const staffMembers = users;
export const staffOutreachEmails = connectedAccounts;
export type StaffMember = User;
export type NewStaffMember = NewUser;
export type StaffOutreachEmail = ConnectedAccount;
export type NewStaffOutreachEmail = NewConnectedAccount;
