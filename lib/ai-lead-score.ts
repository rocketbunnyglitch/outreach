import "server-only";

/**
 * AI lead scoring — Tier A #5 of the Haiku ROI sprint.
 *
 * Scores cold_outreach_entries 0-100 with a 1-line human-readable
 * reason. Drives the default sort on the cold-outreach worksheet
 * so operators work the highest-signal rows first instead of
 * scanning 200 rows alphabetically.
 *
 * Mode: BATCHED — one Haiku call per N (default 20) venues. The
 * model returns a JSON array of {entryId, score, reason} objects
 * and we write them all in a single UPDATE. The per-call cost
 * spreads across N venues, so each scored venue costs ~$0.00007.
 *
 * Cost characteristics:
 *   - Per batch (20 venues): ~$0.0015 input + ~$0.001 output
 *   - Per venue: ~$0.0001
 *   - 500 venues full backfill: ~$0.05
 *
 * Guardrails:
 *   - AI_LEAD_SCORE_ENABLED env flag (kill switch)
 *   - Batch size capped at 30 (input token control)
 *   - Per-staff rate limit: 5 batches/min (defense against a
 *     UI loop firing it on every keystroke)
 *   - 30-day re-score window: if ai_lead_score_at is fresh,
 *     skip the venue. Forces "burn through stale data" not
 *     "re-score on every page load."
 *   - Defensive parse: model output validated; any malformed
 *     entry is skipped without affecting the rest of the batch.
 *   - Score clamped to 0..100.
 *
 * Scoring factors (encoded in the prompt):
 *   1. Venue completeness — email + phone + website + capacity +
 *      hours all present pushes the score up. Sparse data caps
 *      the score (you can't email a venue with no email).
 *   2. Venue type match — bar / lounge / club beats restaurant
 *      beats coffee shop for crawl-hosting fit.
 *   3. Capacity hint — 100-400 is ideal for crawl slots.
 *      Outside that range gets a small penalty.
 *   4. Signal of activity — instagram handle present, website
 *      that's not a placeholder.
 *   5. City context — large markets (Toronto, NYC, Chicago) get
 *      a small boost since they have more crawl volume.
 *   6. NEGATIVE signals — do_not_contact flag, very low capacity
 *      (<40), no contact channels at all.
 */

import { cities, coldOutreachEntries, venues } from "@/db/schema";
import { generateCompletion, isAiConfigured } from "@/lib/ai";
import { checkAiRateLimit, isAiFeatureEnabled, truncateForAi } from "@/lib/ai-guardrails";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { and, eq, isNull, lt, or } from "drizzle-orm";

const LEAD_SCORE_MODEL = "claude-haiku-4-5-20251001";
const LEAD_SCORE_MAX_TOKENS = 2000; // batches output bigger JSON
const BATCH_SIZE = 20;
const MAX_BATCH_SIZE = 30;

/** Re-score window. Entries scored within this many days are
 *  skipped during a backfill — they're considered fresh enough. */
const RESCORE_AFTER_DAYS = 30;

const SYSTEM_PROMPT = `You score bar/restaurant/lounge venues 0-100 for likelihood of
agreeing to host a bar-crawl event. Higher = better lead. The
operator works the top of the list first.

INPUT: A JSON array of venue objects with these fields:
  - id           (the cold_outreach_entries row id you score)
  - name
  - city
  - region
  - venueType    (array, e.g. ["bar", "lounge"])
  - capacity     (integer or null)
  - email        (string or null)
  - phone        (string or null)
  - websiteUrl   (string or null)
  - instagram    (string or null)
  - hasHours     (boolean)
  - doNotContact (boolean)

OUTPUT: A JSON array (same length, same id order). Each entry:
  {
    "id": "<the input id>",
    "score": <integer 0..100>,
    "reason": "<one short sentence, ≤120 chars>"
  }

SCORING GUIDE:
  90-100 = Strong: bar/lounge/club, ~100-400 capacity, has email +
           phone + website + IG, in a major crawl market.
  70-89  = Good: most signals present; minor gap (e.g. no IG, or
           a slightly off capacity).
  50-69  = Mixed: enough info to try but with a clear gap (e.g.
           missing email, or venue type is borderline — a quiet
           restaurant rather than a bar).
  30-49  = Weak: lots of unknowns. Worth a low-priority outreach
           if time permits.
  10-29  = Very weak: little contact info, wrong venue type, or
           tiny capacity.
  0-9    = Skip: do_not_contact=true OR almost no usable data.

WRITING THE REASON:
  - One short sentence, ≤120 chars.
  - Cite the 1-2 STRONGEST signals (positive or negative).
  - No marketing-speak. No emojis. No exclamation points.
  - Examples:
      "Strong: lounge ~250 cap, email + IG + website, Toronto market"
      "Mixed: no email, but bar in NYC with 200 cap and active IG"
      "Weak: restaurant, no phone, no website, capacity unknown"
      "Skip: do_not_contact flag set"

OUTPUT STRICT JSON ONLY — no preamble, no markdown:
  [{"id":"...","score":85,"reason":"..."}, ...]

If you can't score an entry, set score to 0 and reason to
"insufficient data".`;

