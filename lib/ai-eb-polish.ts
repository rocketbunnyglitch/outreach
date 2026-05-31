import "server-only";

/**
 * AI Eventbrite description polish — Tier B #7 of the Haiku ROI sprint.
 *
 * Generates a 1-2 sentence intro paragraph that goes ABOVE the
 * existing formatVenuesBlock() output when the operator pushes a
 * venue route to Eventbrite. The structured venue list stays
 * unchanged (operators rely on its scannable shape); we just add
 * a warm opener that makes the EB listing read less like a data
 * table.
 *
 * Cost characteristics:
 *   - ~250 input tokens (date, day_part, crawl number, venue
 *     count, city — no PII)
 *   - ~100 output tokens (1-2 short sentences)
 *   - ~$0.0007/call with Haiku 4.5
 *
 * Guardrails:
 *   - AI_EB_POLISH_ENABLED env flag (kill switch)
 *   - Per-staff rate limit: 20/min (per-row push is medium-
 *     frequency; cap protects against UI loops)
 *   - Output cap: 280 chars hard-trim (mobile EB previews
 *     truncate around there)
 *   - One-shot — failures fall through to the un-polished
 *     description (caller pushes anyway)
 *   - NEVER cached — generation per push is cheap and the
 *     intro changes with venue lineup composition
 */

import { generateCompletion, isAiConfigured } from "@/lib/ai";
import { checkAiRateLimit, isAiFeatureEnabled } from "@/lib/ai-guardrails";
import { logger } from "@/lib/logger";

const POLISH_MODEL = "claude-haiku-4-5-20251001";
const POLISH_MAX_TOKENS = 200;

const SYSTEM_PROMPT = `You write 1-2 sentence Eventbrite event-description openers for a
bar-crawl ticketed event. The operator publishes this to attract
ticket buyers; the venue list follows immediately after your
sentence as a structured HTML block, so you DON'T list venues —
you set up the night.

Voice: warm and concrete. Operator's existing tone:
  - No emojis.
  - No exclamation points.
  - No marketing-speak ("amazing", "incredible", "don't miss out").
  - No clickbait.
  - Match the city's name + the day-of-week vibe.
  - Lean specific: name the city, the day, the count of stops.

Constraints:
  - ≤ 280 characters TOTAL (one or two sentences).
  - No HTML — return PLAIN TEXT only. The caller wraps in <p>.
  - Don't repeat the event title.
  - Don't include phrases like "join us" or "you'll" — keep it
    third-person descriptive.

Output: JUST the text. No JSON, no markdown, no preamble.`;

interface PolishInput {
  staffId: string;
  cityName: string;
  /** "Thursday Night", "Saturday Day", etc. */
  dayPartLabel: string;
  /** ISO event date (YYYY-MM-DD). The model uses it for
   *  weekday + month context. */
  eventDate: string;
  /** Number of confirmed venues in the route — gives the model
   *  the "X stops" framing it can drop into a sentence. */
  venueCount: number;
  /** Optional crawl number when multiple crawls run the same
   *  night (e.g. "Saturday Crawl 2"). */
  crawlNumber?: number | null;
}

type PolishResult =
  | { ok: true; text: string }
  | { ok: false; reason: "not_configured" | "disabled" | "rate_limited" | "failed" | "too_short" };

export async function polishEbDescription(input: PolishInput): Promise<PolishResult> {
  if (!isAiConfigured()) return { ok: false, reason: "not_configured" };
  if (!isAiFeatureEnabled("eb_polish")) return { ok: false, reason: "disabled" };
  if (input.venueCount === 0) return { ok: false, reason: "too_short" };

  // 20/min per staff. Per-row push button is medium-frequency; this
  // cap is defense against a loop, not throttling.
  const limit = checkAiRateLimit({
    feature: "eb_polish",
    staffId: input.staffId,
    max: 20,
  });
  if (!limit.ok) {
    logger.warn(
      { staffId: input.staffId, retryAfterMs: limit.retryAfterMs },
      "eb polish rate limited",
    );
    return { ok: false, reason: "rate_limited" };
  }

  const userPrompt = `City: ${input.cityName}
Day part: ${input.dayPartLabel}
Event date: ${input.eventDate}
Venue stops: ${input.venueCount}${
    input.crawlNumber ? `\nCrawl number this night: ${input.crawlNumber}` : ""
  }

Write a 1-2 sentence opener (≤280 chars, plain text).`;

  const start = Date.now();
  const aiResult = await generateCompletion({
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
    model: POLISH_MODEL,
    maxTokens: POLISH_MAX_TOKENS,
    tag: "ai-eb-polish",
  });
  const elapsedMs = Date.now() - start;

  if (!aiResult.ok) {
    logger.warn({ reason: aiResult.reason, elapsedMs }, "eb polish completion failed");
    return { ok: false, reason: "failed" };
  }

  let text = aiResult.text.trim();
  // Strip surrounding quotes if the model wrapped its response
  if (text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1).trim();
  // Hard cap 280 chars
  if (text.length > 280) text = `${text.slice(0, 277)}...`;
  // Defensive: refuse if the model returned a JSON-like wrapper
  if (text.startsWith("{") || text.startsWith("[")) {
    logger.warn({ raw: text.slice(0, 100) }, "eb polish returned non-text");
    return { ok: false, reason: "failed" };
  }
  if (text.length < 20) return { ok: false, reason: "failed" };

  logger.info({ elapsedMs, len: text.length, city: input.cityName }, "eb polish generated");
  return { ok: true, text };
}
