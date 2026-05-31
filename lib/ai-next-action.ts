import "server-only";

/**
 * AI-enriched next action — Phase A.4.
 *
 * The rule-based suggestNextAction in lib/suggested-next-action.ts
 * is great for the "easy" cases (decline → archive, unsubscribe →
 * archive, callback_requested → create task). It handles 80% of
 * threads with zero AI cost and zero latency.
 *
 * This module ADDS on top: for threads where the rule-based
 * suggestion is "reply" (interested / warm / question — the
 * ambiguous cases), we ask Claude to draft a concrete one-sentence
 * recommendation that includes WHO to mention, WHAT to send, and
 * WHEN to ship by — informed by:
 *   - the AI summary of the thread (Phase A.3)
 *   - any extracted promises with action dates (Phase A.2)
 *   - the venue's communication history
 *
 * Output is a strict superset of the rule-based result: same
 * SuggestedAction shape, but `reason` is richer and includes a
 * specific recommendation rather than a generic "they're
 * interested" line.
 *
 * Fire-and-forget pattern, cached on the thread row. Same lazy
 * regeneration as the summary — generated once per
 * (message_count, classification) combo, served from cache
 * otherwise.
 *
 * Cost: ~$0.0005 per thread per (re-)generation. Lazy enough
 * that monthly spend stays under $1.
 */

import { cities, emailMessages, emailThreads, venues } from "@/db/schema";
import { generateCompletion, isAiConfigured } from "@/lib/ai";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { and, desc, eq } from "drizzle-orm";

const ACTION_MODEL = "claude-haiku-4-5-20251001";
const ACTION_MAX_TOKENS = 200;

/** Threads with this classification (or higher signal) get the
 *  AI enrichment. Decline / unsubscribe / spam / auto_reply
 *  threads use the rule-based suggestion directly — no value in
 *  burning tokens to say "archive this." */
const ENRICHABLE_CLASSIFICATIONS = new Set([
  "interested",
  "warm",
  "confirmed",
  "question",
  "callback_requested",
]);

const SYSTEM_PROMPT = `You're advising an outreach operator on what to do next with a
cold-outreach email thread to a bar/restaurant venue. The thread
has been classified (interested / warm / confirmed / question /
callback_requested) and you have the full thread context.

Return a single JSON object on one line:

  {
    "label": "<2-5 word imperative button label — 'Reply with hours',
              'Confirm Friday Oct 26', 'Ask for owner intro'>",
    "reason": "<one sentence, max 30 words, telling the operator
                EXACTLY what to do and why — name dates, mention
                specific things from the thread, reference the
                venue contact if known. NO generic advice.>",
    "urgency": "<one of: 'now' | 'today' | 'this_week' | 'when_able'>"
  }

Rules:
  - reason must be ACTIONABLE. Bad: "They're interested, reply
    with details." Good: "Send pricing tier B + the Oct 26 slot
    by tomorrow morning — they asked twice."
  - Reference specific facts from the thread when possible: dates
    they mentioned, names, prior offers, hesitations.
  - For 'confirmed' threads: focus on next operational step
    (calendar lock, send poster, etc.), not "thank them for
    confirming."
  - For 'question' threads: name the question briefly in the
    reason so the operator knows what to answer.
  - urgency = 'now' only when they're waiting on a reply RIGHT
    NOW (asked yesterday or earlier). 'today' for active back-
    and-forth from the last 24h. 'this_week' for warm but not
    pressing. 'when_able' for nice-to-haves.
  - Output the JSON object only. No markdown fences, no prose.`;

export interface EnrichedAction {
  label: string;
  reason: string;
  urgency: "now" | "today" | "this_week" | "when_able";
  /** Timestamp the suggestion was generated. */
  generatedAt: Date;
}

interface EnrichInput {
  threadId: string;
}

/**
 * Async entry point — fire-and-forget. Returns void. Use from
 * page loaders that should trigger background refresh.
 */
export async function enrichNextActionAsync(input: EnrichInput): Promise<void> {
  try {
    await enrichNextAction(input);
  } catch (err) {
    logger.error({ err, threadId: input.threadId }, "[ai-next-action] failed");
  }
}

/**
 * Generate + persist an enriched next-action suggestion.
 * Returns the parsed result or null if generation was skipped.
 */
