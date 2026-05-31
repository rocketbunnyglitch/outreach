import "server-only";

/**
 * Claude (Anthropic) client wrapper for AI-assisted outreach drafting.
 *
 * Used by the cold-outreach UI to generate personalized first-touch
 * emails, follow-ups, and SMS copy given venue + campaign context.
 * The operator reviews + edits before sending — never auto-sends.
 *
 * Why we wrap the SDK directly here instead of plumbing it through
 * every caller:
 *   • Graceful no-op when ANTHROPIC_API_KEY isn't set (matches the
 *     Quo / Eventbrite / ZeroBounce / Places pattern in this codebase)
 *   • Single place to set model defaults so we can upgrade
 *     Claude Opus 4.7 → 4.8 → 5 etc. without touching every caller
 *   • Single place to enforce token + cost limits per call
 *   • Centralized prompt context (we add a system preamble about the
 *     bar-crawl business so every call gets the right voice)
 *
 * Activation:
 *   ANTHROPIC_API_KEY=sk-ant-...
 *   ANTHROPIC_MODEL=claude-opus-4-7              (optional override)
 *   pm2 reload outreach --update-env
 */

import { captureException, logger } from "@/lib/logger";
import Anthropic from "@anthropic-ai/sdk";

const DEFAULT_MODEL = "claude-opus-4-7";
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Machine-readable reason codes for AI failures. Operator-facing UIs
 * can branch on these to show targeted messages and recovery hints.
 * See classifyAiError for which HTTP statuses map to which reason.
 */
export type AiReason =
  | "not_configured" // ANTHROPIC_API_KEY env var is missing
  | "empty_response" // Claude returned nothing or all-whitespace
  | "auth" // 401/403 from Anthropic
  | "rate_limit" // 429 from Anthropic
  | "overloaded" // 529 (Anthropic-specific) or generic 503
  | "timeout" // AbortSignal expired client-side
  | "network" // connection error before response
  | "bad_request" // 400 — model name wrong, prompt too long, etc.
  | "model_error" // 500/502 from Anthropic
  | "parse_error" // got text back but failed to extract JSON
  | "unknown"; // anything else

/**
 * Result of a Claude call. The `reason` field on failure tells the
 * caller WHY it failed — operator-facing UIs can show "set
 * ANTHROPIC_API_KEY" vs "Anthropic API returned 429" vs "model timed
 * out", instead of a generic "AI failed" message.
 *
 * Per CLAUDE.md §12.4 (no silent failures), every failure path here
 * must populate a reason + log via captureException.
 */
export type AiResult =
  | { ok: true; text: string }
  | {
      ok: false;
      reason: AiReason;
      /**
       * Short, operator-facing message safe to surface in the UI.
       * Don't include stack traces; do include "request_id: abc-123"
       * when available for log lookup.
       */
      message: string;
    };

export function isAiConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/**
 * Lazy singleton — the SDK constructor is cheap but we hold a single
 * instance to share the connection pool across calls. Reset when
 * ANTHROPIC_API_KEY changes (won't happen at runtime, but defensive).
 */
let _client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!isAiConfigured()) return null;
  if (!_client) {
    _client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      timeout: DEFAULT_TIMEOUT_MS,
    });
  }
  return _client;
}

/**
 * Classify an SDK error into our AiResult.reason taxonomy.
 *
 * The Anthropic SDK throws subclasses of APIError; we read `.status`
 * to bucket. Anything we don't recognize falls into 'unknown' with
 * a best-effort message.
 *
 * Per CLAUDE.md §12.4 — every error path must produce a specific
 * reason string, not a silent null.
 */
