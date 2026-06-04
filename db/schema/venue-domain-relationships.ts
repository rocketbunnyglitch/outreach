/**
 * Venue x outreach-brand relationship flag (Phase 3.8).
 *
 * Tracks the relationship history between a venue and an outreach brand so the
 * engine (and operators) know whether a brand is welcome at a venue. One row
 * per (venue, brand). status: good | neutral | bad | no_history. set_by records
 * the source -- manual operator, auto from an inbound classification, or a
 * post-event flag. auto_clear_at time-boxes 'bad' flags (Reference Doc 3.3 --
 * bad relationships decay after ~1 year).
 *
 * Downstream phases read this table: 3.9 auto-detects from inbound, 3.10
 * hard-blocks sends for 'bad' pairs, 3.11 decays bad flags via cron.
 *
 * NOTE: set_by_staff_id references users(id) -- the app's staffMembers export
 * is a Drizzle alias of the users table; there is no separate staff_members
 * table. See migration 0105. [ReferenceDoc 3.3]
 */

import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { outreachBrands } from "./brands";
import { staffMembers } from "./users";
import { venues } from "./venues";

export const RELATIONSHIP_STATUSES = ["good", "neutral", "bad", "no_history"] as const;
export type RelationshipStatus = (typeof RELATIONSHIP_STATUSES)[number];

export const RELATIONSHIP_SET_BY = ["auto_inbound", "manual_operator", "post_event_flag"] as const;
export type RelationshipSetBy = (typeof RELATIONSHIP_SET_BY)[number];

export const venueDomainRelationships = pgTable(
  "venue_domain_relationships",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Owning venue. Cascade so flags vanish with the venue.
    venueId: uuid("venue_id")
      .notNull()
      .references(() => venues.id, { onDelete: "cascade" }),

    // The outreach brand this relationship is scoped to.
    outreachBrandId: uuid("outreach_brand_id")
      .notNull()
      .references(() => outreachBrands.id, { onDelete: "cascade" }),

    status: text("status").$type<RelationshipStatus>().notNull(),

    setBy: text("set_by").$type<RelationshipSetBy>().notNull(),

    // Who set it (when manual). Nullable for auto/system writes. References
    // users(id) -- staffMembers is an alias of users.
    setByStaffId: uuid("set_by_staff_id").references(() => staffMembers.id),

    notes: text("notes"),

    setAt: timestamp("set_at", { withTimezone: true }).notNull().defaultNow(),

    // When a 'bad' flag should auto-clear (Phase 3.11 cron). Null = no decay.
    autoClearAt: timestamp("auto_clear_at", { withTimezone: true }),
  },
  (table) => ({
    venueBrandUnique: uniqueIndex("venue_domain_relationships_venue_brand_unique").on(
      table.venueId,
      table.outreachBrandId,
    ),
    venueIdx: index("vdr_venue_idx").on(table.venueId),
    statusIdx: index("vdr_status_idx").on(table.status),
  }),
);

export type VenueDomainRelationship = typeof venueDomainRelationships.$inferSelect;
export type NewVenueDomainRelationship = typeof venueDomainRelationships.$inferInsert;
