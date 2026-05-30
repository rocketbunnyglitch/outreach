/**
 * Campaign ↔ connected_account assignment. See migration 0048.
 * Many-to-many; admin declares which inboxes are "for" each campaign.
 */

import { index, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { campaigns } from "./campaigns";
import { staffOutreachEmails, users } from "./users";

export const campaignConnectedAccounts = pgTable(
  "campaign_connected_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    connectedAccountId: uuid("connected_account_id")
      .notNull()
      .references(() => staffOutreachEmails.id, { onDelete: "cascade" }),
    assignedBy: uuid("assigned_by").references(() => users.id, { onDelete: "set null" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("campaign_connected_accounts_unique").on(
      t.campaignId,
      t.connectedAccountId,
    ),
    campaignIdx: index("campaign_connected_accounts_campaign_idx").on(t.campaignId),
    accountIdx: index("campaign_connected_accounts_account_idx").on(t.connectedAccountId),
  }),
);

export type CampaignConnectedAccount = typeof campaignConnectedAccounts.$inferSelect;
export type NewCampaignConnectedAccount = typeof campaignConnectedAccounts.$inferInsert;
