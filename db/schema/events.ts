/**
 * Event — a specific crawl night belonging to a CityCampaign.
 *
 * A CityCampaign typically has 1–4 events: Fri-1, Fri-2, Sat-1, Sat-2.
 * The slot_number field distinguishes multiple crawls on the same date
 * (e.g. two simultaneous Saturday crawls in different parts of the same
 * city). Each event has a required venue mix inherited from the
 * CityCampaign but overridable here.
 */

import { date, index, pgTable, smallint, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { archivedAt, auditColumns, idColumn, versionColumn } from "../types";
import { cityCampaigns } from "./city-campaigns";
import { eventStatus } from "./enums";

export const events = pgTable(
  "events",
  {
    ...idColumn,

    cityCampaignId: uuid("city_campaign_id")
      .notNull()
      .references(() => cityCampaigns.id, { onDelete: "cascade" }),

    eventDate: date("event_date").notNull(),

    // Distinguishes multiple crawls on the same date.
    // 1 = first crawl that night, 2 = second concurrent crawl, etc.
    slotNumber: smallint("slot_number").notNull().default(1),

    // The Eventbrite event this maps to. Populated when the listing is
    // created/linked. Used by the Eventbrite sync job to know where to
    // write the venue block.
    eventbriteEventId: text("eventbrite_event_id"),

    // Per-event venue mix requirements (default = city_campaign's targets).
    // These let an admin override for a special-shape event.
    requiredVenueCountTotal: smallint("required_venue_count_total").notNull().default(4),
    requiredWristbandCount: smallint("required_wristband_count").notNull().default(1),
    requiredFinalCount: smallint("required_final_count").notNull().default(1),
    requiredMiddleCount: smallint("required_middle_count").notNull().default(2),

    status: eventStatus("status").notNull().default("planned"),

    ...archivedAt,
    ...auditColumns,
    ...versionColumn,
  },
  (table) => ({
    cityCampaignDateSlotUnique: uniqueIndex("events_city_campaign_date_slot_unique").on(
      table.cityCampaignId,
      table.eventDate,
      table.slotNumber,
    ),
    cityCampaignIdx: index("events_city_campaign_idx").on(table.cityCampaignId),
    eventDateIdx: index("events_event_date_idx").on(table.eventDate),
    eventbriteIdIdx: index("events_eventbrite_id_idx").on(table.eventbriteEventId),
    statusIdx: index("events_status_idx").on(table.status),
  }),
);

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
