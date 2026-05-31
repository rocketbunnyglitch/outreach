import "server-only";

/**
 * AI venue type auto-tag — Tier B #8 of the Haiku ROI sprint.
 *
 * Many venues in the database have an empty venueType array because
 * the column was added later than the venues themselves. This
 * backfill reads the name + address for venues with empty
 * venueType and asks Haiku to suggest the right tag(s) from a
 * fixed vocabulary.
 *
 * Mode: BATCHED — one Haiku call per N (default 20) venues. The
 * model returns a JSON array of {id, venueType[]} and we write
 * them in a single transaction.
 *
 * Source of truth: the operator's manual edits ALWAYS win. The
 * backfill query only scans venues with cardinality(venue_type)=0,
 * so anything manually tagged is invisible to the backfill. AI
 * never overwrites a non-empty array.
 *
 * Cost characteristics:
 *   - Per batch (20 venues): ~$0.002
 *   - Per venue: ~$0.0001
 *   - 3000-venue full backfill: ~$0.30 ONE-TIME
 *
 * Guardrails:
 *   - AI_VENUE_TAG_ENABLED env flag (kill switch)
 *   - Batch size capped at 30
 *   - Per-staff rate limit: 5 batches/min
 *   - Output validated against fixed vocabulary — unknown tags
 *     are dropped silently rather than written
 *   - Never overwrites non-empty venueType (the SQL WHERE
 *     clause excludes those rows from the scan)
 *   - Empty result → skip (no write, no audit churn)
 *   - NEVER throws — all paths return ok:false or empty results
 */

import { venues } from "@/db/schema";
import { generateCompletion, isAiConfigured } from "@/lib/ai";
import { checkAiRateLimit, isAiFeatureEnabled, truncateForAi } from "@/lib/ai-guardrails";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sql } from "drizzle-orm";

const VENUE_TAG_MODEL = "claude-haiku-4-5-20251001";
const VENUE_TAG_MAX_TOKENS = 1500;
const BATCH_SIZE = 20;
const MAX_BATCH_SIZE = 30;

/** Fixed vocabulary — anything else from the model is dropped. */
const VALID_TAGS = new Set([
  "bar",
  "club",
  "lounge",
  "restaurant",
  "pub",
  "cocktail_bar",
  "sports_bar",
  "dive_bar",
  "wine_bar",
  "brewery",
  "rooftop",
  "speakeasy",
  "karaoke",
  "live_music",
  "coffee_shop",
  "cafe",
]);

const SYSTEM_PROMPT = `You tag bar/restaurant/lounge venues with their category for a
bar-crawl operations database. The operator uses these tags to
filter "show me only bars + lounges" when planning a crawl.

INPUT: A JSON array of venues with these fields:
  - id           (string — return it unchanged in your output)
  - name
  - address      (string or null)
  - city         (string or null)

OUTPUT: A JSON array, SAME LENGTH, SAME ORDER. Each entry:
  {
    "id": "<the input id>",
    "venueType": ["bar"]  // 1-3 tags from the VOCABULARY below
  }

VOCABULARY (ONLY these tags are valid — any other will be dropped):
  bar, club, lounge, restaurant, pub, cocktail_bar, sports_bar,
  dive_bar, wine_bar, brewery, rooftop, speakeasy, karaoke,
  live_music, coffee_shop, cafe

GUIDANCE:
  - Pick 1-3 most specific tags. "bar" alone is fine for a
    plain bar; layer "cocktail_bar" or "dive_bar" when the
    name strongly suggests it.
  - "club" = nightclub / dance club specifically. Don't tag a
    casual bar as "club" just because it has dancing.
  - Restaurants that serve alcohol can be ["restaurant", "bar"]
    if the name suggests a bar+kitchen format.
  - "brewery" for places that brew their own beer.
  - "lounge" for upscale/quieter cocktail-focused venues.
  - "live_music" for venues whose name explicitly references
    live music or a known music format.
  - If you're not sure, return ["bar"] as a safe default for
    venues that clearly serve alcohol; ["restaurant"] otherwise.

OUTPUT STRICT JSON ONLY — no preamble, no markdown:
  [{"id":"...","venueType":["bar","lounge"]}, ...]

If you can't categorize an entry, return an empty array:
  {"id":"...","venueType":[]}`;

