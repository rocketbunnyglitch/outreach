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
 * Generic single-turn completion. Returns the assistant text or null
 * on any error so callers can show a graceful "couldn't generate"
 * state instead of throwing.
 *
 * Errors are forwarded to Sentry via captureException with the
 * provided tag so we can spot patterns in production (rate limits,
 * timeouts, content policy refusals).
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
  /** 0..1; lower = more deterministic. Default 0.7. */
  temperature?: number;
}): Promise<string | null> {
  const client = getClient();
  if (!client) return null;

  const start = Date.now();
  try {
    const response = await client.messages.create({
      model: opts.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL,
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: opts.temperature ?? 0.7,
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

    return text.trim() || null;
  } catch (err) {
    await captureException(err, { tag: opts.tag, elapsed_ms: Date.now() - start });
    return null;
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
  /** Prior outreach attempts to this venue, oldest first. */
  history: Array<{
    channel: string;
    outcome: string;
    notes: string | null;
    daysAgo: number;
  }>;
}): Promise<{ subject: string; body: string } | null> {
  const isFollowUp = input.history.some((h) => h.channel === "email");
  const lastEmail = input.history.find((h) => h.channel === "email");

  const system = `You are a polished outreach assistant for a bar-crawl events company. Your job is to draft warm, professional, concise outreach emails to bar/restaurant venues that the company wants to partner with for their bar crawls.

Style rules:
- Subject lines: <60 chars, specific, no clickbait
- Body: 100-180 words total. Three short paragraphs max.
- Tone: friendly business peer, not salesy. Match the voice of a small-business owner reaching out to another small-business owner.
- Always mention: who we are, what we're proposing, expected attendance + revenue impact, what we need from them, a soft next-step CTA.
- Never make up specifics we don't have (don't fabricate dates, capacity numbers, or past relationships).
- If this is a follow-up, acknowledge the prior touch lightly and offer fresh value.
- End with the sender's first name only — no signature block (the system appends one).

Output format: return ONLY a JSON object on a single line with two keys: "subject" and "body". The body should use \\n\\n for paragraph breaks. No markdown, no preamble, no apologies. Just the JSON.`;

  const roleHint =
    input.intendedRole === "unspecified"
      ? "We'd be open to slotting them as a wristband-pickup venue (early in the night), a middle stop, or a final destination — whichever fits their vibe."
      : `We're hoping to slot them as a ${input.intendedRole.replace("_", " ")} venue in the crawl.`;

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

${historyHint}

This is ${isFollowUp ? `a follow-up (last email ~${lastEmail?.daysAgo}d ago)` : "a first-touch email"}.

Draft the email now.`;

  const text = await generateCompletion({
    system,
    prompt,
    tag: "outreach_draft",
    maxTokens: 600,
    temperature: 0.75,
  });
  if (!text) return null;

  // Strip code fences if Claude wrapped the JSON despite the instructions
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as { subject?: string; body?: string };
    if (!parsed.subject || !parsed.body) return null;
    return { subject: parsed.subject.trim(), body: parsed.body.trim() };
  } catch (err) {
    await captureException(err, { tag: "outreach_draft_parse", rawSample: cleaned.slice(0, 200) });
    return null;
  }
}
