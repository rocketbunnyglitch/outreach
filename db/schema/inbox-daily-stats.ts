/**
 * inbox_daily_stats — per-(connected_account, UTC date) rollup of the
 * four metrics that drive sparklines + alert rules:
 *   cold_sends, replies, bounces, stale_threads_at_eod
 *
 * The daily cron upserts each row once per day. UI reads back 30 days
 * to render the inline sparklines. See migration 0053.
 *
 * Distinct from email_send_events (per-send audit, no rollup) and from
 * lib/inbox-analytics (point-in-time 30d rollup). This table exists
 * specifically so the sparkline + alert workers don't have to scan
 * email_send_events on every page load.
 */

import { date, index, integer, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { connectedAccounts } from "./users";

export const inboxDailyStats = pgTable(
  "inbox_daily_stats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectedAccountId: uuid("connected_account_id")
      .notNull()
      .references(() => connectedAccounts.id, { onDelete: "cascade" }),
    statDate: date("stat_date").notNull(),
    coldSends: integer("cold_sends").notNull().default(0),
    replies: integer("replies").notNull().default(0),
    bounces: integer("bounces").notNull().default(0),
    staleThreadsAtEod: integer("stale_threads_at_eod").notNull().default(0),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    accountDateUnique: uniqueIndex("inbox_daily_stats_account_date_unique").on(
      t.connectedAccountId,
      t.statDate,
    ),
    dateIdx: index("inbox_daily_stats_date_idx").on(t.statDate),
  }),
);

export type InboxDailyStat = typeof inboxDailyStats.$inferSelect;
export type NewInboxDailyStat = typeof inboxDailyStats.$inferInsert;
