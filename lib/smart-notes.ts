/**
 * Smart Notes → Action Extractor.
 *
 * Pipeline:
 *   1. Split note body into sentences (period / newline boundaries)
 *   2. For each sentence: detect action verb + classify type
 *   3. For sentences with an action verb: parse date/time via chrono-node
 *   4. Build a suggestion if BOTH action and date present (high confidence)
 *      OR if action present but no date (medium confidence, due_at=null)
 *   5. Caller dedups against existing pending/dismissed suggestions for
 *      the same note (we don't re-suggest if there's already a pending
 *      one with the same action_type + due_at)
 *
 * Why regex/keyword instead of LLM:
 *   - Predictable, deterministic, no rate limits
 *   - Operator can read the source_text and see exactly why it fired
 *   - Fast — runs synchronously inside the createNote action
 *   - Can upgrade to LLM classification later via a feature flag
 *
 * Date parsing via chrono-node — battle-tested, handles every relative
 * form the spec lists (today, tomorrow, next Monday, in 2 hours, this
 * afternoon, Friday at 3, etc).
 */

import * as chrono from "chrono-node";

export type ActionType =
  | "call"
  | "follow_up_email"
  | "venue_callback"
  | "confirmation_reminder"
  | "poster_send"
  | "wristband_task"
  | "missing_info_task"
  | "reminder"
  | "custom";

export interface ExtractedAction {
  /** Suggested task title, e.g. "Call Mike about final venue pricing" */
  title: string;
  /** Free-text description (often just the original sentence). */
  description: string;
  actionType: ActionType;
  /** Parsed due-time, or null if no date phrase was detected. */
  dueAt: Date | null;
  /** IANA timezone the dueAt should be interpreted in. */
  timezone: string;
  /** 'high' if both action AND date detected; 'medium' if only action. */
  confidence: "high" | "medium";
  /** The exact phrase (sentence) that triggered detection. */
  sourceText: string;
}

interface ExtractInput {
  /** Note body to scan. */
  text: string;
  /** Reference date — usually new Date(). Tests inject a fixed date. */
  refDate?: Date;
  /** Resolved timezone for date-string interpretation. */
  timezone: string;
}

/**
 * Action verb patterns. Each pattern maps to an ActionType. The keyword
 * appears anywhere in the sentence (case-insensitive).
 *
 * Order matters — more-specific patterns first. Once a sentence matches
 * one pattern we stop looking, so "call back" matches `venue_callback`
 * before `call`.
 */
const ACTION_PATTERNS: Array<{ regex: RegExp; type: ActionType }> = [
  // "call back", "callback" -> venue callback
  { regex: /\b(call\s+back|callback)\b/i, type: "venue_callback" },

  // Wristband-specific verbs
  {
    regex: /\b(wristband|wristbands|ship\s+wristband|wristband\s+ship)/i,
    type: "wristband_task",
  },

  // Poster verbs
  {
    regex: /\b(send\s+poster|deliver\s+poster|poster\s+(send|deliver))/i,
    type: "poster_send",
  },

  // Confirmation
  {
    regex:
      /\b(confirm\s+with|confirmation|confirm\s+venue|need\s+to\s+confirm|2[\s-]week|1[\s-]week|three[\s-]day)/i,
    type: "confirmation_reminder",
  },

  // Missing info — "need address", "missing phone", "no email"
  {
    regex: /\b(missing|no|need|need\s+to\s+get)\s+(email|phone|address|contact|info|details)\b/i,
    type: "missing_info_task",
  },

  // Generic reminder
  { regex: /\b(remind|remember)\s+to\b/i, type: "reminder" },

  // Email — "follow up", "follow-up", "email", "send email", "reply"
  {
    regex: /\b(follow[\s-]up|follow\s+up|email|send\s+email|reply\s+to|respond)/i,
    type: "follow_up_email",
  },

  // Call — broad catch
  { regex: /\b(call|ring|phone|dial)\b/i, type: "call" },
];

/**
 * Main extract function. Returns 0..N ExtractedAction objects. The caller
 * is responsible for persisting them as note_action_suggestions rows.
 */
