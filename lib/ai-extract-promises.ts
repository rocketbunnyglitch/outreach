import "server-only";

/**
 * AI promise extractor — Phase A.2.
 *
 * Reads an inbound message + recent thread context and pulls out
 * date-anchored "promises" or action items the operator should
 * follow up on. For each one, auto-creates a Task at the right
 * lead time.
 *
 * Examples it catches:
 *
 *   "send me details for the 26th"
 *     -> Task due Oct 25 09:00 local: "Send details for the 26th"
 *
 *   "call me Friday after 2"
 *     -> Task due next Friday 14:00 local: "Call <venue>"
 *
 *   "I'll confirm by end of next week"
 *     -> Task due Friday 17:00 of next week: "Check if <venue> confirmed"
 *
 *   "we'd need 60 days lead time"
 *     -> Skipped (no specific date, just a constraint)
 *
 *   "let me think about it"
 *     -> Skipped (no commitment)
 *
 * Conservative on purpose: the false-positive cost is operator
 * noise (a task for nothing). The model is instructed to return
 * an empty list when in doubt.
 *
 * Runs from the same poll worker hook as ai-classify, after
 * insert. Fire-and-forget; never blocks ingest.
 *
 * Model: claude-haiku-4-5. Extraction is a few hundred input
 * tokens + a small JSON list out. ~$0.0001/msg.
 */

import { cities, emailMessages, emailThreads, tasks, venues } from "@/db/schema";
import { generateCompletion, isAiConfigured } from "@/lib/ai";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { and, desc, eq, sql } from "drizzle-orm";

const EXTRACTOR_MODEL = "claude-haiku-4-5-20251001";
const EXTRACTOR_MAX_TOKENS = 400;

interface ExtractedPromise {
  /** Short, imperative title for the task ("Send details for the 26th"). */
  title: string;
  /** ISO date or datetime when the operator should ACT. NOT the
   *  date the venue mentioned — the date by which the operator
   *  needs to do something. E.g. "send details for the 26th" =>
   *  action date is the 25th (day before). */
  actionAt: string;
  /** Did the model give a specific time, or just a day? "By end of
   *  next week" = day-only. "Call me Friday at 3pm" = with time.
   *  Day-only tasks land at 09:00 operator-local. */
  hasTime: boolean;
  /** 0..1, model's self-rated confidence. We skip writes below 0.6. */
  confidence: number;
  /** Original phrase that triggered the extraction, for audit. */
  evidence: string;
}

const SYSTEM_PROMPT = `You read replies in cold-outreach email threads between an
outreach team and bar/restaurant venues. Your job: extract any
date-anchored ACTION ITEMS the outreach operator needs to follow
up on.

You return a JSON object with this exact shape:

  {
    "promises": [
      {
        "title": "<short imperative — 'Send pricing details', 'Call back', 'Check if X confirmed'>",
        "actionAt": "<ISO date 'YYYY-MM-DD' or datetime 'YYYY-MM-DDTHH:MM' in the THREAD's local timezone>",
        "hasTime": <bool>,
        "confidence": 0.0..1.0,
        "evidence": "<the exact phrase from the message that justifies the task, max 80 chars>"
      },
      ...
    ]
  }

Rules:

  1. Action items only. Not random date mentions ("we opened last
     June" is history, not an action). Not constraints ("we need
     60 days lead time"). Only specific things THE OPERATOR
     should do, with a specific date attached.

  2. Action date == when the OPERATOR should act, NOT the date
     the venue mentioned. Examples:
       "send me details for the 26th" -> operator should send
       details ON or BEFORE the 26th. actionAt = day before
       (the 25th, AM) so the operator doesn't miss it.

       "let's confirm by end of next week" -> operator should
       check in BEFORE end of next week. actionAt = Thursday of
       next week, AM, so there's still a day to follow up.

       "call me Friday at 3" -> operator calls Friday 3pm.
       actionAt = Friday 15:00 (exact time given).

  3. Resolve relative dates against the message's sent date.
     Reference date is provided in the prompt as TODAY.

  4. confidence < 0.6 -> just skip the item (don't include it).
     Examples of low-confidence: "soon," "later this month,"
     "next time we talk."

  5. Max 3 promises per message. If the message has more, pick
     the most important 3. (Most messages have 0 or 1.)

  6. If nothing qualifies, return {"promises": []}.

  7. Do NOT include any prose, markdown fences, or explanation
     outside the JSON. Output the JSON object only.

Calibration examples (do NOT echo back, they're just examples
of correct behavior):

  Input: "Sounds good, send me pricing for the 26th"
  Today: 2025-10-20
  Output:
    {"promises":[{
      "title":"Send pricing for the 26th",
      "actionAt":"2025-10-21",
      "hasTime":false,
      "confidence":0.9,
      "evidence":"send me pricing for the 26th"
    }]}

  Input: "Call me Friday at 3pm, 555-1234"
  Today: 2025-10-20 (Mon)
  Output:
    {"promises":[{
      "title":"Call venue Friday 3pm",
      "actionAt":"2025-10-24T15:00",
      "hasTime":true,
      "confidence":0.95,
      "evidence":"Call me Friday at 3pm"
    }]}

  Input: "Thanks for reaching out. We're already booked the 14th."
  Output:
    {"promises":[]}

  Input: "I'll get back to you soon"
  Output:
    {"promises":[]}`;