function classifyAiError(err: unknown): { reason: AiReason; message: string } {
  // Anthropic SDK errors expose .status + .name
  const e = err as { status?: number; name?: string; message?: string; request_id?: string };
  const reqIdSuffix = e?.request_id ? ` (request_id: ${e.request_id})` : "";

  if (e?.name === "AbortError") {
    return { reason: "timeout", message: `Anthropic call timed out after ${DEFAULT_TIMEOUT_MS}ms` };
  }
  if (typeof e?.status === "number") {
    if (e.status === 401 || e.status === 403) {
      return {
        reason: "auth",
        message: `Anthropic returned ${e.status} — ANTHROPIC_API_KEY is invalid or revoked${reqIdSuffix}`,
      };
    }
    if (e.status === 429) {
      return { reason: "rate_limit", message: `Anthropic rate limit hit (429)${reqIdSuffix}` };
    }
    if (e.status === 529) {
      return {
        reason: "overloaded",
        message: `Anthropic overloaded (529) — try again${reqIdSuffix}`,
      };
    }
    if (e.status === 503) {
      return { reason: "overloaded", message: `Anthropic service unavailable (503)${reqIdSuffix}` };
    }
    if (e.status === 400) {
      return {
        reason: "bad_request",
        message: `Anthropic returned 400: ${e.message ?? "bad request"}${reqIdSuffix}`,
      };
    }
    if (e.status >= 500) {
      return {
        reason: "model_error",
        message: `Anthropic server error (${e.status})${reqIdSuffix}`,
      };
    }
  }
  // ECONNREFUSED, ENOTFOUND, etc.
  if (e?.message && /(ECONNREFUSED|ENOTFOUND|fetch failed|ETIMEDOUT)/i.test(e.message)) {
    return { reason: "network", message: `Network error: ${e.message}` };
  }
  return {
    reason: "unknown",
    message: e?.message
      ? `Anthropic call failed: ${e.message}${reqIdSuffix}`
      : "Anthropic call failed",
  };
}

/**
 * Generic single-turn completion. Returns AiResult so the caller can
 * branch on the specific failure reason (auth vs rate limit vs
 * timeout). All errors are still captured to Sentry via the tag.
 */
export async function generateCompletion(opts: {
  /** System prompt — sets context for every turn. */
  system: string;
  /** User-facing prompt — the actual request. */
  prompt: string;
  /** Sentry-friendly tag like 'outreach_draft' or 'venue_suggestions'. */
  tag: string;
  /** Override the default Opus model for fast/cheap calls. */
  model?: string;
  /** Lower for shorter responses; default 1024 tokens. */
  maxTokens?: number;
  /** @deprecated no-op — current model rejects temperature. Kept for compat. */
  temperature?: number;
}): Promise<AiResult> {
  const client = getClient();
  if (!client) {
    return {
      ok: false,
      reason: "not_configured",
      message:
        "ANTHROPIC_API_KEY is not set on the server. Add it to /var/www/outreach/.env and restart the app.",
    };
  }

  const start = Date.now();
  try {
    // NOTE: `temperature` is intentionally NOT sent. The current default
    // model (claude-opus-4-7) deprecates the temperature parameter and
    // returns 400 "`temperature` is deprecated for this model" if it's
    // included. The opts.temperature field is kept for backwards compat
    // but is a no-op. If a future model override needs it again, gate it
    // on the model name here.
    const response = await client.messages.create({
      model: opts.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL,
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: opts.system,
      messages: [{ role: "user", content: opts.prompt }],
    });

    const elapsedMs = Date.now() - start;
    logger.info(
      {
        tag: opts.tag,
        model: response.model,
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        elapsed_ms: elapsedMs,
        stop_reason: response.stop_reason,
      },
      "claude completion",
    );

    // Concatenate text blocks. Tool-use blocks aren't expected here.
    const text = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .filter(Boolean)
      .join("\n");

    const trimmed = text.trim();
    if (!trimmed) {
      return {
        ok: false,
        reason: "empty_response",
        message: `Claude returned no text (stop_reason: ${response.stop_reason ?? "unknown"})`,
      };
    }
    return { ok: true, text: trimmed };
  } catch (err) {
    await captureException(err, { tag: opts.tag, elapsed_ms: Date.now() - start });
    const { reason, message } = classifyAiError(err);
    return { ok: false, reason, message };
  }
}

/**
 * Streaming variant of generateCompletion.
 *
 * Returns an AsyncIterable<string> of text deltas (or null when AI
 * isn't configured). The caller is responsible for assembling the
 * full response and any cleanup; this helper just yields tokens as
 * they arrive from the SDK.
 *
 * Error handling: errors are CAUGHT inside the iterator and yielded
 * as a final {kind:'error', message} sentinel so streaming consumers
 * (SSE routes) can serialize them across the wire without dropping
 * the connection mid-flight. Successful streams end naturally when
 * the SDK closes the iterator.
 */
export type StreamChunk =
  | { kind: "text"; text: string }
  | { kind: "error"; reason: AiReason; message: string }
  | { kind: "done" };

