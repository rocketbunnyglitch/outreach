import "server-only";

/**
 * AI inbound classifier — Phase A.1.
 *
 * Runs on every newly-ingested inbound message and writes a
 * suggested classification to the thread (NOT the source-of-truth
 * `classification` column — that stays operator-confirmed).
 *
 * Usage from the poll worker:
 *
 *   await classifyInboundMessageAsync({
 *     threadId, messageId, teamId,
 *   });
 *
 * The function is fire-and-forget for the poll worker: it never
 * throws, never blocks ingest, and silently no-ops when the AI
 * is not configured (no ANTHROPIC_API_KEY). Errors are logged.
 *
 * Why this lives in its own module + not inline in the poll
 * worker:
 *   - The classifier needs venue context (which the worker
 *     doesn't already have loaded) and a structured prompt.
 *   - Keeps the poll worker focused on Gmail I/O.
 *   - Easy to call manually from a backfill script later.
 *
 * Model: claude-haiku-4-5 — classification is a tiny ~10-token
 * output and Haiku handles it in ~300ms at fraction-of-a-cent
 * cost. Opus is overkill here.
 */

import { cities, classifierRuns, emailMessages, emailThreads, venues } from "@/db/schema";
import { generateCompletion, isAiConfigured } from "@/lib/ai";
import { syncColdStatusFromClassificationAsync } from "@/lib/ai-auto-status";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { formatAsSystemPrompt, retrieveRelevantSections } from "@/lib/reference-retrieval";
import { retrieveClassificationExamples } from "@/lib/reply-corpus";
import { autoFlagRelationshipFromClassification } from "@/lib/venue-relationships";
import { and, desc, eq } from "drizzle-orm";

const CLASSIFIER_MODEL = "claude-haiku-4-5-20251001";
const CLASSIFIER_MAX_TOKENS = 80;

/**
 * Confidence floor for acting on an auto-classification without human triage
 * (Reference Doc 8.4: act only at >=90%). Below this, the suggestion is still
 * written but the thread is flagged needs_attention for the worklist. We do NOT
 * auto-write the operator-confirmed `classification` even at high confidence:
 * the engine keeps a human in the loop (suggestion + one-click confirm), per
 * the reconciliation addendum (classifier writes suggested_* only). The >=90%
 * downstream auto-transitions (cancellation/opt-out) are greenfield Phase 4.x.
 * [ReferenceDoc 8.4]
 */
const CONFIDENCE_AUTO_ACT_THRESHOLD = 0.9;

/** Set of valid classifications the model can return. Matches the
 *  reply_classification enum exactly — anything outside this list
 *  is rejected. */
const VALID_CLASSIFICATIONS = [
  "interested",
  "warm",
  "confirmed",
  "question",
  "callback_requested",
  "decline",
  "unsubscribe",
  "auto_reply",
  "spam",
  "stalled_warm",
  "cancelled_by_them",
] as const;

type Classification = (typeof VALID_CLASSIFICATIONS)[number];

interface ClassifierResult {
  classification: Classification;
  confidence: number;
  reasoning: string;
}

