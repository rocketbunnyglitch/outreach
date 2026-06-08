/**
 * teams — the top-level tenant scope for the auth layer.
 *
 * Added in migration 0040. Today the engine seeds exactly one team
 * ("BarCrawlConnect") and every user + connected_accounts row is
 * pinned to it. The layer exists so the inbox surface can filter
 * "all team inboxes" vs "mine" without hard-coding tenancy, and so
 * future multi-tenancy is not a schema migration away.
 *
 * The seeded id is hard-coded as 00000000-0000-0000-0000-000000000001
 * — every other table that adds a team_id column defaults to that
 * value so backfill is trivial.
 *
 * Minimal columns on purpose: a real second team would prompt
 * adding billing / settings / branding columns, but for the single-
 * tenant case those are noise.
 */

import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Global runtime kill-switch for warm open tracking (migration 0124).
     * Single-team app, so this team-level flag is effectively global. When
     * true, no new send injects an open pixel even if env-enabled -- lets an
     * admin pause INSTANTLY (no redeploy) if deliverability looks off.
     */
    openTrackingPaused: boolean("open_tracking_paused").notNull().default(false),
  },
  (table) => ({
    slugUnique: uniqueIndex("teams_slug_unique").on(table.slug),
  }),
);

/**
 * The single seeded team id from migration 0040. Imported by code
 * that needs to default a team_id without a DB roundtrip — e.g. the
 * OAuth callback that creates a connected_accounts row for a user
 * who hasn't picked a team explicitly (today: nobody has, because
 * there's only one).
 */
export const DEFAULT_TEAM_ID = "00000000-0000-0000-0000-000000000001";
