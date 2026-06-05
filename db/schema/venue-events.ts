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

import {
  boolean,
  index,
  integer,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { auditColumns, idColumn, versionColumn } from "../types";
import { venueEventStatus, venueRole } from "./enums";
import { events } from "./events";
import { staffMembers } from "./users";
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

    /**
     * Position WITHIN a (event, role) group, 1-indexed.
     *   - role=wristband:  always 1 (single slot per crawl)
     *   - role=middle:     1, 2, 3, … (Middle 1, Middle 2, etc.)
     *   - role=final:      always 1 (single slot per crawl)
     *   - role=alt_final:  1, 2, 3, … (backup finals; ordered)
     *
     * Enforced unique on (event_id, role, slot_position) where not null.
     * Used by the city sheet to render slot rows in deterministic order.
     */
    slotPosition: smallint("slot_position"),

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

    // Cancellation tracking (Phase 4.1). status='cancelled' + when/why/who.
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancellationReason: text("cancellation_reason"),
    cancelledBy: uuid("cancelled_by").references(() => staffMembers.id, { onDelete: "set null" }),

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
    // V2 floor-staff call attempt history (Phase 3.13, migration 0114). The
    // completed-at above is the "briefed" marker; these track the attempts.
    floorStaffCallAttempts: integer("floor_staff_call_attempts").notNull().default(0),
    floorStaffLastCallAt: timestamp("floor_staff_last_call_at", { withTimezone: true }),
    floorStaffLastCallOutcome: text("floor_staff_last_call_outcome"),

    /** Temporary in-crawl disable (migration 0108). When a confirmed MIDDLE
     *  venue backs out last-minute, an operator flips this so the slot reopens
     *  in outreach lists without losing the booking; Restore flips it back
     *  (e.g. the owner steps in). Middle role only -- wristband/final get fully
     *  replaced instead. */
    temporarilyDisabled: boolean("temporarily_disabled").notNull().default(false),
    temporarilyDisabledAt: timestamp("temporarily_disabled_at", { withTimezone: true }),
    temporarilyDisabledBy: uuid("temporarily_disabled_by").references(() => staffMembers.id, {
      onDelete: "set null",
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
