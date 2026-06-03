/**
 * Campaign ↔ connected_account assignment. See migration 0048.
 * Many-to-many; admin declares which inboxes are "for" each campaign.
 */

import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { outreachBrands } from "./brands";
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
    /** Brand this email presents for this campaign, driving the
     *  {{company_name}} merge field. NULL falls back to the template's
     *  outreach brand. See migration 0095. */
    outreachBrandId: uuid("outreach_brand_id").references(() => outreachBrands.id, {
      onDelete: "set null",
    }),
    /** Sender persona for this email + campaign (e.g. "Dan", "Chris"). Drives
     *  the {{your_name}} merge field AND the From display name on send, so the
     *  recipient sees the persona instead of the logged-in user. NULL falls
     *  back to the sending user's display name. See migration 0100. */
    aliasName: text("alias_name"),
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
