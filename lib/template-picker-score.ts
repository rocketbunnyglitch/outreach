/**
 * Pure scoring core for the template auto-picker (Phase 1.4).
 *
 * No server-only / DB imports, so it is unit-testable. lib/template-picker.ts
 * wraps this with the DB load. The scorer compares each template's
 * trigger_context against a PickContext: +10 per matching dimension, -5 per
 * conflict, with hard filters for days-to-event and wristband-only. Templates
 * whose stage is "insert_block" (T7A/T7B) are never picked as a main template
 * -- they are spliced in via {{wristband_note}}.
 *
 * [ReferenceDoc Section 7 + 8.7] template selection: engine picks, operator
 * can override.
 */

import type { TriggerContext } from "@/db/schema/templates";

export interface PickContext {
  campaignId: string;
  venueId?: string;
  threadId?: string;
  cityPriority?: 1 | 2 | 3 | 4 | 5 | 6;
  crawlCount?: number;
  slotType?: "wristband" | "middle" | "final" | "alt_final";
  eventType?: "night" | "day_party";
  daysToEvent?: number;
  isWarmRelationship?: boolean;
  askSize?: "big_open" | "small_specific";
  lifecycleStep?:
    | "confirmation"
    | "graphic"
    | "info_sheets"
    | "pre_event"
    | "day_before"
    | "day_of"
    | "cancellation"
    | "post_event";
}

export interface ScorableTemplate {
  templateCode: string;
  name: string;
  triggerContext: TriggerContext;
  autoPickPriority: number;
}

export interface Alternative {
  templateCode: string;
  reason: string;
}

export interface ScoredPick<T extends ScorableTemplate> {
  template: T;
  score: number;
  reason: string;
  alternatives: Alternative[];
}

const MATCH = 10;
const CONFLICT = -5;
const SOFT_MATCH = 5;

interface Desired {
  channel?: TriggerContext["channel"];
  stage?: TriggerContext["stage"];
}

// Map a PickContext to the channel/stage the engine is looking for. Lifecycle
// steps map directly; in the outreach phase, a sized ask is an opener
// (first_touch), otherwise it is a slot-detail follow-up.
function deriveDesired(ctx: PickContext): Desired {
  const step = ctx.lifecycleStep;
  if (step) {
    if (step === "confirmation") return { channel: "post_confirm", stage: "confirmation" };
    if (step === "cancellation") return { channel: "cancellation" };
    if (step === "post_event") return { channel: "post_event" };
    return { channel: "lifecycle", stage: step };
  }
  return {
    channel: ctx.isWarmRelationship ? "warm" : "cold",
    stage: ctx.askSize ? "first_touch" : "detail",
  };
}

export interface ScoreResult {
  score: number;
  excluded: boolean;
}

export function scoreTemplate(tc: TriggerContext, ctx: PickContext): ScoreResult {
  // Insert blocks (T7A/T7B) are spliced into other templates, never picked.
  if (tc.stage === "insert_block") return { score: 0, excluded: true };

  // Hard filters.
  if (
    tc.min_days_to_event != null &&
    ctx.daysToEvent != null &&
    ctx.daysToEvent < tc.min_days_to_event
  ) {
    return { score: 0, excluded: true };
  }
  if (
    tc.max_days_to_event != null &&
    ctx.daysToEvent != null &&
    ctx.daysToEvent > tc.max_days_to_event
  ) {
    return { score: 0, excluded: true };
  }
  if (tc.wristband_only === true && ctx.slotType != null && ctx.slotType !== "wristband") {
    return { score: 0, excluded: true };
  }
  if (tc.wristband_only === false && ctx.slotType === "wristband") {
    return { score: 0, excluded: true };
  }

  const desired = deriveDesired(ctx);
  let score = 0;
  if (tc.channel) score += tc.channel === desired.channel ? MATCH : CONFLICT;
  if (tc.stage) score += tc.stage === desired.stage ? MATCH : CONFLICT;
  if (tc.event_type && tc.event_type !== "any" && ctx.eventType) {
    score += tc.event_type === ctx.eventType ? MATCH : CONFLICT;
  }
  if (tc.ask_size && ctx.askSize) score += tc.ask_size === ctx.askSize ? MATCH : CONFLICT;
  if (tc.crawls && tc.crawls !== "any" && ctx.crawlCount != null) {
    const ctxCrawls = ctx.crawlCount > 1 ? "multiple" : "single";
    score += tc.crawls === ctxCrawls ? MATCH : CONFLICT;
  }
  if (tc.priority && tc.priority.length > 0 && ctx.cityPriority != null) {
    score += tc.priority.includes(ctx.cityPriority) ? MATCH : CONFLICT;
  }
  if (tc.prior_relationship != null && ctx.isWarmRelationship != null) {
    score += tc.prior_relationship === ctx.isWarmRelationship ? MATCH : CONFLICT;
  }
  if (tc.wristband_only != null && ctx.slotType != null) {
    score += tc.wristband_only === (ctx.slotType === "wristband") ? SOFT_MATCH : CONFLICT;
  }
  return { score, excluded: false };
}

function buildReason(t: ScorableTemplate, ctx: PickContext, score: number): string {
  const tc = t.triggerContext;
  const bits: string[] = [];
  if (tc.channel) bits.push(tc.channel.replace(/_/g, " "));
  if (tc.stage && tc.stage !== "insert_block") bits.push(tc.stage.replace(/_/g, " "));
  if (tc.event_type && tc.event_type !== "any") bits.push(tc.event_type.replace(/_/g, " "));
  if (tc.crawls && tc.crawls !== "any") bits.push(`${tc.crawls} crawl`);
  if (ctx.cityPriority != null) bits.push(`Prio ${ctx.cityPriority}`);
  const desc = bits.length > 0 ? bits.join(", ") : "general";
  return `${t.templateCode}: ${desc} (match score ${score})`;
}

