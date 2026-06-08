/**
 * Pre-send spam / deliverability linter.
 *
 * Pure + dependency-free (no db, no "server-only") so it runs identically in
 * the composer (live feedback) and on the server send path (a safety warning
 * before a risky cold email goes out). It looks for the content signals spam
 * filters weight most heavily -- trigger words, link load, shouting, image-
 * heavy / text-light bodies, missing plain text -- and returns a 0-100 risk
 * score plus human-readable issues.
 *
 * Cold outreach is held to a stricter bar than warm replies (a venue that has
 * already engaged forgives a lot more).
 *
 * This is advisory only: it never blocks a send by itself. The operator decides.
 */

export type SpamLintSeverity = "high" | "medium" | "low";
export type SpamLintLevel = "clean" | "caution" | "risky";

export interface SpamLintIssue {
  id: string;
  severity: SpamLintSeverity;
  message: string;
  hint?: string;
}

export interface SpamLintResult {
  /** 0-100, higher = more likely to be filtered. */
  score: number;
  level: SpamLintLevel;
  issues: SpamLintIssue[];
}

export interface SpamLintInput {
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
  /** Cold sends are linted more strictly than warm replies. Default "cold". */
  context?: "cold" | "warm";
}

// High-signal spam-trigger phrases (subset of the classic SpamAssassin set,
// pruned to ones that actually fire on B2B outreach false-positives too, so we
// weight them modestly rather than nuking the score).
const SPAM_PHRASES: Array<[RegExp, string]> = [
  [/\bfree\b/i, "free"],
  [/\b100%\s*(free|guaranteed?)\b/i, "100% free/guaranteed"],
  [/\bguarantee(d|e)?\b/i, "guarantee"],
  [/\bact now\b/i, "act now"],
  [/\blimited[- ]time\b/i, "limited time"],
  [/\bclick here\b/i, "click here"],
  [/\brisk[- ]free\b/i, "risk-free"],
  [/\bno obligation\b/i, "no obligation"],
  [/\bonce[- ]in[- ]a[- ]lifetime\b/i, "once in a lifetime"],
  [/\burgent\b/i, "urgent"],
  [/\bcheap(est)?\b/i, "cheap"],
  [/\bbuy now\b/i, "buy now"],
  [/\border now\b/i, "order now"],
  [/\bspecial promotion\b/i, "special promotion"],
  [/\bmoney[- ]back\b/i, "money-back"],
  [/\bearn \$|\bmake money\b/i, "earn $ / make money"],
  [/\bwinner\b/i, "winner"],
  [/\bcongratulations\b/i, "congratulations"],
  [/\bthis is not spam\b/i, "this is not spam"],
  [/\bdear (friend|sir|madam)\b/i, "dear friend/sir"],
];

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, " ");
}

function countLinks(text: string, html: string): number {
  const anchors = (html.match(/<a\s[^>]*href/gi) ?? []).length;
  // Bare URLs in the visible text (avoid double-counting anchored ones is
  // imperfect but fine for a heuristic; anchors dominate when present).
  const bareUrls = anchors === 0 ? (text.match(/https?:\/\/\S+/gi) ?? []).length : 0;
  return anchors + bareUrls;
}

function shoutingWords(s: string): number {
  // Words of >=4 letters that are ALL CAPS (ignore acronyms <4).
  const m = s.match(/\b[A-Z]{4,}\b/g) ?? [];
  return m.length;
}

/**
 * Lint an email for spam/deliverability risk. Pure.
 */
