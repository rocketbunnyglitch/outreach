import { bigserial, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { events } from "./events";
import { venueEvents } from "./venue-events";
import { venues } from "./venues";

/**
 * Durable lineup change log (migration 0136, CRM plan B1).
 *
 * Append-only: one row per lineup mutation (confirm, cancel, add/remove
 * venue, slot/time edit). `seq` is the strictly-increasing poll cursor —
 * external consumers (Smart Map, Eventbrite venue-block pusher) read
 * forward from their last seen seq via GET /api/engine/lineup/changes,
 * so a restart never loses events (unlike the in-memory ring buffer in
 * lib/lineup-events.ts, which is now just a same-process optimization).
 *
 * `publicPayload` holds ONLY public-safe lineup facts — writes must go
 * through sanitizeLineupPayload (lib/lineup-change-core.ts). Never
 * notes, contact info, DNC reasons, or financials (never-do #6).
 */
export const lineupChangeEvents = pgTable(
  "lineup_change_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seq: bigserial("seq", { mode: "number" }).notNull(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    venueEventId: uuid("venue_event_id").references(() => venueEvents.id, {
      onDelete: "set null",
    }),
    venueId: uuid("venue_id").references(() => venues.id, { onDelete: "set null" }),
    /** 'confirmed' | 'swapped' | 'cancelled' | 'slot_changed'
     *  | 'times_changed' | 'venue_added' | 'venue_removed' */
    changeType: text("change_type").notNull(),
    publicPayload: jsonb("public_payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    eventSeqIdx: index("lineup_change_events_event_seq_idx").on(t.eventId, t.seq),
  }),
);