export async function* streamCompletion(opts: {
  system: string;
  prompt: string;
  tag: string;
  maxTokens?: number;
  model?: string;
}): AsyncGenerator<StreamChunk, void, unknown> {
  const client = getClient();
  if (!client) {
    yield {
      kind: "error",
      reason: "not_configured",
      message: "ANTHROPIC_API_KEY is not set on the server.",
    };
    return;
  }

  const start = Date.now();
  try {
    const stream = client.messages.stream({
      model: opts.model ?? DEFAULT_MODEL,
      max_tokens: opts.maxTokens ?? 1024,
      system: opts.system,
      messages: [{ role: "user", content: opts.prompt }],
    });

    for await (const event of stream) {
      // The SDK emits a typed event union; we only care about
      // content_block_delta events with text deltas. Tool-use and
      // other event kinds are ignored.
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta" &&
        typeof event.delta.text === "string"
      ) {
        yield { kind: "text", text: event.delta.text };
      }
    }
    yield { kind: "done" };
  } catch (err) {
    await captureException(err, { tag: opts.tag, elapsed_ms: Date.now() - start });
    const { reason, message } = classifyAiError(err);
    yield { kind: "error", reason, message };
  }
}

/**
 * Generate a personalized cold-outreach email draft for a specific
 * venue. The operator reviews + edits the result before sending —
 * AI never autonomously sends.
 *
 * Inputs include past outreach history (when available) so the model
 * can adjust tone for a first-touch vs follow-up vs final attempt,
 * and won't generate copy that contradicts what the staff already said.
 */
export async function draftOutreachEmail(input: {
  venue: {
    name: string;
    address: string | null;
    capacity: number | null;
  };
  city: {
    name: string;
    region: string | null;
  };
  campaign: {
    name: string;
    brandName: string;
    senderName: string;
  };
  /** What role the operator wants this venue to play in a crawl. */
  intendedRole: "wristband" | "middle" | "final" | "alt_final" | "unspecified";
  /** Earliest crawl date in the city — gives the email urgency framing. */
  upcomingCrawlDate: string | null;
  /**
   * Per-upcoming-event slot availability for this city campaign.
   * Each row says "on date X, role Y still has N open slots".
   * Used so the draft pitches a slot type that's actually OPEN —
   * if the wristband for Sept 14 is taken but a middle is open,
   * the email proposes middle instead of pitching wristband.
   *
   * If empty, the prompt falls back to generic flexibility language.
   */
  slotInventory: Array<{
    eventDate: string;
    dayPart: string | null;
    openWristband: number;
    openMiddle: number;
    openFinal: number;
  }>;
  /** Prior outreach attempts to this venue, oldest first. */
  history: Array<{
    channel: string;
    outcome: string;
    notes: string | null;
    daysAgo: number;
  }>;
  /**
   * Quality tier for the draft (Haiku ROI sprint #4):
   *   - "fast"   = Haiku 4.5. Default. ~5x cheaper than Opus, near-
   *                Sonnet quality for templated cold outreach. Used
   *                for first-pass drafts and the bulk-AI-draft modal.
   *   - "polish" = Opus 4.7. Used when the operator clicks "Polish
   *                with Opus" on a specific draft they want to ship
   *                clean. ~5x more expensive, slower, but better at
   *                long-tail nuance.
   * Default "fast" — operators edit every draft anyway, and the bulk
   * modal can fire dozens of drafts per session.
   */
  quality?: "fast" | "polish";
}): Promise<
  | { ok: true; data: { subject: string; body: string } }
  | { ok: false; reason: AiReason; message: string }
