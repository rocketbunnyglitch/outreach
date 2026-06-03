/**
 * venue_campaign_touch_log - every outbound touch the engine sends to a venue
 * for a campaign (Phase 1.7). The cadence engine writes one row per send so the
 * anti-spam floor can be enforced across aliases AND domains: before a touch
 * goes out, the engine checks recent rows for this venue x campaign (and venue
 * x outreach brand) to honor the minimum gap. See migration 0094.
 *
 * staff_outreach_email_id references connected_accounts (the table formerly
 * named staff_outreach_emails, renamed in migration 0042; the codebase alias is
 * db/schema/users.ts: staffOutreachEmails = connectedAccounts).
 *
 * Append-only log: no audit/version columns, mirroring the migration's table.
 * [ReferenceDoc Section 6]
 */

import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { outreachBrands } from "./brands";
import { campaigns } from "./campaigns";
import { emailMessages } from "./email-messages";
import { connectedAccounts } from "./users";
import { venues } from "./venues";

export const venueCampaignTouchLog = pgTable(
  "venue_campaign_touch_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    venueId: uuid("venue_id")
      .notNull()
      .references(() => venues.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    staffOutreachEmailId: uuid("staff_outreach_email_id")
      .notNull()
      .references(() => connectedAccounts.id),
    outreachBrandId: uuid("outreach_brand_id")
      .notNull()
      .references(() => outreachBrands.id),
    /** Free-text kind of touch: "cold_touch_1", "warm_nudge_2", etc. Kept text
     *  (not an enum) so the cadence engine can label touches without a schema
     *  migration per new touch type. */
    touchKind: text("touch_kind").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    emailMessageId: uuid("email_message_id").references(() => emailMessages.id, {
      onDelete: "set null",
    }),
  },
  (table) => ({
    venueCampaignIdx: index("vctl_venue_campaign_idx").on(
      table.venueId,
      table.campaignId,
      table.sentAt,
    ),
    brandRecentIdx: index("vctl_brand_recent_idx").on(
      table.venueId,
      table.outreachBrandId,
      table.sentAt,
    ),
  }),
);

export type VenueCampaignTouch = typeof venueCampaignTouchLog.$inferSelect;
export type NewVenueCampaignTouch = typeof venueCampaignTouchLog.$inferInsert;
