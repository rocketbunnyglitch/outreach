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

import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

export const userPreferences = pgTable("user_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** 'compact' | 'default' | 'comfortable' — inbox row density. */
  inboxDensity: text("inbox_density"),
  /** 'right' | 'bottom' | 'none' — reading-pane position. */
  inboxReadingPane: text("inbox_reading_pane"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserPreferences = typeof userPreferences.$inferSelect;
export type NewUserPreferences = typeof userPreferences.$inferInsert;