> {
  const isFollowUp = input.history.some((h) => h.channel === "email");
  const lastEmail = input.history.find((h) => h.channel === "email");

  const system = `You are a polished outreach assistant for a bar-crawl events company. Your job is to draft warm, professional, concise outreach emails to bar/restaurant venues that the company wants to partner with for their bar crawls.

Style rules:
- Subject lines: <60 chars, specific, no clickbait
- Body: 100-180 words total. Three short paragraphs max.
- Tone: friendly business peer, not salesy. Match the voice of a small-business owner reaching out to another small-business owner.
- Always mention: who we are, what we're proposing, expected attendance + revenue impact, what we need from them, a soft next-step CTA.
- Never make up specifics we don't have (don't fabricate dates, capacity numbers, or past relationships).
- When the prompt provides a slot inventory, ground the pitch in WHICH slots are actually open on WHICH dates. Don't propose a slot type that's marked taken across all dates. If everything is taken, frame the email as building a relationship for the next campaign instead.
- If this is a follow-up, acknowledge the prior touch lightly and offer fresh value.
- End with the sender's first name only — no signature block (the system appends one).

Output format: return ONLY a JSON object on a single line with two keys: "subject" and "body". The body should use \\n\\n for paragraph breaks. No markdown, no preamble, no apologies. Just the JSON.`;

  // Build a slot-inventory hint that tells Claude what's actually open.
  // Three branches:
  //   1. operator specified a role AND that role is open on some date → pitch it
  //   2. operator specified a role but it's closed everywhere → pitch any open alternative + note the gap
  //   3. operator left it unspecified → list whatever's open across dates
  const totalOpen = input.slotInventory.reduce(
    (acc, ev) => ({
      wristband: acc.wristband + ev.openWristband,
      middle: acc.middle + ev.openMiddle,
      final: acc.final + ev.openFinal,
    }),
    { wristband: 0, middle: 0, final: 0 },
  );

  // Pretty per-date string for the prompt.
  const inventoryLines = input.slotInventory
    .map((ev) => {
      const parts: string[] = [];
      if (ev.openWristband > 0) parts.push(`${ev.openWristband} wristband`);
      if (ev.openMiddle > 0) parts.push(`${ev.openMiddle} middle`);
      if (ev.openFinal > 0) parts.push(`${ev.openFinal} final`);
      const summary = parts.length > 0 ? parts.join(", ") : "no open slots (every slot filled)";
      const date = ev.dayPart ? `${ev.eventDate} (${ev.dayPart.replace("_", " ")})` : ev.eventDate;
      return `  - ${date}: ${summary}`;
    })
    .join("\n");

  let roleHint: string;
  if (input.intendedRole === "unspecified") {
    if (input.slotInventory.length === 0) {
      roleHint =
        "We don't have specific crawl dates locked in for this city yet — pitch the partnership at a high level and propose finding a slot together.";
    } else {
      const openSummary: string[] = [];
      if (totalOpen.wristband > 0) openSummary.push("wristband-pickup (early in the night)");
      if (totalOpen.middle > 0) openSummary.push("middle stop");
      if (totalOpen.final > 0) openSummary.push("final destination");
      if (openSummary.length === 0) {
        roleHint =
          "All slots in our current crawls are filled — pitch this as building a relationship for the next campaign rather than the current one.";
      } else {
        roleHint = `We have openings for ${openSummary.join(", ")}. Suggest the slot that best fits their vibe (e.g. a high-energy late spot for final, a casual early venue for wristband).`;
      }
    }
  } else {
    // Operator specified a role. Check if it's actually open.
    const roleKey =
      input.intendedRole === "wristband"
        ? "openWristband"
        : input.intendedRole === "middle"
          ? "openMiddle"
          : "openFinal";
    const datesWithRoleOpen = input.slotInventory.filter((ev) => ev[roleKey] > 0);

    if (datesWithRoleOpen.length > 0) {
      const dateList = datesWithRoleOpen
        .slice(0, 3)
        .map((ev) => ev.eventDate)
        .join(", ");
      roleHint = `We're hoping to slot them as a ${input.intendedRole.replace("_", " ")} venue. Open ${input.intendedRole.replace("_", " ")} slots on: ${dateList}.`;
    } else {
      // The requested role is closed everywhere. Pivot to whatever IS open.
      const alternatives: string[] = [];
      if (totalOpen.wristband > 0) alternatives.push("wristband-pickup");
      if (totalOpen.middle > 0) alternatives.push("middle stop");
      if (totalOpen.final > 0) alternatives.push("final destination");
      if (alternatives.length === 0) {
        roleHint = `We originally hoped for a ${input.intendedRole.replace("_", " ")} slot, but every slot in our current crawls is filled. Pitch this as building a relationship for the next campaign.`;
      } else {
        roleHint = `The ${input.intendedRole.replace("_", " ")} slot is taken on every current crawl date, so don't lead with that — instead pitch ${alternatives.join(" or ")} as the available option.`;
      }
    }
  }

  const inventoryHint =
    input.slotInventory.length > 0
      ? `\nCrawl slot inventory (current campaign):\n${inventoryLines}\n`
      : "";

  const historyHint =
    input.history.length === 0
      ? "No prior outreach to this venue."
      : `Prior outreach history (most recent first):\n${input.history
          .map(
            (h) =>
              `  - ${h.daysAgo}d ago: ${h.channel} → ${h.outcome}${h.notes ? ` (${h.notes.slice(0, 120)})` : ""}`,
          )
          .join("\n")}`;

  const prompt = `Draft a cold-outreach email to this venue.

Venue:
  Name: ${input.venue.name}
  Address: ${input.venue.address ?? "(not provided)"}
  Capacity: ${input.venue.capacity ?? "(unknown)"}
  City: ${input.city.name}${input.city.region ? `, ${input.city.region}` : ""}

Campaign:
  Brand: ${input.campaign.brandName}
  Campaign: ${input.campaign.name}
  Sender (first name): ${input.campaign.senderName}
  Upcoming crawl date: ${input.upcomingCrawlDate ?? "(no specific date yet — soon)"}

Intent: ${roleHint}
${inventoryHint}
${historyHint}

This is ${isFollowUp ? `a follow-up (last email ~${lastEmail?.daysAgo}d ago)` : "a first-touch email"}.

Draft the email now.`;

  const result = await generateCompletion({
    system,
    prompt,
    // Haiku for "fast" (default) → ~5x cheaper than Opus, plenty
    // good for templated cold outreach the operator edits anyway.
    // Opus for "polish" → operator pressed the dedicated button on
    // a draft they want to ship clean. The bulk-AI-draft modal
    // doesn't set quality so it inherits "fast".
    model:
      input.quality === "polish"
        ? undefined // = DEFAULT_MODEL (claude-opus-4-7)
        : "claude-haiku-4-5-20251001",
    tag: input.quality === "polish" ? "outreach_draft_polish" : "outreach_draft",
    maxTokens: 600,
  });
  if (!result.ok) return { ok: false, reason: result.reason, message: result.message };

  // Strip code fences if Claude wrapped the JSON despite the instructions
  const cleaned = result.text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as { subject?: string; body?: string };
    if (!parsed.subject || !parsed.body) {
      return {
        ok: false,
        reason: "parse_error",
        message: "Claude returned JSON but missing subject or body fields",
      };
    }
    return { ok: true, data: { subject: parsed.subject.trim(), body: parsed.body.trim() } };
  } catch (err) {
    await captureException(err, { tag: "outreach_draft_parse", rawSample: cleaned.slice(0, 200) });
    return {
      ok: false,
      reason: "parse_error",
      message: `Claude returned non-JSON output: ${cleaned.slice(0, 80)}…`,
    };
  }
}

