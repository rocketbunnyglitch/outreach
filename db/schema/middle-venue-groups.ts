/**
 * Middle Venue Groups — a collection of venues that share the "middle"
 * role across multiple crawls within the same city_campaign.
 *
 * Motivating example: International Halloween 2026 in Toronto has 3
 * Friday Night crawls (Fri #1, Fri #2, Fri #3). The wristband + final
 * venues are unique per crawl, but the 4-6 middle bars in the middle of
 * the route are shared across all three. Modeling this with direct
 * venue_events (role='middle') would force 3× duplicate rows for every
 * middle venue, causing fan-out problems on updates and miscounts on
 * dashboards.
 *
 * The Halloween model:
 *   * Create a middle_venue_group ("Friday Middle Group A") attached to
 *     a city_campaign
 *   * Add venues to it via middle_venue_group_members
 *   * Set events.middle_venue_group_id on each Fri #1, #2, #3 event
 *
 * Events that DON'T set middle_venue_group_id fall back to the legacy
 * model: direct venue_events with role='middle'. Both patterns coexist.
 */

import { index, pgTable, text, time, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { archivedAt, auditColumns, idColumn, versionColumn } from "../types";
import { cityCampaigns } from "./city-campaigns";
import { dayPart } from "./enums";
import { venues } from "./venues";

export const middleVenueGroups = pgTable(
  "middle_venue_groups",
  {
    ...idColumn,

    cityCampaignId: uuid("city_campaign_id")
      .notNull()
      .references(() => cityCampaigns.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    // e.g. "Friday Middle Group A"

    dayPart: dayPart("day_part"),
    // Which daypart this group is meant for. Optional — a group could be
    // reused across dayparts.

    // Free-text status for now (planning | active | confirmed | cancelled).
    // Enum-ify in a future migration if usage stabilizes.
    status: text("status").notNull().default("planning"),

    notes: text("notes"),

    ...archivedAt,
    ...auditColumns,
    ...versionColumn,
  },
  (table) => ({
    cityCampaignIdx: index("middle_venue_groups_cc_idx").on(table.cityCampaignId),
    dayPartIdx: index("middle_venue_groups_daypart_idx").on(table.dayPart),
  }),
);

export type MiddleVenueGroup = typeof middleVenueGroups.$inferSelect;
export type NewMiddleVenueGroup = typeof middleVenueGroups.$inferInsert;

/**
 * middle_venue_group_members — venue × group with the same per-row state
 * a venue_event would have (status, slot times, drink specials).
 */
export const middleVenueGroupMembers = pgTable(
  "middle_venue_group_members",
  {
    ...idColumn,

    middleVenueGroupId: uuid("middle_venue_group_id")
      .notNull()
      .references(() => middleVenueGroups.id, { onDelete: "cascade" }),
    venueId: uuid("venue_id")
      .notNull()
      .references(() => venues.id, { onDelete: "restrict" }),

    // Kept as text intentionally — we don't want this to silently follow
    // changes to venue_event_status. If we want to unify later, that's a
    // deliberate refactor.
    status: text("status").notNull().default("lead"),

    slotStartTime: time("slot_start_time"),
    slotEndTime: time("slot_end_time"),
    agreedHoursText: text("agreed_hours_text"),
    drinkSpecials: text("drink_specials"),
    notes: text("notes"),

    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),

    ...auditColumns,
    ...versionColumn,
  },
  (table) => ({
    groupVenueUnique: uniqueIndex("middle_venue_group_members_group_venue_unique").on(
      table.middleVenueGroupId,
      table.venueId,
    ),
    groupIdx: index("middle_venue_group_members_group_idx").on(table.middleVenueGroupId),
    venueIdx: index("middle_venue_group_members_venue_idx").on(table.venueId),
  }),
);

export type MiddleVenueGroupMember = typeof middleVenueGroupMembers.$inferSelect;
export type NewMiddleVenueGroupMember = typeof middleVenueGroupMembers.$inferInsert;