export function extractActionsFromNote(input: ExtractInput): ExtractedAction[] {
  const refDate = input.refDate ?? new Date();
  const sentences = splitIntoSentences(input.text);
  const results: ExtractedAction[] = [];

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    const actionMatch = matchActionType(trimmed);
    if (!actionMatch) continue;

    // chrono.parse returns multiple results if a sentence has multiple
    // dates; we use the first (most prominent) one.
    const parsed = chrono.parse(trimmed, refDate, { forwardDate: true });
    const dateResult = parsed[0];
    const dueAt = dateResult?.start.date() ?? null;

    const title = buildTitle(actionMatch.type, trimmed);

    results.push({
      title,
      description: trimmed,
      actionType: actionMatch.type,
      dueAt,
      timezone: input.timezone,
      confidence: dueAt ? "high" : "medium",
      sourceText: trimmed,
    });
  }

  return results;
}

/**
 * Split note body into sentence-like chunks. Boundaries:
 *   - Period followed by whitespace + capital letter (or end)
 *   - Newlines
 *   - Question marks, exclamation marks
 *
 * Keeps the chunk's original text (no trimming yet) so the caller can
 * preserve formatting in source_text.
 */
function splitIntoSentences(text: string): string[] {
  // Replace newlines with periods for unified splitting
  const normalized = text.replace(/\r?\n+/g, ". ");
  // Split on sentence-end punctuation followed by whitespace + capital
  // OR end-of-string. Conservative — better to keep a long sentence than
  // miss a date that spans a period.
  const parts = normalized.split(/(?<=[.!?])\s+(?=[A-Z])/);
  return parts.flatMap((p) => p.split(/\.\s+/)).filter(Boolean);
}

function matchActionType(sentence: string): { type: ActionType } | null {
  for (const { regex, type } of ACTION_PATTERNS) {
    if (regex.test(sentence)) return { type };
  }
  return null;
}

/**
 * Build a short, action-oriented title from the action type + the
 * matched sentence. The goal: something the operator can scan in the
 * task list and instantly recognize.
 *
 *   "Mike said call back today at 5pm about pricing"
 *     → "Call back about pricing"
 *   "follow up with John about confirmation"
 *     → "Follow up with John about confirmation"
 *   "remember to ship wristbands by Friday"
 *     → "Ship wristbands"
 */
function buildTitle(type: ActionType, sentence: string): string {
  const lower = sentence.toLowerCase();

  // Try to extract subject — text after "about" or "re:" or "to"
  const aboutMatch = sentence.match(/\b(about|re:|regarding)\s+(.+?)(?:[.,;]|$)/i);
  const subject = aboutMatch?.[2]?.trim();

  // Try to extract a named person — "Mike", "John", proper nouns near
  // the verb
  const personMatch = sentence.match(
    /\b(call|email|text|follow up with|callback|ring)\s+([A-Z][a-z]+)\b/,
  );
  const person = personMatch?.[2];

  let prefix: string;
  switch (type) {
    case "venue_callback":
      prefix = person ? `Call ${person} back` : "Call back";
      break;
    case "call":
      prefix = person ? `Call ${person}` : "Call";
      break;
    case "follow_up_email":
      prefix = person ? `Follow up with ${person}` : "Follow up";
      break;
    case "confirmation_reminder":
      prefix = person ? `Confirm with ${person}` : "Confirm venue";
      break;
    case "poster_send":
      prefix = "Send poster";
      break;
    case "wristband_task":
      prefix = "Ship wristbands";
      break;
    case "missing_info_task": {
      // Build from the matched missing keyword
      const missingMatch = lower.match(
        /(missing|no|need)\s+(email|phone|address|contact|info|details)/,
      );
      const what = missingMatch?.[2] ?? "info";
      prefix = `Get missing ${what}`;
      break;
    }
    case "reminder":
      prefix = "Reminder";
      break;
    default:
      prefix = "Follow up";
  }

  if (subject) {
    return `${prefix} about ${subject}`;
  }
  return prefix;
}

/**
 * SHA-256 of a note body. Stable across re-scans — same body, same hash.
 * Used to keep dismissed suggestions dismissed when a note is edited
 * without changing the relevant text.
 *
 * Uses node:crypto for sync hashing. ~20µs for typical note sizes.
 */
export function hashNoteContent(body: string): string {
  // Lazy require to keep this module client-bundleable for shared types
  // even though the actual hash is server-only.
  // biome-ignore lint/correctness/noNodejsModules: server only
  const { createHash } = require("node:crypto");
  return createHash("sha256").update(body, "utf8").digest("hex");
}
