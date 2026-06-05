/**
 * user_preferences — per-user UI prefs synced across devices.
 * See migration 0060.
 *
 * Each user has at most one row. Reads return null when no row
 * exists; the application layer treats null as "use defaults".
 *
 * Why not store on the users table directly: preferences should be
 * cheap to evolve over time (each new toggle is a new column or
 * a JSONB field), and we don't want to gate preference changes
 * behind users-table migrations which require coordinated deploys
 * with the auth surface.
 */

import { boolean, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

export const userPreferences = pgTable("user_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** 'compact' | 'default' | 'comfortable' — inbox row density. */
  inboxDensity: text("inbox_density"),
  /** 'right' | 'bottom' | 'none' — reading-pane position. */
  inboxReadingPane: text("inbox_reading_pane"),
  /** 'outlook' (3-pane, default) | 'gmail' (list + full-screen open). */
  inboxView: text("inbox_view"),
  /** 'light' | 'dark' -- theme, synced across devices (migration 0115). */
  themePref: text("theme_pref"),
  /** Per-campaign account-visibility scope from the AccountSwitcher.
   *  Shape: { "<campaign_id>": ["<connected_account_id>", ...] }
   *  Empty arrays + missing keys both mean "default to every account
   *  the operator can see." See migration 0061. */
  inboxAccountFilters: jsonb("inbox_account_filters")
    .$type<Record<string, string[]>>()
    .notNull()
    .default({}),
  /** Daily digest opt-in flag (Phase D.4). NULL = opted-in (the row
   *  may not exist for newly-onboarded users); FALSE = opted out;
   *  TRUE = explicitly opted in. Default TRUE on insert. */
  dailyDigestEnabled: boolean("daily_digest_enabled").default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserPreferences = typeof userPreferences.$inferSelect;
export type NewUserPreferences = typeof userPreferences.$inferInsert;
