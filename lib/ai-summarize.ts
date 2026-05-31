import "server-only";

/**
 * AI thread summary — Phase A.3.
 *
 * For long threads (10+ messages), generates a 3-line summary
 * that operators can read in 5 seconds instead of scrolling
 * through the whole conversation. Cached on the thread row so
 * we don't pay the model cost per page load.
 *
 * Generation strategy:
 *   - Triggered lazily by the inbox page when a thread is
 *     viewed AND messageCount >= SUMMARY_MIN_MESSAGES AND
 *     (summary is stale OR new messages since last summary)
 *   - Background-generated via the same fire-and-forget
 *     pattern as classify/extract
 *   - Result writes to email_threads.ai_summary +
 *     ai_summary_at + ai_summary_message_count
 *   - Page re-renders on next visit (or after a refresh) with
 *     the summary present
 *
 * NOT triggered on every ingest — we'd waste tokens generating
 * summaries for threads no one's looking at. Lazy on-view is
 * the right cost/value tradeoff.
 *
 * Model: claude-haiku-4-5. Summaries are 50-100 output tokens
 * over a few thousand input tokens. ~$0.001/summary worst case.
 */

import { cities, emailMessages, emailThreads, venues } from "@/db/schema";
import { generateCompletion, isAiConfigured } from "@/lib/ai";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { and, asc, eq } from "drizzle-orm";

const SUMMARY_MODEL = "claude-haiku-4-5-20251001";
const SUMMARY_MAX_TOKENS = 240;

/** Threads with fewer messages than this don't get summaries —
 *  there's nothing to summarize. The thread itself is already
 *  fast to read. */
export const SUMMARY_MIN_MESSAGES = 10;

const SYSTEM_PROMPT = `You summarize cold-outreach email threads between an
outreach team and bar/restaurant venues. The thread is a series
of messages (inbound + outbound, oldest first).

Output a tight 3-line summary in this exact JSON shape:

  {
    "headline": "<one sentence, max 20 words, capturing the
                  current state of the conversation>",
    "context": "<one sentence, max 25 words, on the key facts
                 from the thread — venue, decisions, dates>",
    "next": "<one sentence, max 20 words, on what the operator
              should do next or what they're waiting for>"
  }

Rules:
  - All three fields required.
  - Each value is a single sentence — no lists, no bullets.
  - Use past tense for what HAS happened, present/future for
    next steps.
  - If the thread is dormant (no recent activity), say so in
    "next" and suggest a follow-up.
  - If the venue has declined or unsubscribed, say so in
    "headline" and use "next" to suggest closing the thread.
  - Don't repeat facts across fields.
  - Don't include any markdown, prose, or code fences. Just
    the JSON object.`;

interface SummaryInput {
  threadId: string;
}

interface SummaryResult {
  headline: string;
  context: string;
  next: string;
}

export interface ThreadSummary {
  headline: string;
  context: string;
  next: string;
  generatedAt: Date;
  messageCount: number;
}

/**
 * Async entry point — never throws. Use from page loaders that
 * want to trigger a refresh without blocking the render.
 */
export async function summarizeThreadAsync(input: SummaryInput): Promise<void> {
  try {
    await summarizeThread(input);
  } catch (err) {
    logger.error({ err, threadId: input.threadId }, "[ai-summarize] failed");
  }
}

/**
 * Generates and persists a thread summary. Returns null when
 * the AI isn't configured or the thread is below the minimum
 * message count.
 */
