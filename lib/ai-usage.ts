import "server-only";

import { aiUsageEvents } from "@/db/schema";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { gte, sql } from "drizzle-orm";

/**
 * AI spend logging + reporting.
 *
 * recordAiUsage() is called from the single generateCompletion() choke point in
 * lib/ai.ts, so every AI feature is captured automatically with exact token
 * counts. Cost is a snapshot computed here at insert time.
 *
 * PRICES are USD per MILLION tokens (input / output). Token counts are exact;
 * only the dollar conversion uses this table -- so if Anthropic's list prices
 * change, update here and new rows reflect it (historical rows keep their
 * snapshot). Verify against https://www.anthropic.com/pricing.
 */
const PRICES_PER_MTOK: Array<{ match: string; input: number; output: number }> = [
  // Most specific first; matched by substring against the resolved model id.
  { match: "claude-opus-4", input: 15.0, output: 75.0 },
  { match: "claude-sonnet-4", input: 3.0, output: 15.0 },
  { match: "claude-haiku-4", input: 1.0, output: 5.0 },
  { match: "claude-opus", input: 15.0, output: 75.0 },
  { match: "claude-sonnet", input: 3.0, output: 15.0 },
  { match: "claude-haiku", input: 1.0, output: 5.0 },
];
// Fallback when the model id matches nothing above (use Haiku rates so an
// unknown model under-counts rather than wildly over-counts).
const DEFAULT_PRICE = { input: 1.0, output: 5.0 };

function priceFor(model: string): { input: number; output: number } {
  const m = model.toLowerCase();
  for (const p of PRICES_PER_MTOK) {
    if (m.includes(p.match)) return { input: p.input, output: p.output };
  }
  return DEFAULT_PRICE;
}

/** USD cost for a single call. */
export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = priceFor(model);
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
}

/** Best-effort: record one completion's usage. Never throws. */
export async function recordAiUsage(input: {
  tag: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  teamId?: string | null;
}): Promise<void> {
  try {
    const cost = estimateCostUsd(input.model, input.inputTokens, input.outputTokens);
    await db.insert(aiUsageEvents).values({
      tag: input.tag,
      model: input.model,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      costUsd: cost.toFixed(6),
      teamId: input.teamId ?? null,
    });
  } catch (err) {
    // Logging spend must never break the actual AI feature.
    logger.warn({ err, tag: input.tag }, "[ai-usage] record failed");
  }
}

export interface AiUsageRollup {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}
export interface AiUsageSummary {
  windowDays: number;
  /** Spend over rolling windows (all from one scan). */
  cost24h: number;
  cost7d: number;
  cost30d: number;
  costAllTime: number;
  /** Totals over the selected window. */
  window: AiUsageRollup;
  byDay: Array<{ day: string; calls: number; costUsd: number }>;
  byTag: Array<AiUsageRollup & { tag: string }>;
  byModel: Array<AiUsageRollup & { model: string }>;
  /** Projected 30-day spend from the last 7 days' run-rate. */
  projectedMonthlyUsd: number;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Load the AI spend summary. One scan-ish set of grouped aggregates; cheap on
 * the append-only table (indexed by created_at).
 */
export async function loadAiUsageSummary(windowDays = 30): Promise<AiUsageSummary> {
  const now = Date.now();
  const since = new Date(now - windowDays * 24 * 60 * 60 * 1000);
  const since24h = new Date(now - 24 * 60 * 60 * 1000);
  const since7d = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const since30d = new Date(now - 30 * 24 * 60 * 60 * 1000);

  const cost = sql<number>`coalesce(sum(${aiUsageEvents.costUsd}), 0)`;
  const calls = sql<number>`count(*)::int`;
  const inTok = sql<number>`coalesce(sum(${aiUsageEvents.inputTokens}), 0)::bigint`;
  const outTok = sql<number>`coalesce(sum(${aiUsageEvents.outputTokens}), 0)::bigint`;

  const [rollups, byDay, byTag, byModel] = await Promise.all([
    // Rolling-window costs in a single row.
    db
      .select({
        c24: sql<number>`coalesce(sum(${aiUsageEvents.costUsd}) filter (where ${aiUsageEvents.createdAt} >= ${since24h.toISOString()}), 0)`,
        c7: sql<number>`coalesce(sum(${aiUsageEvents.costUsd}) filter (where ${aiUsageEvents.createdAt} >= ${since7d.toISOString()}), 0)`,
        c30: sql<number>`coalesce(sum(${aiUsageEvents.costUsd}) filter (where ${aiUsageEvents.createdAt} >= ${since30d.toISOString()}), 0)`,
        cAll: cost,
      })
      .from(aiUsageEvents),
    db
      .select({
        day: sql<string>`to_char(${aiUsageEvents.createdAt}, 'YYYY-MM-DD')`,
        calls,
        costUsd: cost,
      })
      .from(aiUsageEvents)
      .where(gte(aiUsageEvents.createdAt, since))
      .groupBy(sql`1`)
      .orderBy(sql`1 desc`),
    db
      .select({
        tag: aiUsageEvents.tag,
        calls,
        inputTokens: inTok,
        outputTokens: outTok,
        costUsd: cost,
      })
      .from(aiUsageEvents)
      .where(gte(aiUsageEvents.createdAt, since))
      .groupBy(aiUsageEvents.tag)
      .orderBy(sql`coalesce(sum(${aiUsageEvents.costUsd}), 0) desc`),
    db
      .select({
        model: aiUsageEvents.model,
        calls,
        inputTokens: inTok,
        outputTokens: outTok,
        costUsd: cost,
      })
      .from(aiUsageEvents)
      .where(gte(aiUsageEvents.createdAt, since))
      .groupBy(aiUsageEvents.model)
      .orderBy(sql`coalesce(sum(${aiUsageEvents.costUsd}), 0) desc`),
  ]);

  const r = rollups[0];
  const cost7 = num(r?.c7);
  const windowTotals = byTag.reduce(
    (acc, t) => ({
      calls: acc.calls + num(t.calls),
      inputTokens: acc.inputTokens + num(t.inputTokens),
      outputTokens: acc.outputTokens + num(t.outputTokens),
      costUsd: acc.costUsd + num(t.costUsd),
    }),
    { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
  );

  return {
    windowDays,
    cost24h: num(r?.c24),
    cost7d: cost7,
    cost30d: num(r?.c30),
    costAllTime: num(r?.cAll),
    window: windowTotals,
    byDay: byDay.map((d) => ({ day: d.day, calls: num(d.calls), costUsd: num(d.costUsd) })),
    byTag: byTag.map((t) => ({
      tag: t.tag,
      calls: num(t.calls),
      inputTokens: num(t.inputTokens),
      outputTokens: num(t.outputTokens),
      costUsd: num(t.costUsd),
    })),
    byModel: byModel.map((m) => ({
      model: m.model,
      calls: num(m.calls),
      inputTokens: num(m.inputTokens),
      outputTokens: num(m.outputTokens),
      costUsd: num(m.costUsd),
    })),
    // Run-rate projection: last 7 days extrapolated to 30.
    projectedMonthlyUsd: (cost7 / 7) * 30,
  };
}