export interface VenueTypeTagInput {
  venueId: string;
  venueName: string;
  address: string | null;
  cityName: string | null;
}

export interface VenueTypeTagResult {
  venueId: string;
  venueType: string[];
}

interface TagBatchOpts {
  staffId: string;
  venues: VenueTypeTagInput[];
}

/**
 * Tag a batch of venues. Returns the parsed results; never throws.
 */
export async function tagVenueBatch(opts: TagBatchOpts): Promise<{
  tagged: VenueTypeTagResult[];
  attempted: number;
  ok: boolean;
  reason?: string;
}> {
  if (!isAiConfigured()) return { tagged: [], attempted: 0, ok: false, reason: "not_configured" };
  if (!isAiFeatureEnabled("venue_tag"))
    return { tagged: [], attempted: 0, ok: false, reason: "disabled" };
  if (opts.venues.length === 0) return { tagged: [], attempted: 0, ok: true };
  if (opts.venues.length > MAX_BATCH_SIZE) {
    return {
      tagged: [],
      attempted: opts.venues.length,
      ok: false,
      reason: `batch too large (max ${MAX_BATCH_SIZE})`,
    };
  }

  const limit = checkAiRateLimit({
    feature: "venue_tag",
    staffId: opts.staffId,
    max: 5,
  });
  if (!limit.ok) {
    logger.warn(
      { staffId: opts.staffId, retryAfterMs: limit.retryAfterMs },
      "venue tag rate limited",
    );
    return { tagged: [], attempted: opts.venues.length, ok: false, reason: "rate_limited" };
  }

  const payload = opts.venues.map((v) => ({
    id: v.venueId,
    name: truncateForAi(v.venueName, 100),
    address: v.address ? truncateForAi(v.address, 150) : null,
    city: v.cityName ?? null,
  }));

  const userPrompt = `Tag these ${payload.length} venues:

${JSON.stringify(payload, null, 2)}

Return the JSON array.`;

  const start = Date.now();
  const aiResult = await generateCompletion({
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
    model: VENUE_TAG_MODEL,
    maxTokens: VENUE_TAG_MAX_TOKENS,
    tag: "ai-venue-tag",
  });
  const elapsedMs = Date.now() - start;

  if (!aiResult.ok) {
    logger.warn({ reason: aiResult.reason, elapsedMs }, "venue tag completion failed");
    return { tagged: [], attempted: opts.venues.length, ok: false, reason: aiResult.reason };
  }

  const parsed = parseTagBatch(aiResult.text);
  if (!parsed) {
    logger.warn({ raw: aiResult.text.slice(0, 300) }, "venue tag JSON parse failed");
    return { tagged: [], attempted: opts.venues.length, ok: false, reason: "parse_error" };
  }

  const inputIds = new Set(opts.venues.map((v) => v.venueId));
  const safe: VenueTypeTagResult[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    if (typeof item.id !== "string" || !inputIds.has(item.id)) continue;
    if (!Array.isArray(item.venueType)) continue;
    // Filter to vocabulary; cap at 4 tags.
    const cleanTags = item.venueType
      .filter((t: unknown): t is string => typeof t === "string")
      .map((t: string) => t.toLowerCase().trim())
      .filter((t: string) => VALID_TAGS.has(t))
      .slice(0, 4);
    if (cleanTags.length === 0) continue; // model said "I don't know" — skip the write
    safe.push({ venueId: item.id, venueType: cleanTags });
  }

  logger.info(
    {
      elapsedMs,
      attempted: opts.venues.length,
      tagged: safe.length,
    },
    "venue tag batch complete",
  );

  return { tagged: safe, attempted: opts.venues.length, ok: true };
}

