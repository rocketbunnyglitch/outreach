/**
 * Venue — the permanent CRM record. Persists across all campaigns and
 * brands. Includes a PostGIS point for the cluster-builder (Phase 5).
 *
 * Spec §5.2 venues table.
 *
 * Note on the do_not_contact pair: when set, it blocks outreach to this
 * venue. The expiry date allows certain reasons (e.g. "declined this
 * year, ok next year") to auto-clear.
 */

import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { archivedAt, auditColumns, geographyPoint, idColumn, versionColumn } from "../types";
import { cities } from "./geography";

export const venues = pgTable(
  "venues",
  {
    ...idColumn,

    cityId: uuid("city_id")
      .notNull()
      .references(() => cities.id, { onDelete: "restrict" }),

    name: text("name").notNull(),

    // Google Places identifier — primary dedup key. Null for venues entered
    // manually before being matched to a place.
    googlePlaceId: text("google_place_id"),

    address: text("address"),
    location: geographyPoint("location"),

    // Contact channels
    phoneE164: text("phone_e164"),
    email: text("email"),
    alternateEmails: text("alternate_emails").array().notNull().default([]),
    websiteUrl: text("website_url"),
    instagramHandle: text("instagram_handle"),

    // Venue facts
    capacity: integer("capacity"),
    venueType: text("venue_type").array().notNull().default([]), // ["bar", "club", "restaurant", "lounge"]
    servesAlcohol: boolean("serves_alcohol").notNull().default(true),

    // Internal CRM notes — visible to all staff across brands. Persistent.
    internalNotes: text("internal_notes").notNull().default(""),

    // Blocklist
    doNotContact: boolean("do_not_contact").notNull().default(false),
    doNotContactReason: text("do_not_contact_reason"),
    doNotContactExpiresAt: date("do_not_contact_expires_at"),

    ...archivedAt,
    ...auditColumns,
    ...versionColumn,
  },
  (table) => ({
    googlePlaceIdUnique: uniqueIndex("venues_google_place_id_unique").on(table.googlePlaceId),
    cityIdIdx: index("venues_city_id_idx").on(table.cityId),
    cityNameIdx: index("venues_city_name_idx").on(table.cityId, table.name),
    doNotContactIdx: index("venues_do_not_contact_idx").on(table.doNotContact),
    // GiST spatial index on location is added in migrations/0000_setup.sql.
  }),
);

export type Venue = typeof venues.$inferSelect;
export type NewVenue = typeof venues.$inferInsert;