interface ExtractInput {
  threadId: string;
  messageId: string;
  teamId: string;
}

export async function extractPromisesAsync(input: ExtractInput): Promise<void> {
  try {
    await extractPromisesAndCreateTasks(input);
  } catch (err) {
    logger.error(
      { err, threadId: input.threadId, messageId: input.messageId },
      "[ai-extract-promises] failed",
    );
  }
}

export async function extractPromisesAndCreateTasks(
  input: ExtractInput,
): Promise<ExtractedPromise[]> {
  if (!isAiConfigured()) return [];

  const msgRow = await db
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

  const msg = msgRow[0];
  if (!msg) return [];
  if (msg.direction !== "inbound") return [];
  if (!msg.bodyText || msg.bodyText.trim().length === 0) return [];

  const threadCtx = await db
    .select({
      venueId: emailThreads.venueId,
      venueName: venues.name,
      cityName: cities.name,
      assignedStaffId: emailThreads.assignedStaffId,
    })
    .from(emailThreads)
    .leftJoin(venues, eq(venues.id, emailThreads.venueId))
    .leftJoin(cities, eq(cities.id, venues.cityId))
    .where(eq(emailThreads.id, input.threadId))
    .limit(1);

  const ctx = threadCtx[0];

  // Last 3 messages chronologically for context (helps the model
  // tell "send me details" from "send them details" etc).
  const history = await db
    .select({
      direction: emailMessages.direction,
      sentAt: emailMessages.sentAt,
      bodyText: emailMessages.bodyText,
    })
    .from(emailMessages)
    .where(and(eq(emailMessages.threadId, input.threadId)))
    .orderBy(desc(emailMessages.sentAt))
    .limit(3);

  const today = msg.sentAt.toISOString().slice(0, 10);

  const prompt = buildPrompt({
    today,
    venueName: ctx?.venueName ?? null,
    cityName: ctx?.cityName ?? null,
    target: msg.bodyText,
    priorTexts: history
      .reverse()
      .slice(0, -1)
      .map((h) => ({
        direction: h.direction,
        text: truncate(h.bodyText ?? "", 600),
      })),
  });

  const result = await generateCompletion({
    system: SYSTEM_PROMPT,
    prompt,
    tag: "inbox_extract_promises",
    model: EXTRACTOR_MODEL,
    maxTokens: EXTRACTOR_MAX_TOKENS,
  });

  if (!result.ok) {
    logger.warn(
      { threadId: input.threadId, reason: result.reason },
      "[ai-extract-promises] model call failed",
    );
    return [];
  }

  const promises = parseExtractorJson(result.text);
  if (promises.length === 0) {
    logger.debug({ threadId: input.threadId }, "[ai-extract-promises] no promises");
    return [];
  }

  // Filter low-confidence + create tasks for the rest.
  const accepted = promises.filter((p) => p.confidence >= 0.6);
  if (accepted.length === 0) return promises;

  await createTasksForPromises({
    promises: accepted,
    threadId: input.threadId,
    messageId: input.messageId,
    venueId: ctx?.venueId ?? null,
    assignedStaffId: ctx?.assignedStaffId ?? null,
    venueName: ctx?.venueName ?? null,
  });

  return promises;
}

// =========================================================================
// Helpers
// =========================================================================

interface PromptParts {
  today: string;
  venueName: string | null;
  cityName: string | null;
  target: string;
  priorTexts: Array<{ direction: string; text: string }>;
}

function buildPrompt(parts: PromptParts): string {
  const lines: string[] = [];
  lines.push(`TODAY: ${parts.today}`);
  lines.push(`Venue: ${parts.venueName ?? "(unmatched)"}`);
  if (parts.cityName) lines.push(`City: ${parts.cityName}`);
  lines.push("");
  if (parts.priorTexts.length > 0) {
    lines.push("PRIOR THREAD (for context, oldest first):");
    for (const h of parts.priorTexts) {
      lines.push(`  [${h.direction.toUpperCase()}]`);
      lines.push(`  ${h.text.split("\n").join("\n  ")}`);
      lines.push("");
    }
  }
  lines.push("TARGET MESSAGE (extract promises from this):");
  lines.push(truncate(parts.target, 2000));
  lines.push("");
  lines.push("Return the JSON now.");
  return lines.join("\n");
}

