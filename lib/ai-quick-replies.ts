import "server-only";

/**
 * AI smart-reply chips — Tier S #1 of the Haiku ROI sprint.
 *
 * Generates 3 one-tap reply suggestions for an inbox thread:
 *   1. A short positive/forward-motion reply
 *   2. A medium-length reply with one concrete detail
 *   3. A polite redirection (decline / ask-for-time / clarify)
 *
 * The operator sees them as tappable chips above the reply buttons.
 * Click → opens an inline reply composer pre-populated with that
 * text. Operator always edits before sending.
 *
 * Cost characteristics:
 *   - ~1500 input tokens (thread summary + last 5 messages truncated)
 *   - ~150 output tokens (3 chips, ≤280 chars each)
 *   - ~$0.0023/call with Haiku 4.5 at $1/$5 per MTok
 *
 * Guardrails:
 *   - Cached on email_threads.ai_quick_replies — generated ONCE
 *     per (thread, message_count) and re-used until a new message
 *     arrives
 *   - AI_QUICK_REPLIES_ENABLED env flag (kill switch)
 *   - Per-staff rate limit: 15/min (see lib/ai-guardrails.ts)
 *   - Skipped when classification is decline / unsubscribe / spam /
 *     auto_reply — those threads don't need a reply
 *   - Skipped when the latest message is OUTBOUND — no point
 *     suggesting replies to a thread the operator just sent into
 *   - Skipped when the thread has zero inbound messages
 *
 * Model: claude-haiku-4-5 — short text generation, structured
 * output, predictable cost.
 */

import { cities, emailMessages, emailThreads, venues } from "@/db/schema";
import { generateCompletion, isAiConfigured } from "@/lib/ai";
import { isAiFeatureEnabled, truncateForAi } from "@/lib/ai-guardrails";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { formatAsSystemPrompt, retrieveRelevantSections } from "@/lib/reference-retrieval";
import { retrieveReplyExamples } from "@/lib/reply-corpus";
import { desc, eq } from "drizzle-orm";

const QUICK_REPLY_MODEL = "claude-haiku-4-5-20251001";
const QUICK_REPLY_MAX_TOKENS = 320;

/** Per-message body cap (chars). Keeps total input around 1500
 *  tokens for a typical 5-message thread. */
const MESSAGE_BODY_CHAR_CAP = 800;
const MAX_MESSAGES_IN_CONTEXT = 5;

const REPLY_NEEDING_CLASSIFICATIONS = new Set([
  "interested",
  "warm",
  "confirmed",
  "question",
  "callback_requested",
  "unclassified",
]);

const SYSTEM_PROMPT = `You suggest 3 short tappable reply chips for a bar-crawl outreach
operator looking at an inbox thread with a venue (bar / restaurant /
lounge). The operator will tap one to pre-populate a reply draft,
then edit before sending.

Read the thread (oldest first; the LAST message is the inbound
that needs a reply). Return exactly 3 reply options:

  1. SHORT — under 100 chars. A "yes, let me do that" or
     "thanks, on it" forward-motion reply. Friendly, concise.

  2. MEDIUM — 100-220 chars. Includes one CONCRETE detail
     (a date, a specific question answered, a pricing/capacity
     hint). Still skimmable.

  3. POLITE REDIRECT — under 180 chars. Either a soft decline,
     a "let me check and get back" hold, or a "could you
     clarify X" — whichever fits the inbound best.

Voice: warm but professional, the way an operator on a 4-person
team would write at 9am. NO marketing-speak. NO emojis. NO
exclamation points. Match the venue's existing tone (formal
venues get a touch more formal, casual venues stay casual).

Format your response as ONLY a JSON object on one line, no
preamble:

  {"replies": ["short reply here", "medium reply here", "polite redirect here"]}

Constraints:
  - Each reply ≤ 280 chars (mobile-tappable).
  - Each reply is the BODY only — no subject, no signature,
    no "Hi NAME," opener (the operator's signature handles
    those). Start with the action / answer.
  - Use plain text, no markdown.
  - NEVER ask the venue whether they are hosting a costume party, a
    costume contest, or their own Halloween event. It confuses them
    (they may think WE are running a contest or some special thing). To
    surface what they have going, ask ONLY whether there is anything
    they would like us to mention to their guests, like drink specials
    or anything else they have on that night.
  - If the venue asked a specific question the operator
    couldn't possibly know the answer to (e.g. "what's
    your insurance carrier"), have reply 1 acknowledge +
    promise to send the info; reply 2 explicitly say
    "I'll dig that up and follow up by [tomorrow / next
    business day]"; reply 3 ask if they need anything
    else in the meantime.
  - The 3 replies must be MEANINGFULLY DIFFERENT — not 3
    rewordings of the same sentence. If you can't think of
    3 distinct angles, return 2 and one "Got it — I'll
    check and follow up shortly." as the third.
`;

