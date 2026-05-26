/**
 * financial_lines — per-line revenue, costs, fees.
 *
 * Per DECISIONS.md#013: currency is plain text (CAD, USD, GBP). No FX
 * conversion in v1; aggregations are per-currency.
 *
 * Lines can be scoped to:
 *   - crawl_brand alone (brand-wide costs like brand-asset commission)
 *   - outreach_brand alone (Postmark monthly fees)
 *   - campaign (Eventbrite payouts for the campaign)
 *   - city_campaign (city-specific revenue or marketing spend)
 *
 * The FK columns are all nullable; the line "type" + the populated FKs
 * determine the rollup. App enforces sensible combinations.
 */

import { bigint, date, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { auditColumns, idColumn, versionColumn } from "../types";
import { crawlBrands, outreachBrands } from "./brands";
import { campaigns } from "./campaigns";
import { cityCampaigns } from "./city-campaigns";
import { financialLineType } from "./enums";

export const financialLines = pgTable(
  "financial_lines",
  {
    ...idColumn,

    // Brand context — at least one of these will be populated.
    outreachBrandId: uuid("outreach_brand_id").references(() => outreachBrands.id, {
      onDelete: "restrict",
    }),
    crawlBrandId: uuid("crawl_brand_id").references(() => crawlBrands.id, {
      onDelete: "restrict",
    }),

    campaignId: uuid("campaign_id").references(() => campaigns.id, {
      onDelete: "restrict",
    }),
    cityCampaignId: uuid("city_campaign_id").references(() => cityCampaigns.id, {
      onDelete: "restrict",
    }),

    lineType: financialLineType("line_type").notNull(),
    amountCents: bigint("amount_cents", { mode: "bigint" }).notNull(),

    // ISO 4217 (CAD, USD, GBP). Plain text per DECISIONS.md#013.
    currency: text("currency").notNull(),

    occurredOn: date("occurred_on").notNull(),

    // Eventbrite payout ID, invoice number, etc.
    externalRef: text("external_ref"),

    notes: text("notes").notNull().default(""),

    ...auditColumns,
    ...versionColumn,
  },
  (table) => ({
    campaignIdx: index("financial_lines_campaign_idx").on(table.campaignId),
    cityCampaignIdx: index("financial_lines_city_campaign_idx").on(table.cityCampaignId),
    crawlBrandIdx: index("financial_lines_crawl_brand_idx").on(table.crawlBrandId),
    outreachBrandIdx: index("financial_lines_outreach_brand_idx").on(table.outreachBrandId),
    occurredOnIdx: index("financial_lines_occurred_on_idx").on(table.occurredOn),
    lineTypeIdx: index("financial_lines_line_type_idx").on(table.lineType),
    externalRefIdx: index("financial_lines_external_ref_idx").on(table.externalRef),
  }),
);

export type FinancialLine = typeof financialLines.$inferSelect;
export type NewFinancialLine = typeof financialLines.$inferInsert;
