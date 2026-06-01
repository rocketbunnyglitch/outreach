/**
 * Rule-based email triage classifier.
 *
 * Reads an inbound email's subject + body + from-address and assigns it
 * one of the 8 replyClassification enum values:
 *   interested, question, callback_requested, decline, unsubscribe,
 *   auto_reply, spam, unclassified
 *
 * Why rule-based, not LLM?
 *   - Throughput: 100+ emails/min during a campaign launch, no per-email
 *     LLM latency or cost
 *   - Auditable: an operator can see why something was classified a
 *     specific way (the `reason` field returns the exact regex/phrase
 *     that fired)
 *   - Recoverable: misclassifications get fixed by adding a phrase to
 *     the rules file. No prompt-engineering loops.
 *   - The classification is a STARTING POINT for the operator's eye —
 *     even at 70% accuracy it makes the inbox scannable in seconds.
 *
 * Match order matters. Earliest match wins. Generally we go:
 *   1. Bounce / mailer-daemon (most decisive — bail early)
 *   2. Out-of-office / auto-reply (tag and skip nuance)
 *   3. Unsubscribe / remove me (legally important to flag)
 *   4. Explicit decline ("not interested", "we'll pass")
 *   5. Callback / phone request
 *   6. Explicit interest ("interested", "let's chat")
 *   7. Question (ends in ?, contains "what/when/how")
 *   8. Spam heuristics (last resort, prone to false positives)
 *   9. Fall through to 'unclassified'
 *
 * The operator can override any classification via the inbox UI; the
 * classifier won't overwrite a manually-set value (handled at the
 * caller — see gmail-poll-worker.ts).
 */

import type { replyClassification } from "@/db/schema/enums";

export type Classification = (typeof replyClassification.enumValues)[number];

export interface ClassificationResult {
  classification: Classification;
  /** 0-1; rules return discrete values (0.5 = fuzzy, 0.9 = strong). */
  confidence: number;
  /** Short human-readable reason. Surfaced as a tooltip in the UI. */
  reason: string;
}

// =========================================================================
// Helpers
// =========================================================================

/** Lowercase + collapse whitespace + strip quoted-reply chevrons
 *  + strip forwarded-message blocks.
 *
 *  Forwarded blocks are a real source of false positives in
 *  classification — a venue forwarding "we're not interested"
 *  from their boss would otherwise get tagged as decline even
 *  though the VENUE'S own reply might be "what do you think?".
 *  We drop everything after a forwarded-message header so the
 *  classifier only sees the venue's own typing.
 */
function normalize(text: string): string {
  // Detect the forwarded-message divider and truncate. Gmail's web
  // UI emits "---------- Forwarded message ---------" with at least
  // 8 dashes; Outlook emits "From: ..." line headers. We match the
  // dashed version which is the common case for forwarded venue
  // replies. The Outlook shape is harder to detect cheaply (the
  // header lines look like normal text) so we accept some false
  // negatives there in exchange for not over-truncating.
  const fwdMatch = text.match(/-{8,}\s*forwarded message\s*-{8,}/i);
  const truncated = fwdMatch ? text.slice(0, fwdMatch.index) : text;

  return truncated
    .toLowerCase()
    .replace(/^>+\s*.*$/gm, "") // drop quoted reply lines
    .replace(/\s+/g, " ")
    .trim();
}

/** True if any of the patterns matches the haystack. */
function anyMatch(haystack: string, patterns: RegExp[]): RegExp | null {
  for (const p of patterns) {
    if (p.test(haystack)) return p;
  }
  return null;
}

// =========================================================================
// Patterns
// =========================================================================

const BOUNCE_FROM_PATTERNS = [
  /\bmailer-daemon@/i,
  /\bpostmaster@/i,
  /\bbounces?\+/i,
  /\bnoreply\+bounces@/i,
];

const AUTOREPLY_SUBJECT_PATTERNS = [
  /^auto:/i,
  /^automatic reply/i,
  /^out of office/i,
  /^ooo:/i,
  /\bauto-?reply\b/i,
];

