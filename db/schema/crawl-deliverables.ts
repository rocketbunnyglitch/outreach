/**
 * Crawl deliverables — operational checklist for each venue_event
 * before the crawl runs. Migration 0075.
 *
 * One row per (venue_event, deliverable_type). Common deliverable
 * types live in the crawlDeliverableType enum:
 *
 *   social_media_graphics  designed + posted
 *   staff_sheet            assembled + distributed
 *   participant_poster     designed + printed + delivered
 *   wristbands             tracked separately in the wristbands
 *                          table; the row here is just a checkbox
 *                          to acknowledge handoff
 *   week_of_confirmation   confirmed within 7 days of crawl date
 *
 * Status is one of pending | done | n_a. The 'n_a' value covers
 * "this deliverable doesn't apply here" (e.g. a non-wristband
 * venue's wristbands row).
 *
 * UI surfaces this on the new /crawl-management page as a tree:
 * city -> venues -> deliverable columns.
 */

import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { auditColumns, idColumn } from "../types";
import { crawlDeliverableStatus, crawlDeliverableType } from "./enums";
import { staffMembers } from "./users";
import { venueEvents } from "./venue-events";

export const crawlDeliverables = pgTable(
  "crawl_deliverables",
  {
    ...idColumn,

    venueEventId: uuid("venue_event_id")
      .notNull()
      .references(() => venueEvents.id, { onDelete: "cascade" }),

    deliverableType: crawlDeliverableType("deliverable_type").notNull(),

    status: crawlDeliverableStatus("status").notNull().default("pending"),

    /** Free-text note ("delivered via Slack to manager Mike on Mar
     *  12"). Helpful for retros. */
    notes: text("notes"),

    /** Currently-on-the-hook operator. NULL = unassigned. */
    assignedStaffId: uuid("assigned_staff_id").references(() => staffMembers.id, {
      onDelete: "set null",
    }),

    ...auditColumns,
  },
  (t) => ({
    unique: uniqueIndex("crawl_deliverables_unique").on(t.venueEventId, t.deliverableType),
    assignedIdx: index("crawl_deliverables_assigned_idx").on(t.assignedStaffId, t.status),
  }),
);

export type CrawlDeliverable = typeof crawlDeliverables.$inferSelect;
export type CrawlDeliverableType = (typeof crawlDeliverableType.enumValues)[number];
export type CrawlDeliverableStatus = (typeof crawlDeliverableStatus.enumValues)[number];
