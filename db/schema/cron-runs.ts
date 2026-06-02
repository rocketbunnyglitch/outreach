/**
 * cron_runs -- observability for the eight cron routes in
 * app/api/cron/*. Every cron handler is wrapped by
 * lib/cron-runs.ts#recordCronRun which inserts a row at the start
 * of each run and updates it on completion. The /admin/cron-health
 * page reads from here.
 *
 * See db/migrations/0085_cron_runs.sql for column semantics +
 * indexes. The schema here mirrors the migration; if you change
 * one update both.
 */

import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const cronRuns = pgTable(
  "cron_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cronName: text("cron_name").notNull(),
    status: text("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    errorMessage: text("error_message"),
    resultSummary: jsonb("result_summary"),
    host: text("host"),
  },
  (table) => ({
    nameStartedIdx: index("cron_runs_name_started_idx").on(table.cronName, table.startedAt),
    startedIdx: index("cron_runs_started_idx").on(table.startedAt),
  }),
);