export interface LeadScoreInput {
  entryId: string;
  venueName: string;
  cityName: string | null;
  region: string | null;
  venueType: string[];
  capacity: number | null;
  email: string | null;
  phoneE164: string | null;
  websiteUrl: string | null;
  instagramHandle: string | null;
  hasHours: boolean;
  doNotContact: boolean;
}

export interface LeadScoreResult {
  entryId: string;
  score: number;
  reason: string;
}

interface ScoreBatchOpts {
  staffId: string;
  venues: LeadScoreInput[];
}

/**
 * Score a batch of venues. Returns the parsed results (length may
 * be less than input if the model dropped or malformed any) plus
 * the input count for caller-side accounting.
 *
 * NEVER throws — failures return an empty array.
 */
export async function scoreLeadBatch(opts: ScoreBatchOpts): Promise<{
  scored: LeadScoreResult[];
  attempted: number;
  ok: boolean;
  reason?: string;
}> {
  if (!isAiConfigured()) return { scored: [], attempted: 0, ok: false, reason: "not_configured" };
  if (!isAiFeatureEnabled("lead_score"))
    return { scored: [], attempted: 0, ok: false, reason: "disabled" };
  if (opts.venues.length === 0) return { scored: [], attempted: 0, ok: true };
  if (opts.venues.length > MAX_BATCH_SIZE) {
    return {
      scored: [],
      attempted: opts.venues.length,
      ok: false,
      reason: `batch too large (max ${MAX_BATCH_SIZE})`,
    };
  }

  // Defense against fast-clicking — 5 batches/min per staff.
  const limit = checkAiRateLimit({
    feature: "lead_score",
    staffId: opts.staffId,
    max: 5,
  });
  if (!limit.ok) {
    logger.warn(
      { staffId: opts.staffId, retryAfterMs: limit.retryAfterMs },
      "lead score rate limited",
    );
    return { scored: [], attempted: opts.venues.length, ok: false, reason: "rate_limited" };
  }

  // Build the input payload. We trim long fields so the input
  // stays predictable in cost.
  const payload = opts.venues.map((v) => ({
    id: v.entryId,
    name: truncateForAi(v.venueName, 100),
    city: v.cityName ?? null,
    region: v.region ?? null,
    venueType: v.venueType.slice(0, 4),
    capacity: v.capacity,
    email: v.email ? "present" : null, // privacy: we don't send the
    // actual email — model just needs to know it exists. Same for
    // phone — the value doesn't affect the score.
    phone: v.phoneE164 ? "present" : null,
    websiteUrl: v.websiteUrl ? "present" : null,
    instagram: v.instagramHandle ?? null,
    hasHours: v.hasHours,
    doNotContact: v.doNotContact,
  }));

  const userPrompt = `Score these ${payload.length} venues:

${JSON.stringify(payload, null, 2)}

Return the JSON array.`;

  const start = Date.now();
  const aiResult = await generateCompletion({
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
    model: LEAD_SCORE_MODEL,
    maxTokens: LEAD_SCORE_MAX_TOKENS,
    tag: "ai-lead-score",
  });
  const elapsedMs = Date.now() - start;

  if (!aiResult.ok) {
    logger.warn({ reason: aiResult.reason, elapsedMs }, "lead score completion failed");
    return { scored: [], attempted: opts.venues.length, ok: false, reason: aiResult.reason };
  }

  const parsed = parseScoreBatch(aiResult.text);
  if (!parsed) {
    logger.warn({ raw: aiResult.text.slice(0, 300) }, "lead score JSON parse failed");
    return { scored: [], attempted: opts.venues.length, ok: false, reason: "parse_error" };
  }

  // Filter to known entry IDs; clamp scores 0..100; trim reasons.
  const inputIds = new Set(opts.venues.map((v) => v.entryId));
  const safe: LeadScoreResult[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    if (typeof item.id !== "string" || !inputIds.has(item.id)) continue;
    const rawScore = Number(item.score);
    if (!Number.isFinite(rawScore)) continue;
    const score = Math.max(0, Math.min(100, Math.round(rawScore)));
    const reason =
      typeof item.reason === "string" ? truncateForAi(item.reason.trim(), 200) : "no reason given";
    safe.push({ entryId: item.id, score, reason });
  }

  logger.info(
    {
      elapsedMs,
      attempted: opts.venues.length,
      scored: safe.length,
      avgScore: safe.length
        ? Math.round(safe.reduce((s, r) => s + r.score, 0) / safe.length)
        : null,
    },
    "lead score batch complete",
  );

  return { scored: safe, attempted: opts.venues.length, ok: true };
}