/**
 * Score every template against ctx and return the best (highest score, then
 * auto_pick_priority, then code) plus up to 3 alternatives. Null if nothing
 * scores above zero.
 */
/** Rule-score + sort, exported so Loop C (rerankByReplyRate) can see the
 *  full tie structure, not just the winner. */
export function scoreAndSort<T extends ScorableTemplate>(
  templates: T[],
  ctx: PickContext,
): Array<{ t: T; score: number }> {
  return templates
    .map((t) => ({ t, ...scoreTemplate(t.triggerContext, ctx) }))
    .filter((s) => !s.excluded && s.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.t.autoPickPriority - a.t.autoPickPriority ||
        a.t.templateCode.localeCompare(b.t.templateCode),
    );
}

export function pickBest<T extends ScorableTemplate>(
  templates: T[],
  ctx: PickContext,
): ScoredPick<T> | null {
  const scored = scoreAndSort(templates, ctx);

  const top = scored[0];
  if (!top) return null;

  return {
    template: top.t,
    score: top.score,
    reason: buildReason(top.t, ctx, top.score),
    alternatives: scored.slice(1, 4).map((s) => ({
      templateCode: s.t.templateCode,
      reason: buildReason(s.t, ctx, s.score),
    })),
  };
}

// ============================================================================
// Loop C (CRM plan E2): within-stage variant choice by MEASURED reply rate.
//
// The rule table above stays authoritative for STAGE — this only reorders
// templates that scored IDENTICALLY (true within-stage variants). With
// enough signal (minN sends per variant in the city's priority band, falling
// back to all-band totals) the better-performing variant wins; with
// probability exploreRate the runner-up is sent instead so the loser keeps
// accumulating evidence and a lucky early streak can't lock in forever.
// ============================================================================

/** P1-2 = high (must-win cities), P3-4 = mid, P5-6 = low. */
export type PriorityBand = "high" | "mid" | "low";

export function priorityBand(cityPriority: number | undefined | null): PriorityBand | null {
  if (cityPriority == null) return null;
  if (cityPriority <= 2) return "high";
  if (cityPriority <= 4) return "mid";
  return "low";
}

export interface TemplateReplyRate {
  sends: number;
  replied: number;
}

/** Per template code: per-band stats + the all-band fallback. */
export type ReplyRateTable = Map<
  string,
  { byBand: Partial<Record<PriorityBand, TemplateReplyRate>>; all: TemplateReplyRate }
>;

export const REPLY_RATE_MIN_N = 20;
export const REPLY_RATE_EXPLORE = 0.1;

export interface ReplyRateRerankResult<T extends ScorableTemplate> {
  pick: T;
  /** Why the measured loop changed (or didn't change) the pick. Null when
   *  the rates had no effect (no ties, or not enough signal). */
  loopReason: string | null;
}

/**
 * Given the rule-scored candidates (already sorted best-first) re-pick among
 * the TOP-SCORE TIES using measured reply rates. `rand` is injected so tests
 * are deterministic; production passes Math.random.
 */
export function rerankByReplyRate<T extends ScorableTemplate>(
  sortedCandidates: Array<{ t: T; score: number }>,
  rates: ReplyRateTable,
  band: PriorityBand | null,
  rand: () => number,
  opts?: { minN?: number; exploreRate?: number },
): ReplyRateRerankResult<T> | null {
  const top = sortedCandidates[0];
  if (!top) return null;
  const minN = opts?.minN ?? REPLY_RATE_MIN_N;
  const exploreRate = opts?.exploreRate ?? REPLY_RATE_EXPLORE;

  const ties = sortedCandidates.filter((s) => s.score === top.score);
  if (ties.length < 2) return { pick: top.t, loopReason: null };

  // Resolve each variant's stats: band first, all-band fallback. A variant
  // missing minN sends in BOTH disqualifies the whole rerank — choosing on
  // thin evidence is worse than the stable rule order.
  const withRates = ties.map((s) => {
    const r = rates.get(s.t.templateCode);
    const bandStats = band ? r?.byBand[band] : undefined;
    const stats =
      bandStats && bandStats.sends >= minN ? bandStats : r && r.all.sends >= minN ? r.all : null;
    return { s, stats, usedBand: !!(bandStats && bandStats.sends >= minN) };
  });
  if (withRates.some((w) => !w.stats)) return { pick: top.t, loopReason: null };

  const ranked = [...withRates].sort((a, b) => {
    const ra = (a.stats as TemplateReplyRate).replied / (a.stats as TemplateReplyRate).sends;
    const rb = (b.stats as TemplateReplyRate).replied / (b.stats as TemplateReplyRate).sends;
    return rb - ra || a.s.t.templateCode.localeCompare(b.s.t.templateCode);
  });

  const bestRanked = ranked[0] as (typeof ranked)[number];
  const explore = ranked.length > 1 && rand() < exploreRate;
  const chosen = explore ? (ranked[1] as (typeof ranked)[number]) : bestRanked;
  const st = chosen.stats as TemplateReplyRate;
  const ratePct = Math.round((st.replied / st.sends) * 100);
  const scope = chosen.usedBand && band ? `${band}-priority cities` : "all cities";

  return {
    pick: chosen.s.t,
    loopReason: explore
      ? "exploration pick (10%) — keeps gathering evidence on the runner-up variant"
      : `best measured reply rate among equal-stage variants: ${ratePct}% over ${st.sends} sends in ${scope}`,
  };
}
