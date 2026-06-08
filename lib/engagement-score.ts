/**
 * Per-venue engagement score (Tier-2).
 *
 * A 0-100 SOFT signal summarizing how engaged a venue is, from:
 *   - reply count          (how many times the venue has written back)
 *   - reply recency        (a reply 2 days ago beats one 2 months ago)
 *   - warm-only opens       (informational; capped + small -- never the driver)
 *   - classification        (interested/warm lift it; confirmed lifts it most;
 *                            decline/unsubscribe/DNC zero it)
 *
 * Used to SORT the worklist + cold list so genuinely-interested venues rise. It
 * is a soft signal ONLY: it never advances cadence, sets relationship flags, or
 * triggers a send. (Mirrors the open-tracking rule -- opens inform, never drive.)
 *
 * Pure + dependency-free (no db, no "server-only") so it is unit-tested
 * directly. The caller supplies the already-resolved signals; this module knows
 * nothing about the schema -- it just grades.
 *
 * Classification vocabulary spans both real label sets:
 *   - email_threads.classification (reply_classification enum)
 *   - cold_outreach_entries.status (cold_outreach_status enum)
 */

export interface EngagementSignals {
  /** Number of inbound replies from the venue. */
  replyCount: number;
  /** Most recent inbound reply (Date or ISO string), if any. */
  lastReplyAt?: Date | string | null;
  /** Sum of warm-thread open_count for this venue. Soft, capped. Optional. */
  warmOpenCount?: number;
  /** Latest classification / status label (either enum). Optional. */
  classification?: string | null;
  /** Reference instant (passed in for determinism / testing). */
  now: Date;
}

export type EngagementBand = "dead" | "cold" | "warming" | "engaged" | "hot";

export interface EngagementResult {
  /** 0-100 integer. */
  score: number;
  band: EngagementBand;
  /** Short human-readable rationale for tooltips / logs. */
  reason: string;
}

// Classification labels that ZERO the score regardless of replies -- the venue
// has declined, opted out, or is uncontactable. Covers both enum vocabularies.
const DEAD_LABELS = new Set([
  "decline",
  "declined",
  "unsubscribe",
  "unsubscribed",
  "cancelled_by_them",
  "do_not_contact",
  "dnc",
  "bad_email",
  "wrong_number",
  "unreachable",
  "spam",
]);
// Strongest positive: a confirmed booking.
const CONFIRMED_LABELS = new Set(["confirmed"]);
// Positive interest.
const POSITIVE_LABELS = new Set(["interested", "warm"]);
// Was warm, then went quiet -- a small drag, not a kill.
const STALLED_LABELS = new Set(["stalled_warm"]);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Component weights (tuned so "interested + replied 2d ago" clearly outranks a
// silent venue, and a confirmed booking sits at the top).
const REPLY_FIRST = 28; // first reply
const REPLY_SECOND = 12; // second reply
const REPLY_MORE = 8; // 4+ replies
const RECENCY_2D = 28;
const RECENCY_7D = 20;
const RECENCY_14D = 12;
const RECENCY_30D = 6;
const RECENCY_OLDER = 2;
const OPEN_PER = 2;
const OPEN_CAP = 8;
const LIFT_CONFIRMED = 30;
const LIFT_POSITIVE = 18;
const DRAG_STALLED = -8;

function normalize(label: string | null | undefined): string {
  return (label ?? "").trim().toLowerCase();
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function bandFor(score: number): EngagementBand {
  if (score >= 75) return "hot";
  if (score >= 50) return "engaged";
  if (score >= 25) return "warming";
  return "cold";
}

/** Grade a venue's engagement into a 0-100 soft score. */
export function scoreEngagement(signals: EngagementSignals): EngagementResult {
  const label = normalize(signals.classification);

  // Hard floor: declined / opted-out / uncontactable -> 0, regardless of any
  // prior replies. These venues must sink to the bottom of every sort.
  if (DEAD_LABELS.has(label)) {
    return { score: 0, band: "dead", reason: `Classified "${label}" -- not pursuing.` };
  }

  const replyCount = Math.max(0, Math.floor(signals.replyCount || 0));
  let score = 0;
  const parts: string[] = [];

  // Replies.
  if (replyCount >= 1) score += REPLY_FIRST;
  if (replyCount >= 2) score += REPLY_SECOND;
  if (replyCount >= 4) score += REPLY_MORE;
  if (replyCount > 0) parts.push(`${replyCount} repl${replyCount === 1 ? "y" : "ies"}`);

  // Recency.
  const last = toDate(signals.lastReplyAt);
  if (last) {
    const days = (signals.now.getTime() - last.getTime()) / MS_PER_DAY;
    let pts: number;
    if (days <= 2) pts = RECENCY_2D;
    else if (days <= 7) pts = RECENCY_7D;
    else if (days <= 14) pts = RECENCY_14D;
    else if (days <= 30) pts = RECENCY_30D;
    else pts = RECENCY_OLDER;
    score += pts;
    if (days <= 7) parts.push("recent reply");
  }

  // Warm opens -- soft, capped, never dominant.
  const opens = Math.max(0, Math.floor(signals.warmOpenCount || 0));
  if (opens > 0) score += Math.min(OPEN_CAP, opens * OPEN_PER);

  // Classification lift / drag.
  if (CONFIRMED_LABELS.has(label)) {
    score += LIFT_CONFIRMED;
    parts.push("confirmed");
  } else if (POSITIVE_LABELS.has(label)) {
    score += LIFT_POSITIVE;
    parts.push(label);
  } else if (STALLED_LABELS.has(label)) {
    score += DRAG_STALLED;
    parts.push("stalled");
  }

  score = clamp(Math.round(score), 0, 100);
  const band = bandFor(score);
  const reason = parts.length ? parts.join(", ") : "no engagement yet";
  return { score, band, reason };
}

/**
 * Comparator for sorting venues by engagement, descending (most engaged first).
 * Pre-compute each row's score and sort by it; ties fall back to the caller's
 * own ordering.
 */
export function compareByEngagementDesc(a: EngagementResult, b: EngagementResult): number {
  return b.score - a.score;
}
