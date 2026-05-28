/**
 * Crawl Hosts — who runs a given crawl. Up to 2 hosts per crawl
 * (operator: "there can be up to 2 hosts per crawl").
 *
 * A host is EITHER an internal_host OR an external_host (host_type
 * discriminates). For internal hosts the per-crawl name/hours/rate may be
 * captured inline (internal_host_id optional); for external hosts the
 * external_host_id may be null while the crawl awaits assignment. The slot
 * (1|2) keeps the two hosts ordered + lets the unique index cap a crawl at 2.
 *
 * This is what powers the crawl-matrix "host classification"
 * (internal / external / none) and the host-type badge on the crawl
 * table.
 */

import { bigint, numeric, pgTable, smallint, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { auditColumns, idColumn } from "../types";
import { hostKind } from "./enums";
import { events } from "./events";
import { externalHosts } from "./external-hosts";
import { internalHosts } from "./internal-hosts";

export const crawlHosts = pgTable(
  "crawl_hosts",
  {
    ...idColumn,

    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),

    hostType: hostKind("host_type").notNull(),

    /** Set when host_type='internal'. */
    internalHostId: uuid("internal_host_id").references(() => internalHosts.id, {
      onDelete: "cascade",
    }),
    /** Set when host_type='external'. */
    externalHostId: uuid("external_host_id").references(() => externalHosts.id, {
      onDelete: "cascade",
    }),

    /**
     * Per-crawl internal-host capture. Hours (and sometimes the person) vary by
     * crawl/day, so for host_type='internal' the name + hours + rate live HERE
     * on the crawl event rather than on the shared internal_hosts roster row.
     * internal_host_id stays an optional link to the roster for payout, but is
     * not required when these inline fields are set.
     */
    internalHostName: text("internal_host_name"),
    internalHostHours: numeric("internal_host_hours", { precision: 6, scale: 2 }),
    internalHostRateCents: bigint("internal_host_rate_cents", { mode: "number" }),

    /** 1 or 2 — ordering + dedupe key (max 2 hosts/crawl). */
    slot: smallint("slot").notNull().default(1),

    ...auditColumns,
  },
  (table) => ({
    eventSlotUnique: uniqueIndex("crawl_hosts_event_slot_unique").on(table.eventId, table.slot),
  }),
);

export type CrawlHost = typeof crawlHosts.$inferSelect;
export type NewCrawlHost = typeof crawlHosts.$inferInsert;
