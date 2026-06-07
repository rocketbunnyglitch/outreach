/**
 * ai_usage_events — append-only AI spend log (migration 0123).
 *
 * One row per Anthropic completion, written from the single generateCompletion()
 * choke point in lib/ai.ts. Token counts are exact (from the API); cost_usd is a
 * snapshot computed at insert time from the price table in lib/ai-usage.ts.
 * Powers /admin/ai-usage.
 */

import { index, integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const aiUsageEvents = pgTable(
  "ai_usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Feature tag passed to generateCompletion (e.g. inbox_auto_classify). */
    tag: text("tag").notNull(),
    /** Resolved model id from the API response. */
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    /** USD cost snapshot at insert time (sub-cent precision). */
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    teamId: uuid("team_id"),
  },
  (table) => ({
    createdIdx: index("ai_usage_events_created_at_idx").on(table.createdAt),
    tagIdx: index("ai_usage_events_tag_created_idx").on(table.tag, table.createdAt),
  }),
);

export type AiUsageEvent = typeof aiUsageEvents.$inferSelect;
export type NewAiUsageEvent = typeof aiUsageEvents.$inferInsert;
