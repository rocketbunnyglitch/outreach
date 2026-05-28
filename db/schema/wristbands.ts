/**
 * Wristbands — shipping tracking for wristband-role venue_events.
 *
 * Auto-created when a venue_event with role='wristband' flips to confirmed.
 * Missing shipping_address auto-creates a task. See spec §6.10.
 */

import {
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { auditColumns, idColumn, versionColumn } from "../types";
import { wristbandStatus } from "./enums";
import { venueEvents } from "./venue-events";

export const wristbands = pgTable(
  "wristbands",
  {
    ...idColumn,

    venueEventId: uuid("venue_event_id")
      .notNull()
      .references(() => venueEvents.id, { onDelete: "cascade" }),

    quantity: integer("quantity").notNull().default(0),
    status: wristbandStatus("status").notNull().default("pending"),

    /** Recipient name for the mailing label (session-12 P3). */
    recipientName: text("recipient_name"),
    /** Recipient phone (courier contact). */
    recipientPhone: text("recipient_phone"),

    shippingAddress: text("shipping_address"),
    carrier: text("carrier"), // "USPS", "Canada Post", "UPS", etc.
    trackingNumber: text("tracking_number"),

    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    expectedDeliveryDate: date("expected_delivery_date"),

    notes: text("notes"),

    ...auditColumns,
    ...versionColumn,
  },
  (table) => ({
    venueEventUnique: uniqueIndex("wristbands_venue_event_unique").on(table.venueEventId),
    statusIdx: index("wristbands_status_idx").on(table.status),
    trackingNumberIdx: index("wristbands_tracking_idx").on(table.trackingNumber),
  }),
);

export type Wristband = typeof wristbands.$inferSelect;
export type NewWristband = typeof wristbands.$inferInsert;