const AUTOREPLY_BODY_PATTERNS = [
  /i am (currently )?out of (the )?office/i,
  /i'?m (currently )?out of (the )?office/i,
  /on vacation until/i,
  /returning to the office on/i,
  /this is an automatic reply/i,
  /thank you for your email\.?\s+i('?| a)m away/i,
];

const UNSUBSCRIBE_PATTERNS = [
  /\bunsubscribe\b/i,
  /\bremove me from (your |the )?list/i,
  /\bstop emailing me\b/i,
  /\btake me off (your |the )?list/i,
  /\bdo not (contact|email) me\b/i,
  /\bplease remove\b/i,
];

const DECLINE_PATTERNS = [
  /\bnot interested\b/i,
  /\bwe'?ll pass\b/i,
  /\bwe('re| are) (not|going to) pass\b/i,
  /\bno thank ?s?\b/i,
  /\bnot a (good )?fit\b/i,
  /\bnot for us\b/i,
  /\bwe('re| are) not (interested|able)/i,
  /\bnot (looking|interested) (right now|at this time|currently)/i,
  /\bunable to (participate|host|partner)/i,
  /\bdecline\b/i,
];

const CALLBACK_PATTERNS = [
  /\b(give|call|ring) me a (call|ring)\b/i,
  /\bcall me (at|on|back)\b/i,
  /\bmy number is\b/i,
  /\bcan we (hop on|schedule|jump on) a (call|phone)/i,
  /\bcan you call me\b/i,
  /\blet'?s (hop on|schedule|set up) a call\b/i,
  /\bbetter (over|by|on) (the )?phone\b/i,
  // Phone-number pattern — tightened to require either:
  //   - A leading + (international format), OR
  //   - Parenthesized area code: (555) 555-5555, OR
  //   - A separator (hyphen / dot / space) BETWEEN groups (not
  //     just bare 10 digits in a row, which matches order IDs,
  //     confirmation codes, account numbers, etc.)
  // The previous bare-10-digits match fired on too many
  // non-phone strings. Real phone numbers in casual email
  // bodies almost always include either parentheses or hyphens.
  /\+\d{1,3}[-.\s]\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/, // +1 555-555-5555
  /\(\d{3}\)\s*\d{3}[-.\s]?\d{4}\b/, // (555) 555-5555
  /\b\d{3}[-.]\d{3}[-.]\d{4}\b/, // 555-555-5555 or 555.555.5555
];

const INTERESTED_PATTERNS = [
  /\binterested\b/i,
  /\b(sounds|that sounds) (great|good|interesting|like a (great |good )?fit)/i,
  /\bwe(\b|'re| are)? (in|would love|are excited)/i,
  /\blet'?s (do it|chat|talk|discuss|set this up|move forward)/i,
  /\b(tell|send) me more\b/i,
  /\bsend (me |us )?more info/i,
  /\bwhen do you want to (start|meet|chat)/i,
  /\bcount us in\b/i,
  /\bwe'?d love to\b/i,
  /\bhappy to (host|help|partner|chat)/i,
];

const SPAM_PATTERNS = [
  /\bbuy now\b/i,
  /\bclick here\b/i,
  /\bcrypto(currency)?\b/i,
  /\binvestment opportunity\b/i,
  /\b100% (free|guaranteed)\b/i,
  /\bmake \$\d+/i,
  /\bseo (services|expert|consultant)\b/i,
  /\bguest post(ing)? opportunity\b/i,
  /\bwe can help your (website|business) rank/i,
];

// =========================================================================
// Main entry point
// =========================================================================

export function classifyInboundEmail(opts: {
  subject: string | null;
  bodyText: string | null;
  fromAddress: string;
  /**
   * Gmail's own label set on this message. We use it to short-
   * circuit promotional / category-tagged mail without running
   * our regex passes. Gmail's category classifier is much more
   * accurate than our spam heuristics. Pass when available.
   */
  gmailLabels?: string[];
}): ClassificationResult {
  const subject = opts.subject ?? "";
  const body = opts.bodyText ?? "";
  const from = opts.fromAddress.toLowerCase();
  const labels = opts.gmailLabels ?? [];

  // ---- 0. Gmail's own category signal ----
  // CATEGORY_PROMOTIONS is Gmail's bucket for marketing mail —
  // SaaS newsletters, vendor pitches, ecommerce blasts. Treat as
  // spam so it gets de-prioritized just like our regex spam
  // matches. CATEGORY_SOCIAL (Twitter/LinkedIn notifications)
  // ditto. CATEGORY_UPDATES (banking, shipping, calendar) we
  // DON'T classify as spam — those are sometimes operationally
  // relevant ("your venue's booking changed").
  //
  // Higher confidence than regex spam (0.95 vs 0.7) — Gmail has
  // far more training data than our patterns. Lower than bounce
  // detection (0.95 vs the bounce 0.95) — bounces are
  // deterministic; categories are heuristic.
  if (labels.includes("CATEGORY_PROMOTIONS")) {
    return {
      classification: "spam",
      confidence: 0.9,
      reason: "Gmail tagged as promotional",
    };
  }
  if (labels.includes("CATEGORY_SOCIAL")) {
    return {
      classification: "spam",
      confidence: 0.9,
      reason: "Gmail tagged as social",
    };
  }

  // ---- 1. Bounces / system mail ----
  // Tagged as spam because the inbox UI doesn't have a 'bounce' category
  // and we want bounces de-prioritized. We DON'T tag as auto_reply
  // because operators may filter auto_reply to see vacation responses.
  if (anyMatch(from, BOUNCE_FROM_PATTERNS)) {
    return {
      classification: "spam",
      confidence: 0.95,
      reason: "Looks like a delivery-status / bounce notification",
    };
  }

  // ---- 2. Auto-replies (OOO, vacation, etc) ----
  const aSubject = anyMatch(subject, AUTOREPLY_SUBJECT_PATTERNS);
  if (aSubject) {
    return {
      classification: "auto_reply",
      confidence: 0.9,
      reason: `Subject matched: ${aSubject.source}`,
    };
  }
  const normBody = normalize(body);
  const aBody = anyMatch(normBody, AUTOREPLY_BODY_PATTERNS);
  if (aBody) {
    return {
      classification: "auto_reply",
      confidence: 0.85,
      reason: `Body matched: ${aBody.source}`,
    };
  }

  // ---- 3. Unsubscribe — legally important to flag ----
  const unsubMatch = anyMatch(normBody, UNSUBSCRIBE_PATTERNS);
  if (unsubMatch) {
    return {
      classification: "unsubscribe",
      confidence: 0.9,
      reason: `Body matched: ${unsubMatch.source}`,
    };
  }

  // ---- 4. Explicit decline ----
  const declineMatch = anyMatch(normBody, DECLINE_PATTERNS);
  if (declineMatch) {
    return {
      classification: "decline",
      confidence: 0.85,
      reason: `Body matched: ${declineMatch.source}`,
    };
  }

  // ---- 5. Callback / phone request — check BEFORE interested
  //         because "let's hop on a call" is more specific than "let's"
  const callbackMatch = anyMatch(normBody, CALLBACK_PATTERNS);
  if (callbackMatch) {
    return {
      classification: "callback_requested",
      confidence: 0.85,
      reason: `Body matched: ${callbackMatch.source}`,
    };
  }

  // ---- 6. Explicit interest ----
  const interestedMatch = anyMatch(normBody, INTERESTED_PATTERNS);
  if (interestedMatch) {
    return {
      classification: "interested",
      confidence: 0.8,
      reason: `Body matched: ${interestedMatch.source}`,
    };
  }

  // ---- 7. Question (lowest-priority positive classification) ----
  // Heuristic: body ends in '?' OR contains a "what/when/how/do you/can you"
  // construction NOT followed by a decline. Tight enough to avoid false
  // positives on "I don't know what to say" etc.
  if (/\?/.test(body)) {
    const questionWord =
      /\b(what|when|how|where|why|which|who|do you|can you|could you|would you|is (it|there|this)|are you|are there)\b/i.exec(
        normBody,
      );
    if (questionWord) {
      return {
        classification: "question",
        confidence: 0.65,
        reason: `Contains '?' and question word '${questionWord[0]}'`,
      };
    }
  }

  // ---- 8. Spam heuristics ----
  const spamMatch = anyMatch(normBody, SPAM_PATTERNS);
  if (spamMatch) {
    return {
      classification: "spam",
      confidence: 0.7,
      reason: `Body matched spam pattern: ${spamMatch.source}`,
    };
  }

  // ---- 9. Fall through ----
  return {
    classification: "unclassified",
    confidence: 0,
    reason: "No rule matched",
  };
}