interface QuickRepliesResult {
  replies: string[];
}

export interface QuickRepliesContext {
  threadId: string;
  /** message_count at time of generation — used as cache key. */
  messageCountAtGeneration: number;
}

/**
 * Fire-and-forget entry point used by the inbox thread page on
 * view. Catches everything and never throws.
 */
export async function generateQuickRepliesAsync(input: QuickRepliesContext): Promise<void> {
  try {
    await generateQuickReplies(input);
  } catch (err) {
    logger.error({ err, threadId: input.threadId }, "ai quick-replies failed (fire-and-forget)");
  }
}

/**
 * Actual generation. Idempotent — refuses to re-run if the
 * thread's message_count hasn't advanced since the last
 * generation. Caller (the page-load hook) checks the cache
 * column first but we re-check here defensively.
 */
export async function generateQuickReplies(input: QuickRepliesContext): Promise<void> {
  if (!isAiConfigured()) return;
  if (!isAiFeatureEnabled("quick_replies")) return;

  // Load thread + latest classification + last N messages
  const [thread] = await db
    .select({
      id: emailThreads.id,
      subject: emailThreads.subject,
      classification: emailThreads.classification,
      aiClassification: emailThreads.suggestedClassification,
      messageCount: emailThreads.messageCount,
      cachedMessageCount: emailThreads.aiQuickRepliesMessageCount,
      venueId: emailThreads.venueId,
      cityCampaignId: emailThreads.cityCampaignId,
    })
    .from(emailThreads)
    .where(eq(emailThreads.id, input.threadId))
    .limit(1);
  if (!thread) return;

  // Idempotency — re-running with the same message_count would
  // produce identical output for the same cost. Skip.
  if (thread.cachedMessageCount !== null && thread.cachedMessageCount >= thread.messageCount) {
    return;
  }

  // Classification gate. Threads classified as decline / unsubscribe
  // / spam / auto_reply don't need a reply; chips would be wasted
  // tokens. The operator-confirmed `classification` column wins
  // over AI suggestion when present.
  const effectiveClass = thread.classification ?? thread.aiClassification;
  if (effectiveClass && !REPLY_NEEDING_CLASSIFICATIONS.has(effectiveClass as string)) {
    return;
  }

  // Load last N messages (oldest first for readability)
  const recentMessages = await db
    .select({
      id: emailMessages.id,
      direction: emailMessages.direction,
      fromAddress: emailMessages.fromAddress,
      fromName: emailMessages.fromName,
      bodyText: emailMessages.bodyText,
      sentAt: emailMessages.sentAt,
    })
    .from(emailMessages)
    .where(eq(emailMessages.threadId, input.threadId))
    .orderBy(desc(emailMessages.sentAt))
    .limit(MAX_MESSAGES_IN_CONTEXT);

  if (recentMessages.length === 0) return;
  const latest = recentMessages[0];
  if (!latest || latest.direction === "outbound") {
    // No point suggesting replies to a thread where we just sent —
    // the operator isn't waiting on themselves.
    return;
  }

  // Venue context (just name + city, enough for tone calibration)
  let venueLabel = "venue";
  if (thread.venueId) {
    const venueRow = await db
      .select({
        venueName: venues.name,
        cityName: cities.name,
      })
      .from(venues)
      .leftJoin(cities, eq(cities.id, venues.cityId))
      .where(eq(venues.id, thread.venueId))
      .limit(1);
    if (venueRow[0]) {
      venueLabel = venueRow[0].cityName
        ? `${venueRow[0].venueName} (${venueRow[0].cityName})`
        : venueRow[0].venueName;
    }
  }

  // Build the prompt. Messages reversed back to oldest-first for
  // the model so the conversation flow reads naturally.
  const chronological = [...recentMessages].reverse();
  const messagesBlock = chronological
    .map((m) => {
      const role = m.direction === "inbound" ? "VENUE" : "OPERATOR";
      const who = m.fromName ?? m.fromAddress ?? "(unknown)";
      const body = truncateForAi(m.bodyText ?? "", MESSAGE_BODY_CHAR_CAP);
      return `--- ${role} (${who}) ---\n${body}`;
    })
    .join("\n\n");

  const userPrompt = `Thread subject: ${truncateForAi(thread.subject ?? "(no subject)", 200)}
Venue: ${truncateForAi(venueLabel, 120)}

Conversation (oldest first):

${messagesBlock}

Return the JSON object with exactly 3 reply chips.`;

  // Reference-Doc grounding (Phase 2.9). When the inbound is a QUESTION,
  // ground the suggested responses in the engine's actual policies (slot
  // times, pricing, FAQ answers) so the chips quote real specifics instead of
  // inventing them. Retrieval is curated -> semantic -> FTS; degrades to the
  // ungrounded prompt if nothing is found. Only for questions to bound cost.
  // [ReferenceDoc 8.5]
  let systemPrompt = SYSTEM_PROMPT;
  if (effectiveClass === "question") {
    try {
      const sections = await retrieveRelevantSections({
        task: "suggest_response",
        query: truncateForAi(latest.bodyText ?? thread.subject ?? "", 600),
        topK: 4,
      });
      const grounding = formatAsSystemPrompt(sections);
      if (grounding.trim()) {
        systemPrompt = `${grounding}\n\n${SYSTEM_PROMPT}`;
      }
    } catch (err) {
      logger.warn(
        { err, threadId: input.threadId },
        "suggest_response retrieval failed; using ungrounded prompt",
      );
    }
  }

  // Learning loop (2026-06-11): ground the chips in how the team's
  // senior operators ACTUALLY answered similar venue messages. Cheap
  // FTS retrieval (no embedding call) so it runs for every class; the
  // example ids ride the cache so the composer can record whether the
  // operator kept, edited or rewrote the suggestion (feedback loop).
  const corpusExamples = await retrieveReplyExamples(latest.bodyText ?? thread.subject ?? "", 3);
  const corpusExampleIds = corpusExamples.map((e) => e.id);
  if (corpusExamples.length > 0) {
    const corpusBlock = [
      "Real replies your senior teammates sent to SIMILAR venue messages.",
      "Match their substance, specifics and tone — adapt names/dates to THIS thread, never copy stale details:",
      ...corpusExamples.map(
        (e, i) =>
          `[${i + 1}]${e.outcome === "confirmed" ? " (venue went on to CONFIRM)" : ""} VENUE WROTE: ${e.inboundText.replace(/\s+/g, " ").slice(0, 300)}\n    TEAMMATE REPLIED: ${e.replyText.replace(/\s+/g, " ").slice(0, 500)}`,
      ),
    ].join("\n");
    systemPrompt = `${systemPrompt}\n\n${corpusBlock}`;
  }

  const start = Date.now();
  const aiResult = await generateCompletion({
    system: systemPrompt,
    prompt: userPrompt,
    model: QUICK_REPLY_MODEL,
    maxTokens: QUICK_REPLY_MAX_TOKENS,
    tag: "ai-quick-replies",
  });
  const elapsedMs = Date.now() - start;

  if (!aiResult.ok) {
    logger.warn(
      { threadId: input.threadId, reason: aiResult.reason, elapsedMs },
      "ai quick-replies completion failed",
    );
    return;
  }

  // Parse the JSON. The model is pretty good but the response can
  // include stray prose around the JSON if it forgot the rule.
  const parsed = parseQuickRepliesResponse(aiResult.text);
  if (!parsed || parsed.replies.length === 0) {
    logger.warn(
      { threadId: input.threadId, raw: aiResult.text.slice(0, 200) },
      "ai quick-replies JSON parse failed",
    );
    return;
  }

  // Sanity-check + cap each reply
  const safeReplies = parsed.replies
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter((s) => s.length > 0)
    .slice(0, 3)
    .map((s) => (s.length > 320 ? `${s.slice(0, 317)}...` : s));

  if (safeReplies.length === 0) return;

  await db
    .update(emailThreads)
    .set({
      // v2 shape: chips + the corpus example ids that grounded them
      // (feedback loop). Readers normalize v1 string[] caches too.
      aiQuickReplies: { v: 2 as const, chips: safeReplies, exampleIds: corpusExampleIds },
      aiQuickRepliesAt: new Date(),
      aiQuickRepliesMessageCount: thread.messageCount,
    })
    .where(eq(emailThreads.id, input.threadId));

  logger.info(
    {
      threadId: input.threadId,
      elapsedMs,
      replyCount: safeReplies.length,
      avgLen: Math.round(safeReplies.reduce((s, r) => s + r.length, 0) / safeReplies.length),
    },
    "ai quick-replies generated",
  );
}