function parseExtractorJson(raw: string): ExtractedPromise[] {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }

  if (typeof parsed !== "object" || parsed === null) return [];
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.promises)) return [];

  const out: ExtractedPromise[] = [];
  for (const raw of obj.promises) {
    if (typeof raw !== "object" || raw === null) continue;
    const p = raw as Record<string, unknown>;
    const title = typeof p.title === "string" ? p.title.trim().slice(0, 140) : "";
    const actionAt = typeof p.actionAt === "string" ? p.actionAt.trim() : "";
    const hasTime = !!p.hasTime;
    const confidenceRaw = typeof p.confidence === "number" ? p.confidence : Number(p.confidence);
    const evidence = typeof p.evidence === "string" ? p.evidence.slice(0, 200) : "";

    if (!title || !actionAt) continue;
    if (!Number.isFinite(confidenceRaw)) continue;
    if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(actionAt)) continue;

    const confidence = Math.max(0, Math.min(1, confidenceRaw));
    out.push({ title, actionAt, hasTime, confidence, evidence });
    if (out.length >= 3) break;
  }
  return out;
}

interface CreateTasksOpts {
  promises: ExtractedPromise[];
  threadId: string;
  messageId: string;
  venueId: string | null;
  assignedStaffId: string | null;
  venueName: string | null;
}

async function createTasksForPromises(opts: CreateTasksOpts): Promise<void> {
  const rows = opts.promises.map((p) => {
    // Build dueAt timestamp. Day-only tasks land at 09:00 UTC
    // (operator-local for most timezones is "morning of"). With-
    // time tasks use the model's exact hour.
    const dueAt = p.hasTime
      ? new Date(`${p.actionAt}:00.000Z`)
      : new Date(`${p.actionAt}T09:00:00.000Z`);

    // Title prefix for visibility — operator scanning their task
    // list should see at a glance that this came from email.
    const titlePrefix = opts.venueName ? `${opts.venueName}: ` : "";

    // Description carries audit detail: confidence, evidence, and
    // a one-click link to the thread.
    const desc = [
      "Auto-created from inbox by AI promise extractor.",
      "",
      `Evidence: "${p.evidence}"`,
      `Confidence: ${(p.confidence * 100).toFixed(0)}%`,
      "",
      `Thread: /inbox/${opts.threadId}`,
    ].join("\n");

    return {
      title: `${titlePrefix}${p.title}`,
      description: desc,
      source: "smart_note" as const,
      status: "pending" as const,
      targetType: "email_thread" as const,
      targetId: opts.threadId,
      assignedStaffId: opts.assignedStaffId,
      dueAt,
    };
  });

  if (rows.length === 0) return;

  // Scope gate (FULL_AUDIT, operator report 2026-06-11): the extractor ran
  // over deep-resynced HISTORICAL mail and flooded /tasks with 1,632 items
  // about other periods and operations (July 4th, FIFA crawls...). A
  // promise only becomes a task when its thread is attributed to an ACTIVE
  // campaign — unattributed or archived-campaign threads are history, not
  // work.
  //
  // SECOND gate (operator report, same day): attribution alone was not
  // enough — old threads mis-stamped with the active campaign still
  // tasked 52 pre-campaign conversations (NYE, St. Paddy's). The
  // triggering MESSAGE must postdate the campaign's start_date: a
  // promise found in mail older than the campaign is history.
  const scoped = await db.execute<{ ok: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM email_threads t
      JOIN city_campaigns cc ON cc.id = t.city_campaign_id
      JOIN campaigns c ON c.id = cc.campaign_id
      WHERE t.id = ${opts.threadId} AND c.archived_at IS NULL
        AND EXISTS (
          SELECT 1 FROM email_messages m
          WHERE m.id = ${opts.messageId}
            AND m.sent_at >= COALESCE(c.start_date, '-infinity'::timestamptz)
        )
    ) AS ok
  `);
  const scopedRows = Array.isArray(scoped)
    ? (scoped as unknown as { ok: boolean }[])
    : ((scoped as unknown as { rows: { ok: boolean }[] }).rows ?? []);
  if (!scopedRows[0]?.ok) {
    logger.info(
      { threadId: opts.threadId, skipped: rows.length },
      "promise extractor: thread not in an active campaign — tasks skipped",
    );
    return;
  }

  await db.insert(tasks).values(rows);

  logger.info(
    {
      threadId: opts.threadId,
      messageId: opts.messageId,
      count: rows.length,
    },
    "[ai-extract-promises] tasks created",
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 20)}\n…[truncated ${s.length - max + 20} chars]…`;
}