const SYSTEM_PROMPT = `You classify replies to cold outreach emails from bar/restaurant venues
about hosting bar-crawl events. The reply is the LAST message in a thread
between an outreach team and a venue owner/manager.

Your job: read the inbound reply (plus thread context) and return ONE
classification from this exact list, with a 0..1 confidence:

  interested          — Venue wants to know more / asks follow-up questions
                        about pricing, dates, capacity, but hasn't committed.
                        "Sounds good, can you send more details?" → interested.

  warm                — Stronger than interested: venue indicates positive
                        intent, leans toward yes, but no firm date/contract.
                        "We'd love to host, let's set up a call." → warm.

  confirmed           — Venue has explicitly agreed to host the event. There
                        is a date or terms locked in. "Yes, we're in for
                        Oct 26." → confirmed.

  question            — Venue asks a specific question that needs a direct
                        answer before they can decide. "What's the bar minimum?
                        Do you bring your own staff?" → question.

  callback_requested  — Venue asks the team to call them, or proposes a
                        specific time to talk. "Call me at 555-1234 after
                        2pm." → callback_requested.

  decline             — Venue passes, no longer interested, or already booked
                        with a competitor. "Not a fit this year, thanks." →
                        decline.

  unsubscribe         — Venue asks to be removed from the list / never
                        contacted again. "Stop emailing me." → unsubscribe.

  auto_reply          — Out-of-office, vacation responder, bounce-back from
                        an autoresponder. Usually no real human author.

  spam                — The reply itself is unrelated marketing, phishing,
                        or noise. Rare on cold-outreach threads.

  stalled_warm        - A thread that was previously interested/warm has gone
                        quiet or keeps deferring without a no: "let me check
                        and get back to you" that never lands, repeated "not
                        sure yet." Use ONLY when the prior thread shows earlier
                        positive intent; a fresh pass is "decline," not this.

  cancelled_by_them   - The venue had agreed/confirmed and is now backing out:
                        "we have to cancel," "we can no longer host." Distinct
                        from "decline" (which is a no BEFORE any agreement).

Tie-breaker rules:
  - If the reply both asks a question AND signals interest, prefer
    "interested" or "warm" over "question" — the intent matters more
    than the surface form.
  - "Sure, send me your pricing" reads as interested, not question, because
    the verb is "send me" (action request), not "what is the price?"
  - Only return "confirmed" when there is concrete acceptance plus a
    locked-in date. Otherwise prefer "warm."
  - When you're not sure between two, prefer the more conservative one
    (warm over confirmed, interested over warm).

Output format: a JSON object on a single line, nothing else.

  {"classification":"<one of the values>","confidence":0.85,"reasoning":"<one-sentence rationale, max 30 words>"}

Do NOT include any text before or after the JSON. Do NOT wrap in
markdown code fences. Do NOT explain — the reasoning field IS your
explanation, in <=30 words.`;

interface ClassifyInput {
  threadId: string;
  messageId: string;
  teamId: string;
}

/**
 * Async entry point — never throws. Use from the Gmail poll
 * worker right after inbound message insert.
 */
export async function classifyInboundMessageAsync(input: ClassifyInput): Promise<void> {
  try {
    await classifyInboundMessage(input);
  } catch (err) {
    logger.error(
      { err, threadId: input.threadId, messageId: input.messageId },
      "[ai-classify] failed",
    );
  }
}

/**
 * Sync entry point — throws on failure. Used by manual
 * reclassify actions where we want to know if it failed.
 */