function parseScoreBatch(
  raw: string,
): Array<{ id?: unknown; score?: unknown; reason?: unknown }> | null {
  if (!raw) return null;
  // Extract first [...] block — handles backtick fences + preamble.
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    const json = JSON.parse(raw.slice(start, end + 1));
    if (!Array.isArray(json)) return null;
    return json;
  } catch {
    return null;
  }
}

// =========================================================================
// Backfill — fetch un-scored or stale entries, score them, write back
// =========================================================================

export interface BackfillResult {
  scanned: number;
  scored: number;
  failed: number;
  batches: number;
  /** When `limit` cuts the scan short, this is true so the caller
   *  knows to re-run for the rest. */
  hasMore: boolean;
}

/**
 * Score every un-scored or stale cold_outreach_entries row in a
 * city campaign (or globally when cityCampaignId is omitted), up
 * to `limit` rows in a single invocation. Stale = score older than
 * RESCORE_AFTER_DAYS days.
 *
 * Designed to be re-runnable: each call processes one operator's
 * batch (default 200 rows = 10 batches of 20), then returns. The
 * UI surfaces a "Score more" button to chain calls when hasMore.
 */
export async function backfillLeadScores(opts: {
  staffId: string;
  /** Limit on entries scanned per invocation. Default 200. */
  limit?: number;
  /** Optional city-campaign scope. Omit to backfill globally
   *  (admin operation only — caller enforces). */
  cityCampaignId?: string;
}): Promise<BackfillResult> {
  const limit = Math.min(opts.limit ?? 200, 500);
  const staleBefore = new Date(Date.now() - RESCORE_AFTER_DAYS * 86_400_000);

  // Find candidates: never scored OR scored more than 30 days ago.
  const baseWhere = or(
    isNull(coldOutreachEntries.aiLeadScore),
    lt(coldOutreachEntries.aiLeadScoreAt, staleBefore),
  );
  const whereClause = opts.cityCampaignId
    ? and(baseWhere, eq(coldOutreachEntries.cityCampaignId, opts.cityCampaignId))
    : baseWhere;

  const candidates = await db
    .select({
      entryId: coldOutreachEntries.id,
      venueId: coldOutreachEntries.venueId,
      venueName: venues.name,
      cityName: cities.name,
      region: cities.region,
      venueType: venues.venueType,
      capacity: venues.capacity,
      email: venues.email,
      phoneE164: venues.phoneE164,
      websiteUrl: venues.websiteUrl,
      instagramHandle: venues.instagramHandle,
      hours: venues.hours,
      doNotContact: venues.doNotContact,
    })
    .from(coldOutreachEntries)
    .innerJoin(venues, eq(venues.id, coldOutreachEntries.venueId))
    .leftJoin(cities, eq(cities.id, venues.cityId))
    .where(whereClause)
    .limit(limit + 1); // +1 to detect hasMore

  const hasMore = candidates.length > limit;
  const toScore = candidates.slice(0, limit);
  let scored = 0;
  let failed = 0;
  let batches = 0;

  // Batch in groups of BATCH_SIZE.
  for (let i = 0; i < toScore.length; i += BATCH_SIZE) {
    const slice = toScore.slice(i, i + BATCH_SIZE);
    const batchInput: LeadScoreInput[] = slice.map((row) => ({
      entryId: row.entryId,
      venueName: row.venueName,
      cityName: row.cityName,
      region: row.region,
      venueType: row.venueType ?? [],
      capacity: row.capacity,
      email: row.email,
      phoneE164: row.phoneE164,
      websiteUrl: row.websiteUrl,
      instagramHandle: row.instagramHandle,
      hasHours: (row.hours?.trim().length ?? 0) > 0,
      doNotContact: row.doNotContact,
    }));
    const batchResult = await scoreLeadBatch({ staffId: opts.staffId, venues: batchInput });
    batches++;
    if (!batchResult.ok || batchResult.scored.length === 0) {
      failed += slice.length;
      // If rate-limited, abort the whole backfill — re-running
      // immediately would just hit the same limit. The operator
      // hits "Score more" later.
      if (batchResult.reason === "rate_limited") {
        return { scanned: toScore.length, scored, failed, batches, hasMore: true };
      }
      continue;
    }

    // Write the results. One UPDATE per row is fine at this batch
    // size — 20 rows × O(few ms) = negligible. Bulk update via
    // CASE WHEN would be premature optimization here.
    const now = new Date();
    for (const r of batchResult.scored) {
      await db
        .update(coldOutreachEntries)
        .set({
          aiLeadScore: r.score,
          aiLeadScoreReason: r.reason,
          aiLeadScoreAt: now,
        })
        .where(eq(coldOutreachEntries.id, r.entryId));
      scored++;
    }
    // Anything the model dropped from the batch (slice.length -
    // batchResult.scored.length) counts as failed for this run.
    failed += slice.length - batchResult.scored.length;
  }

  return {
    scanned: toScore.length,
    scored,
    failed,
    batches,
    hasMore,
  };
}
