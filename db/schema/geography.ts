/**
 * Geographic reference data.
 *
 * Countries: ISO 3166-1 alpha-2 codes. Static-ish reference table. We
 * pre-seed the ones we operate in (CA, US, GB) and let admins add more.
 *
 * Cities: permanent records across all campaigns and brands. London ON
 * and London UK are distinct rows. Has a PostGIS geography(POINT) for
 * the city center, used by the lead-cluster builder (Phase 5).
 */

import { index, pgTable, primaryKey, text, uniqueIndex } from "drizzle-orm/pg-core";
import { archivedAt, auditColumns, geographyPoint, idColumn, versionColumn } from "../types";

// =========================================================================
// countries
// =========================================================================

export const countries = pgTable(
  "countries",
  {
    // ISO 3166-1 alpha-2 (CA, US, GB, etc.). Primary key.
    code: text("code").notNull(),
    name: text("name").notNull(),
    // Default currency hint (ISO 4217). Used only as a suggestion when
    // creating FinancialLines; the line's own currency is authoritative.
    defaultCurrency: text("default_currency"),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.code] }),
  }),
);

// =========================================================================
// cities
// =========================================================================

export const cities = pgTable(
  "cities",
  {
    ...idColumn,

    countryCode: text("country_code")
      .notNull()
      .references(() => countries.code, { onDelete: "restrict" }),

    name: text("name").notNull(),
    region: text("region"), // "Ontario", "California", "England"

    // IANA tz database id (e.g. "America/Toronto"). Used per DECISIONS.md#012
    // for city-specific display contexts.
    timezone: text("timezone").notNull(),

    // City center for distance queries. SRID 4326.
    location: geographyPoint("location"),

    ...archivedAt,
    ...auditColumns,
    ...versionColumn,
  },
  (table) => ({
    // London ON ≠ London UK. Disambiguate by (country, region, name).
    countryRegionNameUnique: uniqueIndex("cities_country_region_name_unique").on(
      table.countryCode,
      table.region,
      table.name,
    ),
    countryNameIdx: index("cities_country_name_idx").on(table.countryCode, table.name),
    // Spatial index is added in migrations/0000_setup.sql via raw SQL since
    // Drizzle doesn't generate GiST indexes for custom types.
  }),
);

// =========================================================================
// Inferred types
// =========================================================================

export type Country = typeof countries.$inferSelect;
export type NewCountry = typeof countries.$inferInsert;
export type City = typeof cities.$inferSelect;
export type NewCity = typeof cities.$inferInsert;
