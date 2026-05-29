/**
 * staff_views — per-staff saved filter/sort presets for any table surface.
 *
 * Used by the saved-views picker on cold outreach, all crawls, etc. The
 * params field stores a JSON object of URL search params that the app
 * applies to reconstruct the view. Surface key + optional context_id
 * scope a view to where it applies.
 *
 * Spec §11.x saved views (Sheets-parity gap #6).
 */

import { index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { staffMembers } from "./users";

export const staffViews = pgTable(
  "staff_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staffMembers.id, { onDelete: "cascade" }),

    /** Surface key — 'cold_outreach', 'all_crawls', etc. */
    surface: text("surface").notNull(),

    /** Optional context scoping — e.g. city_campaign_id for cold outreach
        views, so 'My Toronto pipeline' doesn't appear under Montreal. */
    contextId: uuid("context_id"),

    name: text("name").notNull(),

    /** JSON object of URL search params, e.g.
        { sort: 'status', dir: 'desc', status: 'email_sent' }. */
    params: jsonb("params")
      .notNull()
      .$type<Record<string, string>>()
      .default({} as Record<string, string>),

    sortOrder: integer("sort_order").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueName: unique("staff_views_unique_name").on(
      table.staffId,
      table.surface,
      table.contextId,
      table.name,
    ),
    lookupIdx: index("staff_views_lookup_idx").on(
      table.staffId,
      table.surface,
      table.contextId,
      table.sortOrder,
      table.name,
    ),
  }),
);

export type StaffView = typeof staffViews.$inferSelect;
