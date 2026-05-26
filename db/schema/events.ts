/**
 * Event — a specific crawl night belonging to a CityCampaign.
 *
 * A CityCampaign typically has 1–4 events: Fri-1, Fri-2, Sat-1, Sat-2.
 * The slot_number field distinguishes multiple crawls on the same date
 * (e.g. two simultaneous Saturday crawls in different parts of the same
 * city). Each event has a required venue mix inherited from the
 * CityCampaign but overridable here.
 *
 * Phase 8b (Halloween) added richer semantics:
 *   - day_part: thursday_night | friday_night | saturday_day | saturday_night | ...
 *   - crawl_number: 1, 2, 3 within a daypart ("Fri Night #2")
 *   - ticket_sales_count: separate from revenue, the operational primary
 *   - starts_at / ends_at: actual datetimes (vs. just date)
 *   - route_label: free-text label ("Downtown West", "King West loop")
 *   - eventbrite_url: operator-pasteable link
 *   - middle_venue_group_id: when set, the event inherits middle venues
 *     from a shared group (multiple events can reference one group). When
 *     null, falls back to direct venue_events with role='middle'.
 */

import {
  date,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { archivedAt, auditColumns, idColumn, versionColumn } from "../types";
import { cityCampaigns } from "./city-campaigns";
import { dayPart, eventStatus } from "./enums";
import { middleVenueGroups } from "./middle-venue-groups";

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
    eventbriteUrl: text("eventbrite_url"),

    // Phase 8b — Halloween-aware fields
    dayPart: dayPart("day_part"),
    crawlNumber: smallint("crawl_number"),
    ticketSalesCount: integer("ticket_sales_count").notNull().default(0),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    routeLabel: text("route_label"),
    middleVenueGroupId: uuid("middle_venue_group_id").references(() => middleVenueGroups.id, {
      onDelete: "set null",
    }),

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
    middleGroupIdx: index("events_middle_group_idx").on(table.middleVenueGroupId),
    ticketSalesIdx: index("events_ticket_sales_idx").on(table.ticketSalesCount),
  }),
);

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
