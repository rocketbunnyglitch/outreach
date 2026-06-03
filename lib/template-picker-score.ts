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
export function pickBest<T extends ScorableTemplate>(
  templates: T[],
  ctx: PickContext,
): ScoredPick<T> | null {
  const scored = templates
    .map((t) => ({ t, ...scoreTemplate(t.triggerContext, ctx) }))
    .filter((s) => !s.excluded && s.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.t.autoPickPriority - a.t.autoPickPriority ||
        a.t.templateCode.localeCompare(b.t.templateCode),
    );

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