export async function enrichNextAction(input: EnrichInput): Promise<EnrichedAction | null> {
  if (!isAiConfigured()) return null;

  const threadRow = await db
    .select({
      id: emailThreads.id,
      subject: emailThreads.subject,
      classification: emailThreads.classification,
      state: emailThreads.state,
      messageCount: emailThreads.messageCount,
      aiSummary: emailThreads.aiSummary,
      // Cached enriched action — used as an idempotency check.
      cachedAction: emailThreads.aiNextAction,
      cachedAtMessageCount: emailThreads.aiNextActionMessageCount,
      venueName: venues.name,
      cityName: cities.name,
    })
    .from(emailThreads)
    .leftJoin(venues, eq(venues.id, emailThreads.venueId))
    .leftJoin(cities, eq(cities.id, venues.cityId))
    .where(eq(emailThreads.id, input.threadId))
    .limit(1);

  const t = threadRow[0];
  if (!t) return null;

  // Only enrich classifications that benefit from AI nuance.
  // Decline / unsubscribe / spam / auto_reply / unclassified
  // use the rule-based suggestion directly.
  if (!ENRICHABLE_CLASSIFICATIONS.has(t.classification)) return null;

  // Closed/archived threads don't need a next action.
  if (
    t.state === "closed_won" ||
    t.state === "closed_lost" ||
    t.state === "closed_dnc" ||
    t.state === "archived"
  ) {
    return null;
  }

  // Cache check: if the thread hasn't grown since the last
  // enrichment AND the classification is unchanged, skip.
  // (We store classification in the cached_action payload so
  // changes to it invalidate the cache.)
  const cached = t.cachedAction as
    | (EnrichedAction & { classification?: string })
    | null
    | undefined;
  if (
    cached &&
    t.cachedAtMessageCount === t.messageCount &&
    cached.classification === t.classification
  ) {
    return null;
  }

  // Last 8 messages chronologically for context.
  const history = await db
    .select({
      direction: emailMessages.direction,
      sentAt: emailMessages.sentAt,
      fromAddress: emailMessages.fromAddress,
      bodyText: emailMessages.bodyText,
    })
    .from(emailMessages)
    .where(and(eq(emailMessages.threadId, input.threadId)))
    .orderBy(desc(emailMessages.sentAt))
    .limit(8);

  const historyChrono = history.reverse();

  const prompt = buildPrompt({
    venueName: t.venueName ?? null,
    cityName: t.cityName ?? null,
    subject: t.subject ?? "",
    classification: t.classification,
    aiSummary: t.aiSummary as { headline: string; context: string; next: string } | null,
    messages: historyChrono.map((m) => ({
      direction: m.direction,
      from: m.fromAddress,
      text: truncate(m.bodyText ?? "", 800),
    })),
  });

  const result = await generateCompletion({
    system: SYSTEM_PROMPT,
    prompt,
    tag: "inbox_next_action",
    model: ACTION_MODEL,
    maxTokens: ACTION_MAX_TOKENS,
  });

  if (!result.ok) {
    logger.warn(
      { threadId: input.threadId, reason: result.reason },
      "[ai-next-action] model call failed",
    );
    return null;
  }

  const parsed = parseActionJson(result.text);
  if (!parsed) {
    logger.warn(
      { threadId: input.threadId, raw: result.text.slice(0, 200) },
      "[ai-next-action] could not parse model output",
    );
    return null;
  }

  // Persist with the classification baked in so future cache
  // checks can detect classification changes.
  await db
    .update(emailThreads)
    .set({
      aiNextAction: {
        ...parsed,
        generatedAt: new Date(),
        classification: t.classification,
      } as Record<string, unknown>,
      aiNextActionAt: new Date(),
      aiNextActionMessageCount: t.messageCount,
    })
    .where(eq(emailThreads.id, input.threadId));

  logger.info(
    {
      threadId: input.threadId,
      classification: t.classification,
      urgency: parsed.urgency,
    },
    "[ai-next-action] enriched",
  );

  return { ...parsed, generatedAt: new Date() };
}

// =========================================================================
// Helpers
// =========================================================================

interface PromptParts {
  venueName: string | null;
  cityName: string | null;
  subject: string;
  classification: string;
  aiSummary: { headline: string; context: string; next: string } | null;
  messages: Array<{ direction: string; from: string | null; text: string }>;
}

function buildPrompt(parts: PromptParts): string {
  const lines: string[] = [];
  lines.push(`Venue: ${parts.venueName ?? "(unmatched)"}`);
  if (parts.cityName) lines.push(`City: ${parts.cityName}`);
  lines.push(`Subject: ${parts.subject}`);
  lines.push(`Classification: ${parts.classification}`);
  lines.push("");
  if (parts.aiSummary) {
    lines.push("EXISTING AI SUMMARY (use as input, don't repeat):");
    lines.push(`  Headline: ${parts.aiSummary.headline}`);
    lines.push(`  Context: ${parts.aiSummary.context}`);
    lines.push(`  Prior next-step: ${parts.aiSummary.next}`);
    lines.push("");
  }
  lines.push("RECENT THREAD (oldest first):");
  for (const m of parts.messages) {
    lines.push(`  [${m.direction.toUpperCase()}] ${m.from ?? "?"}`);
    lines.push(`  ${m.text.split("\n").join("\n  ")}`);
    lines.push("");
  }
  lines.push("Return the JSON action now.");
  return lines.join("\n");
}

interface ParsedAction {
  label: string;
  reason: string;
  urgency: "now" | "today" | "this_week" | "when_able";
}

const VALID_URGENCY = new Set(["now", "today", "this_week", "when_able"]);

function parseActionJson(raw: string): ParsedAction | null {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const p = parsed as Record<string, unknown>;
  const label = typeof p.label === "string" ? p.label.trim() : "";
  const reason = typeof p.reason === "string" ? p.reason.trim() : "";
  const urgency = typeof p.urgency === "string" ? p.urgency.trim() : "";
  if (!label || !reason) return null;
  if (!VALID_URGENCY.has(urgency)) return null;
  return {
    label: label.slice(0, 60),
    reason: reason.slice(0, 280),
    urgency: urgency as ParsedAction["urgency"],
  };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 20)}\n…[truncated ${s.length - max + 20} chars]…`;
}
