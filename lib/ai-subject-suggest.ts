import "server-only";

/**
 * AI subject-line suggester — Tier S #3 of the Haiku ROI sprint.
 *
 * Generates 3 subject-line options from the operator's current
 * draft body + recipient context. Click ✨ in the subject row →
 * 3 chips appear → operator picks one → it lands in the subject
 * field.
 *
 * Used in two flows:
 *   1. Cold outreach drafting — empty subject, operator wrote a
 *      body, wants a strong opener.
 *   2. Reply composition — operator may want to refresh a "Re:..."
 *      that's been re-using the same subject for 6 messages.
 *
 * Cost characteristics:
 *   - ~300 input tokens (subject so far + body, both capped)
 *   - ~120 output tokens (3 subjects, ≤80 chars each)
 *   - ~$0.0009/call with Haiku 4.5
 *
 * Guardrails:
 *   - AI_SUBJECT_SUGGEST_ENABLED env flag (kill switch)
 *   - Per-staff rate limit: 30/min (subject is a high-frequency
 *     click; cap protects against fast-clicking + UI loops)
 *   - Input cap: body truncated to 2000 chars
 *   - Min body length: 30 chars (no point suggesting a subject
 *     for an empty body)
 *   - NEVER cached on a DB row — subjects change with body, and
 *     the cost-per-call is negligible. Caller calls fresh.
 */

import { generateCompletion, isAiConfigured } from "@/lib/ai";
import { checkAiRateLimit, isAiFeatureEnabled, truncateForAi } from "@/lib/ai-guardrails";
import { logger } from "@/lib/logger";

const SUBJECT_MODEL = "claude-haiku-4-5-20251001";
const SUBJECT_MAX_TOKENS = 200;
const BODY_CHAR_CAP = 2000;
const MIN_BODY_CHARS = 30;

const SYSTEM_PROMPT = `You write email subject lines for an outreach operator who books
bar-crawl events at bars / restaurants / lounges. They send to
venue owners and managers — busy people, low patience for jargon.

Read the draft body and (optional) recipient context. Return 3
SUBJECT LINE options as a JSON array of strings:

  1. SPECIFIC — concrete, no jargon. References the venue or the
     ask. Under 60 chars. e.g. "Hosting a 200-person crawl at
     Sneaky Dee's Oct 31?"

  2. WARM — friendly, low-pressure. Under 50 chars. e.g. "Quick
     question about Friday nights" or "Following up on yesterday".

  3. DIRECT — gets to the point. Under 70 chars. e.g. "Tuesday
     2pm OK for a 10-min call?" or "Pricing + capacity for Oct
     31 crawl".

Constraints:
  - Each subject ≤ 80 chars (Gmail truncates around there on
    mobile previews).
  - NO emojis, NO marketing-speak ("Don't miss out!"), NO
    exclamation points, NO ALL-CAPS, NO clickbait.
  - NO leading "Re:" or "Fwd:" — that's the operator's job
    when replying.
  - NO marketing hype words: amazing, incredible, exciting,
    huge, massive, unbelievable.
  - Match the body's tone (formal body → professional subject;
    casual body → casual subject).
  - If the body mentions a specific venue name or date, USE
    those in at least one option.
  - The 3 options must be MEANINGFULLY DIFFERENT — not 3
    rewordings.

Output STRICT JSON, single line, no preamble:

  {"subjects": ["option 1", "option 2", "option 3"]}`;

export interface SubjectSuggestion {
  subjects: string[];
}

interface SuggestInput {
  staffId: string;
  /** Current draft body text. Required — we won't suggest a
   *  subject for an empty body. */
  bodyText: string;
  /** Optional context for tone calibration. */
  recipientName?: string | null;
  recipientEmail?: string | null;
  venueName?: string | null;
  cityName?: string | null;
  /** Operator's current subject. When non-empty, the model is
   *  asked to suggest alternatives (rather than starting from
   *  scratch). */
  currentSubject?: string;
  /** "cold" = new outreach, "reply" = mid-thread. The model
   *  uses this to calibrate (cold opens get more specific
   *  subjects; replies can be terse). */
  mode?: "cold" | "reply";
}

