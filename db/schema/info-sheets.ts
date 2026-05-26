/**
 * staff_info_sheets — per-VenueEvent digital sheet with a unique URL.
 *
 * Replaces the PDF that venues never share with floor staff (spec §6.9).
 * URL is embedded as a QR on the participant poster; also exposed in the
 * public JSON API per DECISIONS.md#005.
 *
 * view_count and timestamps track adoption. Phase 8 admin dashboard
 * surfaces aggregate view rate per campaign.
 */

import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { auditColumns, idColumn, versionColumn } from "../types";
import { venueEvents } from "./venue-events";

export const staffInfoSheets = pgTable(
  "staff_info_sheets",
  {
    ...idColumn,

    venueEventId: uuid("venue_event_id")
      .notNull()
      .references(() => venueEvents.id, { onDelete: "cascade" }),

    // The URL slug (e.g. "frightcrawl-2026-fox-and-hound-3F9aP").
    // Long-ish + random suffix to make URLs hard to guess.
    slug: text("slug").notNull(),

    // Analytics
    viewCount: integer("view_count").notNull().default(0),
    firstViewedAt: timestamp("first_viewed_at", { withTimezone: true }),
    lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),

    // Optional override text content. NULL means the sheet uses the
    // brand's template and merges venue_event data at render time.
    customBodyText: text("custom_body_text"),

    ...auditColumns,
    ...versionColumn,
  },
  (table) => ({
    slugUnique: uniqueIndex("staff_info_sheets_slug_unique").on(table.slug),
    venueEventUnique: uniqueIndex("staff_info_sheets_venue_event_unique").on(table.venueEventId),
    viewCountIdx: index("staff_info_sheets_view_count_idx").on(table.viewCount),
  }),
);

export type StaffInfoSheet = typeof staffInfoSheets.$inferSelect;
export type NewStaffInfoSheet = typeof staffInfoSheets.$inferInsert;
