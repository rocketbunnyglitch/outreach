import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { events } from "./events";
import { users } from "./users";
import { venueEvents } from "./venue-events";

/**
 * Replacement push lifecycle (migration 0137, CRM plan B2).
 *
 * One row per emergency replacement push: an operator fires a batch of
 * review-required drafts at backup venues for one open (event, role)
 * slot. Status walks open -> filled (a venue confirmed into that slot;
 * the confirm path cancels unsent sibling drafts via
 * email_drafts.replacement_push_id) or closed (superseded by a re-push
 * / abandoned). The push row is what makes "first confirm closes the
 * playbook" possible — without it the sibling drafts were orphans.
 */
export const replacementPushes = pgTable(
  "replacement_pushes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    /** 'wristband' | 'middle' | 'final' | 'alt_final' */
    role: text("role").notNull(),
    slotPosition: integer("slot_position"),
    reason: text("reason").notNull(),
    /** 'open' | 'filled' | 'closed' */
    status: text("status").notNull().default("open"),
    draftsCreated: integer("drafts_created").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    filledByVenueEventId: uuid("filled_by_venue_event_id").references(() => venueEvents.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => ({
    openIdx: index("replacement_pushes_open_idx").on(t.eventId, t.role),
  }),
);