/** Parse model output into the 3-reply structure. Defensive
 *  against models that wrap JSON in backticks or add a preamble. */
function parseQuickRepliesResponse(raw: string): QuickRepliesResult | null {
  if (!raw) return null;
  // Extract first { ... } block — handles backtick fences + preamble.
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const json = JSON.parse(raw.slice(start, end + 1));
    if (json && Array.isArray(json.replies)) {
      return { replies: json.replies };
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Whether the thread has cached chips ready to show. Cheap check
 * the inbox page can use before deciding to render the chip strip.
 *
 * Caller passes the row's cached fields (already in scope on the
 * thread page) — no extra DB hit.
 */
export function hasCachedQuickReplies(thread: {
  aiQuickReplies: unknown;
  aiQuickRepliesMessageCount: number | null;
  messageCount: number;
}): boolean {
  if (!thread.aiQuickReplies) return false;
  if (!Array.isArray(thread.aiQuickReplies) || thread.aiQuickReplies.length === 0) return false;
  if (
    thread.aiQuickRepliesMessageCount !== null &&
    thread.aiQuickRepliesMessageCount < thread.messageCount
  ) {
    // Stale — there's a newer message the chips don't account for.
    return false;
  }
  return true;
}

/**
 * Whether the thread is eligible to GENERATE chips. The inbox page
 * uses this to decide whether to fire generateQuickRepliesAsync on
 * view. Returns false when chips already exist (use hasCachedQuickReplies)
 * or when the thread doesn't need a reply.
 */
export function isEligibleForQuickReplies(thread: {
  messageCount: number;
  classification: string | null;
  aiClassification: string | null;
  aiQuickRepliesMessageCount: number | null;
}): boolean {
  if (!isAiConfigured()) return false;
  if (!isAiFeatureEnabled("quick_replies")) return false;
  if (thread.messageCount === 0) return false;
  // Direction check happens inside generateQuickReplies — it loads
  // the latest message and skips when it's outbound. Doing it there
  // avoids a duplicate DB hit here on the page.
  // Skip when up-to-date cache exists (caller should call
  // hasCachedQuickReplies first; this is a defensive belt-and-
  // suspenders).
  if (
    thread.aiQuickRepliesMessageCount !== null &&
    thread.aiQuickRepliesMessageCount >= thread.messageCount
  ) {
    return false;
  }
  const cls = thread.classification ?? thread.aiClassification;
  if (cls && !REPLY_NEEDING_CLASSIFICATIONS.has(cls)) return false;
  return true;
}