export async function summarizeThread(input: SummaryInput): Promise<SummaryResult | null> {
  if (!isAiConfigured()) return null;

  const threadRow = await db
    .select({
      id: emailThreads.id,
      subject: emailThreads.subject,
      messageCount: emailThreads.messageCount,
      venueName: venues.name,
      cityName: cities.name,
      currentSummaryMessageCount: emailThreads.aiSummaryMessageCount,
    })
    .from(emailThreads)
    .leftJoin(venues, eq(venues.id, emailThreads.venueId))
    .leftJoin(cities, eq(cities.id, venues.cityId))
    .where(eq(emailThreads.id, input.threadId))
    .limit(1);

  const t = threadRow[0];
  if (!t) return null;
  if (t.messageCount < SUMMARY_MIN_MESSAGES) return null;

  // Idempotency: skip if the existing summary covers the same
  // message count. Cheap check — saves the model call when the
  // thread hasn't grown since the last summary.
  if (t.currentSummaryMessageCount === t.messageCount) {
    logger.debug(
      { threadId: input.threadId, messageCount: t.messageCount },
      "[ai-summarize] skip — summary up to date",
    );
    return null;
  }

  // Pull every message in chronological order. Capped at 40
  // messages — beyond that we'd blow the input window and the
  // summary gets generic anyway. Most "long" threads are
  // 10-25 messages.
  const messages = await db
    .select({
      direction: emailMessages.direction,
      sentAt: emailMessages.sentAt,
      fromAddress: emailMessages.fromAddress,
      subject: emailMessages.subject,
      bodyText: emailMessages.bodyText,
    })
    .from(emailMessages)
    .where(and(eq(emailMessages.threadId, input.threadId)))
    .orderBy(asc(emailMessages.sentAt))
    .limit(40);

  if (messages.length < SUMMARY_MIN_MESSAGES) return null;

  const prompt = buildPrompt({
    venueName: t.venueName ?? null,
    cityName: t.cityName ?? null,
    subject: t.subject ?? "",
    messages: messages.map((m) => ({
      direction: m.direction,
      from: m.fromAddress,
      text: truncate(m.bodyText ?? "", 600),
    })),
  });

  const result = await generateCompletion({
    system: SYSTEM_PROMPT,
    prompt,
    tag: "inbox_summarize",
    model: SUMMARY_MODEL,
    maxTokens: SUMMARY_MAX_TOKENS,
  });

  if (!result.ok) {
    logger.warn(
      { threadId: input.threadId, reason: result.reason },
      "[ai-summarize] model call failed",
    );
    return null;
  }

  const parsed = parseSummaryJson(result.text);
  if (!parsed) {
    logger.warn(
      { threadId: input.threadId, raw: result.text.slice(0, 200) },
      "[ai-summarize] could not parse model output",
    );
    return null;
  }

  await db
    .update(emailThreads)
    .set({
      aiSummary: parsed,
      aiSummaryAt: new Date(),
      aiSummaryMessageCount: t.messageCount,
    })
    .where(eq(emailThreads.id, input.threadId));

  logger.info(
    { threadId: input.threadId, messageCount: t.messageCount },
    "[ai-summarize] summary written",
  );

  return parsed;
}

// =========================================================================
// Helpers
// =========================================================================

interface PromptParts {
  venueName: string | null;
  cityName: string | null;
  subject: string;
  messages: Array<{
    direction: string;
    from: string | null;
    text: string;
  }>;
}

function buildPrompt(parts: PromptParts): string {
  const lines: string[] = [];
  lines.push(`Venue: ${parts.venueName ?? "(unmatched)"}`);
  if (parts.cityName) lines.push(`City: ${parts.cityName}`);
  lines.push(`Subject: ${parts.subject}`);
  lines.push("");
  lines.push("THREAD (oldest first):");
  for (const m of parts.messages) {
    lines.push(`  [${m.direction.toUpperCase()}] from ${m.from ?? "?"}`);
    lines.push(`  ${m.text.split("\n").join("\n  ")}`);
    lines.push("");
  }
  lines.push("Return the JSON summary now.");
  return lines.join("\n");
}

function parseSummaryJson(raw: string): SummaryResult | null {
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
  const headline = typeof p.headline === "string" ? p.headline.trim() : "";
  const context = typeof p.context === "string" ? p.context.trim() : "";
  const next = typeof p.next === "string" ? p.next.trim() : "";
  if (!headline || !context || !next) return null;
  return {
    headline: headline.slice(0, 240),
    context: context.slice(0, 280),
    next: next.slice(0, 240),
  };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 20)}\n…[truncated ${s.length - max + 20} chars]…`;
}
