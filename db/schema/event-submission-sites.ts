/**
 * Event submission sites — per-city listing/event sites we post crawls
 * to (e.g. Eventbrite, local "things to do" calendars, university event
 * boards). Operator session-12 P3: "event-submission tab — cities with
 * the sites to submit each event to, plus the ability to add sites."
 *
 * Each row is one site for one city. Lightweight: a name, a URL, an
 * optional note (login/account, cadence), and a submitted flag/date so
 * the team can track what's been posted this cycle.
 */

import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { archivedAt, auditColumns, idColumn } from "../types";
import { cities } from "./geography";

export const eventSubmissionSites = pgTable("event_submission_sites", {
  ...idColumn,

  cityId: uuid("city_id")
    .notNull()
    .references(() => cities.id, { onDelete: "cascade" }),

  /** Display name of the site, e.g. "Eventbrite", "DoNYC". */
  name: text("name").notNull(),

  /** Submission URL or homepage. */
  url: text("url"),

  /** Login/account, cadence, or any submission gotchas. */
  notes: text("notes"),

  /** Whether we've submitted the current cycle's events here. */
  submitted: boolean("submitted").notNull().default(false),
  /** When `submitted` was last flipped on. */
  submittedAt: timestamp("submitted_at", { withTimezone: true }),

  ...auditColumns,
  ...archivedAt,
});

export type EventSubmissionSite = typeof eventSubmissionSites.$inferSelect;
export type NewEventSubmissionSite = typeof eventSubmissionSites.$inferInsert;
