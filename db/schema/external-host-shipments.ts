/**
 * External-host wristband shipments.
 *
 * External hosts get wristbands shipped to them. When a host runs multiple
 * crawls in the same city we usually send enough for ALL of those crawls in a
 * single shipment — so the shipment grain is (external host + city campaign),
 * NOT per crawl. One row = "the wristbands we sent this host for their crawls
 * in this city." Internal hosts work at the bar and are paid via the venue, so
 * they don't get shipments tracked here.
 *
 * Reuses the wristband_status enum (pending / ready_to_ship / shipped /
 * delivered / issue) for parity with venue wristband shipments.
 */

import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { auditColumns, idColumn } from "../types";
import { cityCampaigns } from "./city-campaigns";
import { wristbandStatus } from "./enums";
import { externalHosts } from "./external-hosts";

export const externalHostShipments = pgTable(
  "external_host_shipments",
  {
    ...idColumn,

    externalHostId: uuid("external_host_id")
      .notNull()
      .references(() => externalHosts.id, { onDelete: "cascade" }),
    cityCampaignId: uuid("city_campaign_id")
      .notNull()
      .references(() => cityCampaigns.id, { onDelete: "cascade" }),

    status: wristbandStatus("status").notNull().default("pending"),
    /** How many wristbands shipped (covering all the host's crawls in the city). */
    wristbandCount: integer("wristband_count"),
    trackingNumber: text("tracking_number"),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    notes: text("notes").notNull().default(""),

    ...auditColumns,
  },
  (table) => ({
    hostCityUnique: uniqueIndex("external_host_shipments_host_city_unique").on(
      table.externalHostId,
      table.cityCampaignId,
    ),
    cityIdx: index("external_host_shipments_city_idx").on(table.cityCampaignId),
  }),
);

export type ExternalHostShipment = typeof externalHostShipments.$inferSelect;
export type NewExternalHostShipment = typeof externalHostShipments.$inferInsert;