/**
 * Rank candidate venues (from Places API) for a city campaign by
 * crawl-fit, with per-venue reasoning the operator can use to make
 * the final call.
 *
 * Claude evaluates each candidate against:
 *   • Vibe match with already-confirmed venues in this city (a crawl
 *     should feel coherent, not a random mix)
 *   • Proximity to confirmed venues (walkability matters for crawls)
 *   • Capacity (wristband=150+, middle=80-200, final=100-300)
 *   • Rating + review count as a quality signal
 *   • The slot the operator is trying to fill (if hinted)
 *
 * Returns a parallel array to the input — same length, ordered by
 * Claude's preference, each with a 1-sentence reasoning. Falls back
 * to rating-sort + empty reasoning when Claude isn't configured or
 * the call fails.
 */
export interface RankedCandidate {
  googlePlaceId: string;
  rank: number;
  /** 1-2 sentence rationale tailored to this venue's role in the crawl. */
  reasoning: string;
  /** Claude's confidence 0-1. 1.0 fallback when AI not used. */
  fitScore: number;
}

export async function rankVenueCandidates(input: {
  city: { name: string; region: string | null };
  /** Confirmed venues already in this city's crawls — Claude uses these
      as a reference for what "fits". */
  confirmed: Array<{ name: string; slotKind: string | null; capacity: number | null }>;
  /** Candidate venues from Places API (already de-duped against existing). */
  candidates: Array<{
    googlePlaceId: string;
    name: string;
    formattedAddress: string | null;
    rating: number | null;
    userRatingCount: number | null;
    types: string[];
  }>;
  /** Optional slot hint to focus the ranking. */
  slotKind?: "wristband" | "middle" | "final" | null;
}): Promise<RankedCandidate[]> {
  // Local fallback: rating-sort, no AI commentary
  function fallback(): RankedCandidate[] {
    return [...input.candidates]
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
      .map((c, i) => ({
        googlePlaceId: c.googlePlaceId,
        rank: i + 1,
        reasoning: "",
        fitScore: 1,
      }));
  }

  if (!isAiConfigured() || input.candidates.length === 0) return fallback();

  // Cap input size so we stay under token budget
  const candidatesForPrompt = input.candidates.slice(0, 30);

  const slotContext = (() => {
    switch (input.slotKind) {
      case "wristband":
        return "WRISTBAND PICKUP venue (early in the night, needs capacity 150+ to handle the inbound check-in surge, ideally space to spread out, good for first impressions)";
      case "middle":
        return "MIDDLE stop (capacity 80-200, energetic vibe, drinks-focused, ideally close to other confirmed venues so attendees can walk)";
      case "final":
        return "FINAL destination (capacity 100-300, party energy, dance floor or late-night vibe, can hold the crowd for 2-3 hours)";
      default:
        return "any open slot — be flexible";
    }
  })();

  const confirmedRef =
    input.confirmed.length === 0
      ? "  (no confirmed venues yet in this city — first one we're placing)"
      : input.confirmed
          .map(
            (v) =>
              `  • ${v.name}${v.slotKind ? ` (${v.slotKind})` : ""}${v.capacity ? ` cap ${v.capacity}` : ""}`,
          )
          .join("\n");

  const candidateLines = candidatesForPrompt
    .map(
      (c, i) =>
        `  ${i + 1}. ${c.name}${c.rating ? ` ★${c.rating}` : ""}${c.userRatingCount ? ` (${c.userRatingCount} reviews)` : ""}${c.formattedAddress ? ` — ${c.formattedAddress}` : ""}${c.types.length ? ` [${c.types.slice(0, 3).join(", ")}]` : ""}`,
    )
    .join("\n");

  const system = `You are a venue-scouting analyst for a themed bar-crawl events company. You evaluate candidate venues from a list and rank them by how well they'd fit into a bar crawl in a specific city, given what's already been confirmed for that crawl.

Your goal is to help the operator focus their cold-outreach effort on the candidates most likely to be a good crawl partner. Be opinionated — surface real differences. Lean on capacity, vibe coherence with confirmed venues, walkability, and review signal.

Return ONLY a JSON array — no preamble, no markdown — where each element has:
  • googlePlaceId (string, from input)
  • rank (number, 1 = best fit)
  • reasoning (string, 1-2 short sentences explaining why — be specific about THIS venue, not generic)
  • fitScore (number 0-1, your confidence)

Include EVERY candidate from the input. Use rank to order them. If a candidate seems clearly wrong (way too small, wrong vibe, low ratings), still include it but rank it last with honest reasoning.`;

  const prompt = `City: ${input.city.name}${input.city.region ? `, ${input.city.region}` : ""}

Looking to fill: ${slotContext}

Confirmed venues in this crawl already:
${confirmedRef}

Candidate venues (from Places API, ${candidatesForPrompt.length} total):
${candidateLines}

Rank these candidates now. Return the JSON array.`;

  const result = await generateCompletion({
    system,
    prompt,
    tag: "venue_ranking",
    maxTokens: 2048,
  });
  if (!result.ok) {
    // Suggest-venues already has a graceful fallback (rating-sorted
    // candidates). Log the reason so the operator can see WHY ranking
    // didn't happen in the UI badge.
    return fallback();
  }
  const text = result.text;

  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as Array<{
      googlePlaceId?: string;
      rank?: number;
      reasoning?: string;
      fitScore?: number;
    }>;

    if (!Array.isArray(parsed)) return fallback();

    // Normalize + dedupe + ensure every input candidate appears (Claude
    // sometimes drops some). Fill missing with rating fallback.
    const seen = new Set<string>();
    const ranked: RankedCandidate[] = [];
    for (const item of parsed) {
      if (!item.googlePlaceId || seen.has(item.googlePlaceId)) continue;
      const stillExists = input.candidates.some((c) => c.googlePlaceId === item.googlePlaceId);
      if (!stillExists) continue;
      seen.add(item.googlePlaceId);
      ranked.push({
        googlePlaceId: item.googlePlaceId,
        rank: item.rank ?? ranked.length + 1,
        reasoning: (item.reasoning ?? "").trim(),
        fitScore: Math.max(0, Math.min(1, item.fitScore ?? 0.5)),
      });
    }
    // Append any candidates Claude omitted, rating-sorted, at the end
    const missing = input.candidates
      .filter((c) => !seen.has(c.googlePlaceId))
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    for (const m of missing) {
      ranked.push({
        googlePlaceId: m.googlePlaceId,
        rank: ranked.length + 1,
        reasoning: "",
        fitScore: 0.3,
      });
    }
    // Final sort by rank just in case Claude returned unordered
    ranked.sort((a, b) => a.rank - b.rank);
    return ranked.map((r, i) => ({ ...r, rank: i + 1 }));
  } catch (err) {
    await captureException(err, {
      tag: "venue_ranking_parse",
      rawSample: cleaned.slice(0, 200),
    });
    return fallback();
  }
}
