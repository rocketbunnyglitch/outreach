/**
 * Shared schema utilities: PostGIS geography custom type and audit column
 * helpers used across most tables.
 *
 * Drizzle has no native PostGIS support, so we declare `geographyPoint` via
 * `customType`. The serializer emits EWKT (`SRID=4326;POINT(lng lat)`), the
 * deserializer parses Postgres's text representation. For spatial queries
 * (ST_DWithin, ST_Distance) you use `sql` template literals; the custom type
 * handles the round-trip when you select the column directly.
 *
 * CLAUDE.md §6: every mutable table gets audit columns and a version column.
 * Use the helpers below to avoid drift.
 */

import { customType, integer, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * PostGIS geography(POINT, 4326). Stored as the SRID 4326 (WGS84) geography
 * type — accepts lat/lng, computes great-circle distances via ST_Distance.
 */
export const geographyPoint = customType<{
  data: { lat: number; lng: number };
  driverData: string;
}>({
  dataType() {
    return "geography(POINT, 4326)";
  },
  toDriver(value) {
    return `SRID=4326;POINT(${value.lng} ${value.lat})`;
  },
  fromDriver(value) {
    // Postgres returns geography(POINT, 4326) as little-endian EWKB hex by
    // default — that's what the driver gives us. Falls back to WKT if a
    // query uses ST_AsText(location).
    //
    // EWKB hex format for a 2D point with SRID:
    //   1 byte  byte order (01 = little-endian)
    //   4 bytes geometry type with SRID flag (0x20000001 = POINT+SRID)
    //   4 bytes SRID (e.g. 0xE6100000 = 4326 LE)
    //   8 bytes X (longitude) as float64 LE
    //   8 bytes Y (latitude) as float64 LE
    // Total 50 hex chars.
    if (/^[0-9A-Fa-f]{50}$/.test(value)) {
      const buf = Buffer.from(value, "hex");
      // Byte order: 0x00 big-endian, 0x01 little-endian. Postgres always
      // emits little-endian for geography by default.
      const lng = buf.readDoubleLE(9);
      const lat = buf.readDoubleLE(17);
      return { lng, lat };
    }
    const wktMatch = /POINT\(([-\d.]+)\s+([-\d.]+)\)/.exec(value);
    if (wktMatch?.[1] && wktMatch[2]) {
      return {
        lng: Number.parseFloat(wktMatch[1]),
        lat: Number.parseFloat(wktMatch[2]),
      };
    }
    throw new Error(`Could not parse PostGIS point: ${value}`);
  },
});

/**
 * Standard audit columns. Spread into every mutable table.
 *
 * Note: created_by and updated_by are nullable because:
 *   - Seed data and system-initiated rows may have no user context.
 *   - The audit_log table (populated by trigger) is the authoritative trail;
 *     these columns are a denormalized convenience for displaying "last
 *     edited by X" without a join.
 */
export const auditColumns = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by"),
  updatedBy: uuid("updated_by"),
};

/**
 * Soft-delete column. Spread into entities that should never be hard-deleted.
 * CLAUDE.md §6: "Never DELETE from a table with archived_at."
 */
export const archivedAt = {
  archivedAt: timestamp("archived_at", { withTimezone: true }),
};

/**
 * Optimistic locking column. Spread into actively-edited tables (venues,
 * venue_events, city_campaigns) where two staffers may collide on saves.
 * Increment on every UPDATE; reject mismatched versions in the app layer.
 */
export const versionColumn = {
  version: integer("version").notNull().default(0),
};

/**
 * UUID primary key. Spread into every table.
 * Uses the database default of `gen_random_uuid()` (pgcrypto, in core since
 * Postgres 13), so we don't depend on `uuid-ossp`.
 */
export const idColumn = {
  id: uuid("id").primaryKey().defaultRandom(),
};
