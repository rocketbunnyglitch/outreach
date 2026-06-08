/**
 * Snippets / text-expander (Tier-2). Team-scoped reusable body fragments the
 * composer inserts when an operator types a trigger token after ";". The body
 * may contain {{merge_fields}}, rendered through the composer's merge context
 * on insert. See migration 0126_snippets.sql.
 *
 * The real uniqueness (one active trigger per team, case-insensitive) is a
 * partial + lower() index that drizzle-kit can't express -- it lives in the
 * migration. The index declared here is just a plain lookup helper.
 */

import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { teams } from "./teams";
import { users } from "./users";

export const snippets = pgTable(
  "snippets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    /** Trigger token, stored WITHOUT the leading ";" (e.g. "intro"). */
    trigger: text("trigger").notNull(),
    /** Short human label for the admin list + composer popover. */
    label: text("label").notNull(),
    /** Body fragment. May contain {{merge_fields}} -- rendered on insert. */
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => ({
    teamIdx: index("snippets_team_idx").on(t.teamId),
  }),
);

export type Snippet = typeof snippets.$inferSelect;
export type NewSnippet = typeof snippets.$inferInsert;
