/**
 * cold_outreach_entries — per-city-campaign cold pipeline tracker.
 *
 * One row per (city_campaign, venue). Status drives the cold outreach
 * table on the city sheet. ZeroBounce result for each venue's email is
 * read from the existing email_validations table at render time — no
 * column duplication here.
 */

import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { archivedAt, auditColumns, idColumn } from "../types";
import { cityCampaigns } from "./city-campaigns";
import { staffMembers } from "./staff";
import { venues } from "./venues";

export const coldOutreachStatus = pgEnum("cold_outreach_status", [
  "not_contacted",
  "email_sent",
  "follow_up_due",
  "called",
  "voicemail",
  "no_answer",
  "interested",
  "declined",
  "bad_email",
  "wrong_number",
  "do_not_contact",
]);

export const coldOutreachEntries = pgTable(
  "cold_outreach_entries",
  {
    ...idColumn,

    cityCampaignId: uuid("city_campaign_id")
      .notNull()
      .references(() => cityCampaigns.id, { onDelete: "cascade" }),
    venueId: uuid("venue_id")
      .notNull()
      .references(() => venues.id, { onDelete: "restrict" }),

    status: coldOutreachStatus("status").notNull().default("not_contacted"),

    assignedStaffId: uuid("assigned_staff_id").references(() => staffMembers.id, {
      onDelete: "set null",
    }),

    remarks: text("remarks"),

    lastTouchAt: timestamp("last_touch_at", { withTimezone: true }),

    ...archivedAt,
    ...auditColumns,
  },
  (table) => ({
    ccVenueUnique: uniqueIndex("cold_outreach_entries_cc_venue_unique").on(
      table.cityCampaignId,
      table.venueId,
    ),
    statusIdx: index("cold_outreach_entries_status_idx").on(table.cityCampaignId, table.status),
    assignedIdx: index("cold_outreach_entries_assigned_idx").on(table.assignedStaffId),
  }),
);

export type ColdOutreachEntry = typeof coldOutreachEntries.$inferSelect;
export type NewColdOutreachEntry = typeof coldOutreachEntries.$inferInsert;