export function lintEmail(input: SpamLintInput): SpamLintResult {
  const isCold = (input.context ?? "cold") === "cold";
  const subject = (input.subject ?? "").trim();
  const text = (input.bodyText ?? "").trim();
  const html = input.bodyHtml ?? "";
  const visible = text.length > 0 ? text : stripTags(html).trim();
  const issues: SpamLintIssue[] = [];
  let score = 0;

  const add = (n: number, issue: SpamLintIssue) => {
    score += n;
    issues.push(issue);
  };

  // 1. Spam-trigger phrases (subject weighted heavier than body).
  const subjHits = SPAM_PHRASES.filter(([re]) => re.test(subject)).map(([, w]) => w);
  const bodyHits = SPAM_PHRASES.filter(([re]) => re.test(visible)).map(([, w]) => w);
  const allHits = Array.from(new Set([...subjHits, ...bodyHits]));
  if (allHits.length > 0) {
    const weight = Math.min(30, allHits.length * 7 + subjHits.length * 4);
    add(weight, {
      id: "spam_words",
      severity: allHits.length >= 3 ? "high" : "medium",
      message: `${allHits.length} spam-trigger word${allHits.length === 1 ? "" : "s"}: ${allHits
        .slice(0, 4)
        .join(", ")}${allHits.length > 4 ? "…" : ""}`,
      hint: "Rephrase to sound like a person, not a promotion.",
    });
  }

  // 2. Link load. Cold openers should have 0-1 links.
  const links = countLinks(text, html);
  if (links >= 4) {
    add(25, {
      id: "too_many_links",
      severity: "high",
      message: `${links} links — heavy link load is a strong spam signal`,
      hint: "Cold openers do best with zero or one link.",
    });
  } else if (links >= 2) {
    add(isCold ? 12 : 6, {
      id: "links",
      severity: "medium",
      message: `${links} links`,
      hint: isCold
        ? "Trim to one link for a cold opener."
        : "A couple links is usually fine on a warm thread.",
    });
  }

  // 3. Shouting (ALL CAPS).
  const capsSubj = shoutingWords(subject);
  const capsBody = shoutingWords(visible);
  if (capsSubj > 0) {
    add(15, {
      id: "caps_subject",
      severity: "high",
      message: "ALL-CAPS word(s) in the subject",
      hint: "Caps in subjects scream 'marketing blast'.",
    });
  }
  if (capsBody >= 2) {
    add(10, {
      id: "caps_body",
      severity: "medium",
      message: `${capsBody} ALL-CAPS words in the body`,
    });
  }

  // 4. Excessive punctuation / symbols.
  if (/!{2,}|\${2,}|\?{2,}/.test(`${subject} ${visible}`)) {
    add(12, {
      id: "punctuation",
      severity: "medium",
      message: "Repeated !! / $$ / ?? — looks promotional",
      hint: "Use normal punctuation.",
    });
  }

  // 5. Missing plain-text part (HTML-only). Filters distrust HTML-only mail.
  if (html.replace(/<[^>]*>/g, "").trim().length > 0 && text.length === 0) {
    add(10, {
      id: "no_plain_text",
      severity: "medium",
      message: "No plain-text version — HTML-only mail is more likely filtered",
      hint: "Include a plain-text body (or use plain-text send mode for cold).",
    });
  }

  // 6. Image-heavy / text-light. A big image with little text is classic spam.
  const imgCount = (html.match(/<img\b/gi) ?? []).length;
  if (imgCount >= 1 && visible.length < 120) {
    add(15, {
      id: "image_heavy",
      severity: "high",
      message: "Image(s) with very little text",
      hint: "Filters can't read images; lead with real text.",
    });
  }

  // 7. Subject hygiene.
  if (subject.length > 70) {
    add(8, {
      id: "subject_long",
      severity: "low",
      message: `Subject is ${subject.length} chars — long subjects get clipped + look spammy`,
      hint: "Aim for under ~50 characters.",
    });
  }
  if (subject.length === 0) {
    add(10, {
      id: "subject_empty",
      severity: "medium",
      message: "Empty subject — empty/blank subjects are a spam flag",
    });
  }
  if (/^\s*(re|fwd?):/i.test(subject) && isCold) {
    add(10, {
      id: "fake_reply_subject",
      severity: "medium",
      message: "Subject fakes a reply (Re:/Fwd:) on a cold email",
      hint: "Recipients (and filters) punish fake Re: subjects.",
    });
  }

  // 8. Body too short for a cold opener (looks like a mass blast).
  const words = visible.split(/\s+/).filter(Boolean).length;
  if (isCold && words > 0 && words < 15) {
    add(8, {
      id: "body_short",
      severity: "low",
      message: `Only ${words} words — very short cold emails read as blasts`,
    });
  }

  // 9. Spammy inline styling (huge fonts / loud colors).
  if (/font-size:\s*(2[4-9]|[3-9]\d)px|color:\s*#?(f00|ff0000|red)\b/i.test(html)) {
    add(8, {
      id: "loud_styling",
      severity: "low",
      message: "Oversized or bright-red text",
      hint: "Keep formatting plain — it lands better.",
    });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const level: SpamLintLevel = score >= 55 ? "risky" : score >= 25 ? "caution" : "clean";
  // Sort issues high → low severity for display.
  const rank = { high: 0, medium: 1, low: 2 } as const;
  issues.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return { score, level, issues };
}