export async function classifyInboundMessage(
  input: ClassifyInput,
): Promise<ClassifierResult | null> {
  if (!isAiConfigured()) return null;

  // Load the target message + last ~6 prior messages for context.
  const messageRow = await db
    .select({
      id: emailMessages.id,
      threadId: emailMessages.threadId,
      direction: emailMessages.direction,
      sentAt: emailMessages.sentAt,
      fromAddress: emailMessages.fromAddress,
      subject: emailMessages.subject,
      bodyText: emailMessages.bodyText,
    })
    .from(emailMessages)
    .where(eq(emailMessages.id, input.messageId))
    .limit(1);

  const msg = messageRow[0];
  if (!msg) return null;
  if (msg.direction !== "inbound") return null;
  if (!msg.bodyText || msg.bodyText.trim().length === 0) return null;

  // Recent thread context — last 6 messages, oldest first so the
  // model reads it like a transcript.
  const history = await db
    .select({
      direction: emailMessages.direction,
      sentAt: emailMessages.sentAt,
      fromAddress: emailMessages.fromAddress,
      subject: emailMessages.subject,
      bodyText: emailMessages.bodyText,
    })
    .from(emailMessages)
    .where(and(eq(emailMessages.threadId, input.threadId)))
    .orderBy(desc(emailMessages.sentAt))
    // 4 (target + 3 prior) is plenty of context to classify the latest reply;
    // more just inflates input tokens on every call.
    .limit(4);

  // Reverse to chronological.
  const historyChrono = history.reverse();

  // Venue + city context (if attached).
  const threadCtx = await db
    .select({
      venueId: emailThreads.venueId,
      outreachBrandId: emailThreads.outreachBrandId,
      venueName: venues.name,
      cityName: cities.name,
    })
    .from(emailThreads)
    .leftJoin(venues, eq(venues.id, emailThreads.venueId))
    .leftJoin(cities, eq(cities.id, venues.cityId))
    .where(eq(emailThreads.id, input.threadId))
    .limit(1);

  const ctx = threadCtx[0];

  const prompt = buildPrompt({
    venueName: ctx?.venueName ?? null,
    cityName: ctx?.cityName ?? null,
    history: historyChrono.map((h) => ({
      direction: h.direction,
      from: h.fromAddress,
      subject: h.subject,
      text: truncate(h.bodyText ?? "", 700),
    })),
    target: {
      from: msg.fromAddress,
      subject: msg.subject,
      text: truncate(msg.bodyText ?? "", 2000),
    },
  });

  // Reference-doc grounding (RAG) is OPT-IN. It prepends up to 4 retrieved
  // reference-doc sections to every classification call, which is the single
  // biggest input-token cost per call AND triggers an OpenAI embedding call for
  // the query — multiplied across every inbound reply. The static SYSTEM_PROMPT
  // below already encodes the full classification rubric, so the grounding is
  // largely redundant for cost-sensitive steady-state. Enable with
  // AI_CLASSIFY_RAG_ENABLED=1 if you want the doc-grounded variant back.
  // [ReferenceDoc 6.3 + 8.4]
  const ragEnabled = process.env.AI_CLASSIFY_RAG_ENABLED === "1";
  const retrieved = ragEnabled
    ? await retrieveRelevantSections({
        task: "classify_reply",
        query: truncate(msg.bodyText ?? "", 1000),
        topK: 4,
      })
    : [];
  const retrievedCodes = retrieved.map((s) => s.sectionCode);

  // Learning loop (2026-06-11): few-shot from the team's OWN labeled
  // history. FTS retrieval (no embedding call, unlike the doc RAG above)
  // so it's cheap enough to run on every classification. Human overrides
  // rank first — they encode exactly where the model was wrong before.
  // Empty corpus / retrieval failure degrade to the plain prompt.
  const fewShot = await retrieveClassificationExamples(msg.bodyText ?? "", 6);
  const fewShotBlock =
    fewShot.length > 0
      ? [
          "Similar past venue messages and the label a HUMAN settled on (use these as precedent):",
          ...fewShot.map((e) => `- [${e.finalLabel}] ${e.text.replace(/\s+/g, " ").slice(0, 400)}`),
        ].join("\n")
      : "";

  const groundedSystem = [
    ragEnabled ? formatAsSystemPrompt(retrieved) : "",
    SYSTEM_PROMPT,
    fewShotBlock,
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await generateCompletion({
    system: groundedSystem,
    prompt,
    tag: "inbox_auto_classify",
    model: CLASSIFIER_MODEL,
    maxTokens: CLASSIFIER_MAX_TOKENS,
  });

  if (!result.ok) {
    logger.warn(
      { threadId: input.threadId, reason: result.reason },
      "[ai-classify] model call failed",
    );
    return null;
  }

  const parsed = parseClassifierJson(result.text);
  if (!parsed) {
    logger.warn(
      { threadId: input.threadId, raw: result.text.slice(0, 200) },
      "[ai-classify] could not parse model output",
    );
    return null;
  }

  // Audit the run: which doc sections grounded it + the model output. Logged
  // for every successful classification (even when the suggestion write is
  // skipped below), so classifier_runs is a complete record. Best-effort.
  try {
    await db.insert(classifierRuns).values({
      threadId: input.threadId,
      messageId: input.messageId,
      retrievedSectionCodes: retrievedCodes,
      classification: parsed.classification,
      confidence: parsed.confidence.toFixed(3),
      model: CLASSIFIER_MODEL,
    });
  } catch (err) {
    logger.warn({ err, threadId: input.threadId }, "[ai-classify] classifier_runs insert failed");
  }

  // Phase 3.9: auto-update the venue x brand relationship flag from the
  // classification (unsubscribe -> bad +1yr; interested/warm/confirmed ->
  // neutral when no prior row; cancellations never auto-flag bad). The helper
  // gates on >= 0.9 confidence via the pure mapping, so low-confidence runs are
  // a no-op here. Best-effort; never blocks classification. [ReferenceDoc 8.4]
  if (ctx?.venueId && ctx.outreachBrandId) {
    await autoFlagRelationshipFromClassification({
      venueId: ctx.venueId,
      outreachBrandId: ctx.outreachBrandId,
      classification: parsed.classification,
      confidence: parsed.confidence,
    });
  }

  // Write suggestion to the thread. ONLY writes the suggested_*
  // columns — the operator-confirmed `classification` is untouched.
  // Also skip the write if the operator has already manually
  // classified the thread (classification != 'unclassified'),
  // since the suggestion pill would just be noise on a confirmed
  // row.
  const existing = await db
    .select({ classification: emailThreads.classification })
    .from(emailThreads)
    .where(eq(emailThreads.id, input.threadId))
    .limit(1);
  const existingClassification = existing[0]?.classification;
  if (existingClassification && existingClassification !== "unclassified") {
    logger.debug(
      { threadId: input.threadId, classification: existingClassification },
      "[ai-classify] skipping — thread already classified",
    );
    return parsed;
  }

  // Below the confidence floor -> flag for human triage (Reference Doc 8.4).
  // Only ever SET the flag here; clearing is the operator's call on triage
  // (setThreadNeedsAttention), so a low-confidence run can't be silently undone
  // by a later one. [ReferenceDoc 8.4]
  const lowConfidence = parsed.confidence < CONFIDENCE_AUTO_ACT_THRESHOLD;
  await db
    .update(emailThreads)
    .set({
      suggestedClassification: parsed.classification,
      suggestedClassificationConfidence: parsed.confidence.toFixed(3),
      suggestedClassificationAt: new Date(),
      ...(lowConfidence ? { needsAttention: true } : {}),
    })
    .where(eq(emailThreads.id, input.threadId));

  logger.info(
    {
      threadId: input.threadId,
      messageId: input.messageId,
      classification: parsed.classification,
      confidence: parsed.confidence,
    },
    "[ai-classify] suggestion written",
  );

  // Auto cold-outreach status update (Haiku ROI sprint #6). Free
  // piggyback — we already paid for the classification; this just
  // mirrors the result onto the cold pipeline. Fire-and-forget;
  // never throws. See lib/ai-auto-status.ts for the mapping +
  // the no-downgrade rule.
  void syncColdStatusFromClassificationAsync({
    threadId: input.threadId,
    classification: parsed.classification,
    confidence: parsed.confidence,
  });

  return parsed;
}

// =========================================================================
// Helpers
// =========================================================================

interface PromptParts {
  venueName: string | null;
  cityName: string | null;
  history: Array<{
    direction: string;
    from: string | null;
    subject: string | null;
    text: string;
  }>;
  target: {
    from: string | null;
    subject: string | null;
    text: string;
  };
}

function buildPrompt(parts: PromptParts): string {
  const lines: string[] = [];
  lines.push("CONTEXT");
  lines.push(`Venue: ${parts.venueName ?? "(unknown — thread not yet matched to a venue)"}`);
  if (parts.cityName) lines.push(`City: ${parts.cityName}`);
  lines.push("");
  if (parts.history.length > 1) {
    lines.push("PRIOR THREAD (oldest first, target message excluded):");
    for (const h of parts.history.slice(0, -1)) {
      lines.push(
        `  [${h.direction.toUpperCase()}] from ${h.from ?? "?"} — subject: ${h.subject ?? "(no subject)"}`,
      );
      lines.push(`  ${h.text.split("\n").join("\n  ")}`);
      lines.push("");
    }
  }
  lines.push("TARGET MESSAGE (classify this one):");
  lines.push(`  from: ${parts.target.from ?? "?"}`);
  lines.push(`  subject: ${parts.target.subject ?? "(no subject)"}`);
  lines.push("  body:");
  lines.push(`  ${parts.target.text.split("\n").join("\n  ")}`);
  lines.push("");
  lines.push("Return the JSON classification now.");
  return lines.join("\n");
}

function parseClassifierJson(raw: string): ClassifierResult | null {
  // Strip code fences if the model accidentally added them
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

  const cls = typeof p.classification === "string" ? p.classification : null;
  if (!cls || !VALID_CLASSIFICATIONS.includes(cls as Classification)) return null;

  const confRaw = typeof p.confidence === "number" ? p.confidence : Number(p.confidence);
  if (!Number.isFinite(confRaw)) return null;
  const confidence = Math.max(0, Math.min(1, confRaw));

  const reasoning = typeof p.reasoning === "string" ? p.reasoning.slice(0, 200) : "";

  return {
    classification: cls as Classification,
    confidence,
    reasoning,
  };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 20)}\n…[truncated ${s.length - max + 20} chars]…`;
}