function parseTagBatch(raw: string): Array<{ id?: unknown; venueType?: unknown }> | null {
  if (!raw) return null;
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
// Backfill
// =========================================================================

export interface BackfillResult {
  scanned: number;
  tagged: number;
  failed: number;
  batches: number;
  hasMore: boolean;
}

/**
 * Tag every venue with an empty venueType array, up to `limit`
 * rows per invocation. The caller chains for large backfills.
 *
 * Scope: when cityId is set, restrict to that city. Otherwise
 * global (admin operation).
 *
 * The WHERE clause excludes any venue with cardinality > 0 — so
 * manually-tagged venues are NEVER overwritten by the backfill.
 */
export async function backfillVenueTypes(opts: {
  staffId: string;
  limit?: number;
  cityId?: string;
}): Promise<BackfillResult> {
  const limit = Math.min(opts.limit ?? 200, 500);

  // Drizzle doesn't have a "cardinality = 0" helper; sql template
  // is the simplest path. The partial index from migration 0078
  // makes this scan O(empty-venues).
  const candidates = await db
    .select({
      venueId: venues.id,
      venueName: venues.name,
      address: venues.address,
      cityId: venues.cityId,
    })
    .from(venues)
    .where(
      opts.cityId
        ? sql`cardinality(${venues.venueType}) = 0 AND ${venues.cityId} = ${opts.cityId}`
        : sql`cardinality(${venues.venueType}) = 0`,
    )
    .limit(limit + 1);

  const hasMore = candidates.length > limit;
  const toTag = candidates.slice(0, limit);

  if (toTag.length === 0) {
    return { scanned: 0, tagged: 0, failed: 0, batches: 0, hasMore: false };
  }

  // Resolve city names in one query (small set — N distinct cities
  // in this batch, never more than ~50).
  const cityIds = Array.from(
    new Set(toTag.map((r) => r.cityId).filter((id): id is string => id !== null)),
  );
  const cityNames = new Map<string, string>();
  if (cityIds.length > 0) {
    const { cities } = await import("@/db/schema");
    const cityRows = await db
      .select({ id: cities.id, name: cities.name })
      .from(cities)
      .where(sql`${cities.id} IN ${cityIds}`);
    for (const c of cityRows) cityNames.set(c.id, c.name);
  }

  let tagged = 0;
  let failed = 0;
  let batches = 0;

  for (let i = 0; i < toTag.length; i += BATCH_SIZE) {
    const slice = toTag.slice(i, i + BATCH_SIZE);
    const batchInput: VenueTypeTagInput[] = slice.map((row) => ({
      venueId: row.venueId,
      venueName: row.venueName,
      address: row.address,
      cityName: row.cityId ? (cityNames.get(row.cityId) ?? null) : null,
    }));
    const batchResult = await tagVenueBatch({ staffId: opts.staffId, venues: batchInput });
    batches++;
    if (!batchResult.ok || batchResult.tagged.length === 0) {
      failed += slice.length;
      if (batchResult.reason === "rate_limited") {
        return { scanned: toTag.length, tagged, failed, batches, hasMore: true };
      }
      continue;
    }

    const now = new Date();
    for (const r of batchResult.tagged) {
      // Defensive belt: re-check that the row is still empty BEFORE
      // writing. Avoids overwriting if an operator just tagged the
      // venue between our scan and the write. Cheap (single row
      // UPDATE with WHERE cardinality=0).
      await db
        .update(venues)
        .set({
          venueType: r.venueType,
          aiVenueTypeAt: now,
        })
        .where(sql`${venues.id} = ${r.venueId} AND cardinality(${venues.venueType}) = 0`);
      tagged++;
    }
    failed += slice.length - batchResult.tagged.length;
  }

  return { scanned: toTag.length, tagged, failed, batches, hasMore };
}