type SuggestResult =
  | { ok: true; subjects: string[] }
  | { ok: false; reason: "not_configured" | "disabled" | "too_short" | "rate_limited" | "failed" };

export async function suggestSubjectLines(input: SuggestInput): Promise<SuggestResult> {
  if (!isAiConfigured()) return { ok: false, reason: "not_configured" };
  if (!isAiFeatureEnabled("subject_suggest")) return { ok: false, reason: "disabled" };

  const body = input.bodyText?.trim() ?? "";
  if (body.length < MIN_BODY_CHARS) return { ok: false, reason: "too_short" };

  // 30/min per staff — subject suggestion is a fast clickable
  // affordance; this cap is to catch a UI loop, not throttle
  // real use.
  const limit = checkAiRateLimit({
    feature: "subject_suggest",
    staffId: input.staffId,
    max: 30,
  });
  if (!limit.ok) {
    logger.warn(
      { staffId: input.staffId, retryAfterMs: limit.retryAfterMs },
      "subject suggest rate limited",
    );
    return { ok: false, reason: "rate_limited" };
  }

  const userPrompt = buildPrompt(input, truncateForAi(body, BODY_CHAR_CAP));

  const start = Date.now();
  const aiResult = await generateCompletion({
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
    model: SUBJECT_MODEL,
    maxTokens: SUBJECT_MAX_TOKENS,
    tag: "ai-subject-suggest",
  });
  const elapsedMs = Date.now() - start;

  if (!aiResult.ok) {
    logger.warn({ reason: aiResult.reason, elapsedMs }, "subject suggest completion failed");
    return { ok: false, reason: "failed" };
  }

  const parsed = parseResponse(aiResult.text);
  if (!parsed || parsed.length === 0) {
    logger.warn({ raw: aiResult.text.slice(0, 200) }, "subject suggest JSON parse failed");
    return { ok: false, reason: "failed" };
  }

  // Sanity + cap each subject. 80-char rule is a soft warning;
  // we trim at 100 hard so the operator never gets handed
  // something obviously wrong.
  const safeSubjects = parsed
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter((s) => s.length > 0)
    .slice(0, 3)
    .map((s) => (s.length > 100 ? `${s.slice(0, 97)}...` : s));

  if (safeSubjects.length === 0) return { ok: false, reason: "failed" };

  logger.info(
    {
      elapsedMs,
      count: safeSubjects.length,
      avgLen: Math.round(safeSubjects.reduce((s, r) => s + r.length, 0) / safeSubjects.length),
      mode: input.mode ?? "cold",
    },
    "subject suggestions generated",
  );

  return { ok: true, subjects: safeSubjects };
}

function buildPrompt(input: SuggestInput, body: string): string {
  const ctxLines: string[] = [];
  if (input.venueName) {
    ctxLines.push(
      input.cityName
        ? `Venue: ${input.venueName} (${input.cityName})`
        : `Venue: ${input.venueName}`,
    );
  }
  if (input.recipientName || input.recipientEmail) {
    ctxLines.push(
      `Recipient: ${input.recipientName ?? "(unknown)"} <${input.recipientEmail ?? ""}>`,
    );
  }
  if (input.currentSubject?.trim()) {
    ctxLines.push(`Current subject draft: "${input.currentSubject.trim()}"`);
  }
  ctxLines.push(`Mode: ${input.mode ?? "cold"}`);

  return `${ctxLines.join("\n")}

Draft body:
${body}

Return the JSON object with exactly 3 subject options.`;
}

function parseResponse(raw: string): string[] | null {
  if (!raw) return null;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const json = JSON.parse(raw.slice(start, end + 1));
    if (json && Array.isArray(json.subjects)) {
      return json.subjects;
    }
  } catch {
    return null;
  }
  return null;
}
