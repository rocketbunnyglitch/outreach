import "server-only";

/**
 * Shared guardrails for the Haiku ROI feature sprint.
 *
 * Every new AI feature (smart-reply chips, CSV column mapping,
 * subject-line suggester, lead scoring, etc.) wraps its Claude
 * calls in helpers from this module so the cost characteristics
 * are uniform and obvious in one place.
 *
 * Three guards:
 *
 *   1. Env killswitch — every feature has an env flag
 *      AI_<FEATURE>_ENABLED. Setting it to "0" disables the
 *      feature entirely so operators can flip a switch without
 *      a redeploy if costs spike.
 *
 *   2. Per-staff rate limit — in-memory token bucket capped per
 *      feature × staff. Prevents a fast-clicking operator or a
 *      misbehaving UI loop from running up the bill. The limit
 *      is intentionally generous (10-30/min depending on
 *      feature) — the bucket is here to catch runaway behavior,
 *      not to throttle normal use.
 *
 *      In-memory means the limit resets on app restart and is
 *      per-pod in a multi-pod deploy. That's fine — the goal is
 *      "catch the obvious bad case," not "perfect global cap."
 *      For a global cap, the per-feature env flag plus Anthropic's
 *      own usage alerts on the API key are the real safety net.
 *
 *   3. Input truncation — every feature should cap its input
 *      tokens before calling the model. truncateForAi() is a
 *      character-count guard (4 chars ≈ 1 token) that ensures
 *      no runaway-long context blows up cost.
 *
 * Caching is per-feature responsibility — most features cache on
 * existing DB columns (ai_summary, ai_quick_replies, etc.) keyed
 * by message_count or update timestamp. This module doesn't try
 * to provide a generic cache.
 */

import { logger } from "@/lib/logger";

// =========================================================================
// Feature killswitches
// =========================================================================

/**
 * Per-feature env flag. Returns false ONLY when the operator has
 * explicitly set AI_<FEATURE>_ENABLED=0 (or "false" / "off"). The
 * default is enabled — features rely on isAiConfigured() (no
 * ANTHROPIC_API_KEY = nothing fires anyway) plus this flag as a
 * one-line kill switch.
 *
 * Usage:
 *   if (!isAiFeatureEnabled("quick_replies")) return null;
 *   if (!isAiFeatureEnabled("csv_mapping")) return null;
 */
export function isAiFeatureEnabled(feature: string): boolean {
  const key = `AI_${feature.toUpperCase()}_ENABLED`;
  const value = process.env[key];
  if (value === undefined || value === "") return true;
  return value !== "0" && value.toLowerCase() !== "false" && value.toLowerCase() !== "off";
}

// =========================================================================
// Per-staff rate limit (in-memory token bucket)
// =========================================================================

interface BucketState {
  /** When the current window started (ms since epoch). */
  windowStart: number;
  /** Calls counted in the current window. */
  count: number;
}

/** Bucket keyed by `${feature}::${staffId}`. */
const buckets = new Map<string, BucketState>();

const WINDOW_MS = 60_000; // 1-minute rolling window

/**
 * Token-bucket check. Returns { ok: true } when the call should
 * proceed, or { ok: false, retryAfterMs } when the operator has
 * exceeded the per-minute limit. Caller should surface a polite
 * "you're going too fast" message and NOT make the AI call.
 *
 * Per-staff rather than global so a slow operator never gets
 * limited by a fast colleague. Per-feature so a hot smart-reply
 * loop doesn't starve out the operator's ability to score leads.
 *
 * Resets when the 1-minute window rolls over. No persistence —
 * fresh limits after every app restart. That's intentional.
 *
 * Default limits (override at call site with `max` arg):
 *   - High-frequency click features:  30/min  (subject lines)
 *   - Medium-frequency:               15/min  (smart replies)
 *   - Low-frequency expensive:        5/min   (lead scoring,
 *                                              EB description)
 *   - Backfills / admin batches:      handle at batch level
 */
export function checkAiRateLimit(opts: {
  feature: string;
  staffId: string;
  max: number;
}): { ok: true } | { ok: false; retryAfterMs: number } {
  const key = `${opts.feature}::${opts.staffId}`;
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    // New window — reset.
    buckets.set(key, { windowStart: now, count: 1 });
    return { ok: true };
  }

  if (bucket.count >= opts.max) {
    // Bucket full — refuse.
    const retryAfterMs = WINDOW_MS - (now - bucket.windowStart);
    logger.warn(
      { feature: opts.feature, staffId: opts.staffId, max: opts.max },
      "ai rate limit hit",
    );
    return { ok: false, retryAfterMs };
  }

  bucket.count += 1;
  return { ok: true };
}

/**
 * Periodic bucket sweep — drop stale buckets so the Map doesn't
 * grow unbounded in long-running processes. Called opportunistically
 * by checkAiRateLimit-adjacent code; cheap (O(n) over buckets).
 *
 * Not strictly necessary at the scale of this app (at most a few
 * dozen entries) but defensive.
 */
export function sweepStaleBuckets(): void {
  const now = Date.now();
  for (const [k, b] of buckets.entries()) {
    if (now - b.windowStart >= WINDOW_MS * 2) buckets.delete(k);
  }
}

// =========================================================================
// Input truncation
// =========================================================================

/**
 * Character-count guard for AI prompts. 4 chars ≈ 1 token is the
 * widely-cited rule of thumb; we use 3.5 to be conservative since
 * tokenizers vary.
 *
 * Usage:
 *   const safeBody = truncateForAi(message.bodyText, 4000); // ~1100 tok
 *
 * When truncation happens, a trailing marker is appended so the
 * model knows it's reading a truncated input rather than a complete
 * thought ("…[truncated]"). This avoids the model concluding from
 * a cut-off sentence.
 */
export function truncateForAi(text: string, maxChars: number): string {
  if (!text) return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 14)}…[truncated]`;
}

/**
 * Approximate token count from char count. NOT precise — Anthropic's
 * tokenizer has its own quirks — but good enough for the "is my
 * prompt about to blow up" check at the call site.
 *
 * Used by feature modules to log estimated input size for cost
 * audits. Not used to enforce a hard cap (that's the model's job).
 */
export function approxTokenCount(text: string): number {
  return Math.ceil((text?.length ?? 0) / 3.5);
}
