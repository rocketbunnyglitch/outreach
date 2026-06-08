/**
 * venue_enrichment_attempts -- one row per contact-enrichment attempt (success
 * OR fail), so operators see history and the bulk action can skip venues that
 * were already attempted (regardless of outcome) unless explicitly re-triggered.
 * See migration 0131_venue_contact_enrichment.sql.
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { venues } from "./venues";

export const venueEnrichmentAttempts = pgTable(
  "venue_enrichment_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    venueId: uuid("venue_id")
      .notNull()
      .references(() => venues.id, { onDelete: "cascade" }),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** Staff member who triggered. NULL for a future cron trigger. */
    triggeredByUserId: uuid("triggered_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** 'venue_detail_button' | 'cold_outreach_bulk' | 'manual_retrigger' | 'api'. */
    triggerSource: text("trigger_source").notNull(),
    /** 1 or 2; null if neither tier ran. */
    tierUsed: integer("tier_used"),
    /** Same vocabulary as venues.last_enrichment_status, plus 'in_progress'. */
    status: text("status").notNull(),
    emailsFound: integer("emails_found").notNull().default(0),
    instagramFound: boolean("instagram_found").notNull().default(false),
    facebookFound: boolean("facebook_found").notNull().default(false),
    /** URLs successfully fetched. */
    pagesFetched: jsonb("pages_fetched").$type<string[]>().notNull().default([]),
    /** URLs that returned errors. */
    pagesFailed: jsonb("pages_failed").$type<string[]>().notNull().default([]),
    costEstimateUsd: numeric("cost_estimate_usd", { precision: 10, scale: 6 })
      .notNull()
      .default("0"),
    durationMs: integer("duration_ms"),
    errorMessage: text("error_message"),
    notes: text("notes"),
  },
  (t) => ({
    venueIdx: index("idx_venue_enrichment_attempts_venue_id").on(t.venueId),
    attemptedAtIdx: index("idx_venue_enrichment_attempts_attempted_at").on(t.attemptedAt),
  }),
);

export type VenueEnrichmentAttempt = typeof venueEnrichmentAttempts.$inferSelect;
export type NewVenueEnrichmentAttempt = typeof venueEnrichmentAttempts.$inferInsert;
