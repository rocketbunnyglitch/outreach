/**
 * venue_events — the junction representing "this venue, working this event,
 * in this role, with this status and these specifics."
 *
 * Heart of the operational workflow. Status transitions through
 * lead → contacted → interested → negotiating → confirmed → declined/cancelled.
 *
 * The five confirmation-cadence timestamps record when each automatic action
 * was completed. NULL means not yet done. Populating these is what the
 * confirmation cascade (Phase 7) does on status → confirmed.
 */

import { index, pgTable, text, time, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { auditColumns, idColumn, versionColumn } from "../types";
import { venueEventStatus, venueRole } from "./enums";
import { events } from "./events";
import { staffMembers } from "./staff";
import { venues } from "./venues";

export const venueEvents = pgTable(
  "venue_events",
  {
    ...idColumn,

    venueId: uuid("venue_id")
      .notNull()
      .references(() => venues.id, { onDelete: "restrict" }),

    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),

    role: venueRole("role").notNull(),
    status: venueEventStatus("status").notNull().default("lead"),

    // The slot times the venue agreed to. Stored as time-of-day in the
    // city's local TZ (resolved via cities.timezone). NULL until agreed.
    slotStartTime: time("slot_start_time"),
    slotEndTime: time("slot_end_time"),

    // Free-text version of agreed hours for cases where slot_start/end
    // don't capture nuance ("9 PM but they may open earlier if busy").
    agreedHoursText: text("agreed_hours_text"),

    drinkSpecials: text("drink_specials"),

    // Who from the venue we work with on the night
    nightOfContactName: text("night_of_contact_name"),
    nightOfContactPhoneE164: text("night_of_contact_phone_e164"),

    // Our point of contact for this booking. Usually = the assigning staffer.
    ourContactStaffId: uuid("our_contact_staff_id").references(() => staffMembers.id),
    // Override if the staff member wants to give a different number for
    // night-of (e.g. personal cell vs Quo line).
    ourContactOverridePhoneE164: text("our_contact_override_phone_e164"),

    // Cadence checkpoints (Phase 7 automation populates these on success)
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    twoWeekEmailSentAt: timestamp("two_week_email_sent_at", { withTimezone: true }),
    oneWeekEmailSentAt: timestamp("one_week_email_sent_at", { withTimezone: true }),
    threeDayCallCompletedAt: timestamp("three_day_call_completed_at", {
      withTimezone: true,
    }),
    floorStaffCallCompletedAt: timestamp("floor_staff_call_completed_at", {
      withTimezone: true,
    }),

    ...auditColumns,
    ...versionColumn,
  },
  (table) => ({
    venueEventUnique: uniqueIndex("venue_events_venue_event_unique").on(
      table.venueId,
      table.eventId,
    ),
    eventIdIdx: index("venue_events_event_id_idx").on(table.eventId),
    venueIdIdx: index("venue_events_venue_id_idx").on(table.venueId),
    statusIdx: index("venue_events_status_idx").on(table.status),
    ourContactIdx: index("venue_events_our_contact_idx").on(table.ourContactStaffId),
    roleStatusIdx: index("venue_events_role_status_idx").on(table.role, table.status),
  }),
);

export type VenueEvent = typeof venueEvents.$inferSelect;
export type NewVenueEvent = typeof venueEvents.$inferInsert;
