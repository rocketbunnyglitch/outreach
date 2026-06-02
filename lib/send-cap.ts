/**
 * Daily cold-send cap — classification, counting, enforcement.
 *
 * Single funnel: every outbound send (compose new thread, reply to
 * thread, AI draft send) calls preflightSend() BEFORE invoking
 * sendGmailMessage, and recordSendEvent() AFTER. The cap check
 * blocks cold sends past the per-account limit unless an admin
 * provides the `bypassCap` flag.
 *
 * Classification (v1):
 *   cold  — a NEW thread initiated by us (no inbound message exists
 *           for this thread before this send), OR a brand-new
 *           compose-modal send (no thread yet).
 *   warm  — a reply on a thread that has at least one inbound
 *           message before this send.
 *
 * "Local day" for the cap counter = sender user's timezone, defaulting
 * to America/Toronto when the user's timezone column is unset or
 * unparsable. This is the operator-visible day boundary.
 */

import "server-only";
import {
  type SendType,
  emailMessages,
  emailSendEvents,
  staffOutreachEmails,
  users,
} from "@/db/schema";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { and, eq, gte, sql } from "drizzle-orm";

const DEFAULT_TZ = "America/Toronto";

/** Compute the timestamp marking the start of the user's local day,
 *  returned in UTC. The cap counter filters
 *  `sent_at >= startOfLocalDay`. */
export function startOfLocalDay(userTimezone: string | null | undefined): Date {
  const tz = userTimezone || DEFAULT_TZ;
  // Build a Date that represents "midnight today in the given TZ"
  // by formatting now-in-tz, then parsing.
  try {
    const now = new Date();
    // en-CA gives YYYY-MM-DD.
    const ymd = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    // Construct an ISO string for that date at midnight in the
    // requested zone. We piggy-back on Date's UTC parsing by computing
    // the zone's offset for the wall-clock date and applying it.
    const offset = tzOffsetMinutes(tz, now);
    // ymd + 'T00:00:00' is the local wall clock; subtract the offset
    // to express in UTC.
    const localMidnightUtc = new Date(`${ymd}T00:00:00.000Z`).getTime() - offset * 60_000;
    return new Date(localMidnightUtc);
  } catch (err) {
    logger.warn({ err, tz }, "startOfLocalDay: TZ formatting failed, falling back to UTC midnight");
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
}

/** Minutes east of UTC for a given IANA TZ at a given instant. */
function tzOffsetMinutes(tz: string, when: Date): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = formatter.formatToParts(when);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const tzAsUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((tzAsUtc - when.getTime()) / 60_000);
}

export interface SendUsage {
  /** Cold sends that count against the cap on this account, today. */
  used: number;
  /** Configured cap on the account. */
  cap: number;
  /** cap - used, clamped at 0. */
  remaining: number;
  /** True when used >= cap. */
  atCap: boolean;
  /** Cumulative cold sends including bypassed sends today. Lets the
   *  UI show "22 / 30 (+2 bypassed)" if useful. */
  bypassedToday: number;
}

/**
 * Read today's cold-send usage for an account. "Today" = local day
 * of the **inbox owner's** user timezone. Returns zeros if the
 * account doesn't exist; the caller should validate ownership
 * separately.
 */
export async function loadSendUsage(connectedAccountId: string): Promise<SendUsage> {
  const acct = await db
    .select({
      id: staffOutreachEmails.id,
      ownerUserId: staffOutreachEmails.ownerUserId,
      cap: staffOutreachEmails.dailyColdSendCap,
    })
    .from(staffOutreachEmails)
    .where(eq(staffOutreachEmails.id, connectedAccountId))
    .limit(1);

  const cap = acct[0]?.cap ?? 30;
  const ownerId = acct[0]?.ownerUserId;
  if (!acct[0] || !ownerId) {
    return { used: 0, cap, remaining: cap, atCap: false, bypassedToday: 0 };
  }

  // Owner timezone determines "today."
  const owner = await db
    .select({ tz: users.timezone })
    .from(users)
    .where(eq(users.id, ownerId))
    .limit(1);
  const tz = owner[0]?.tz ?? DEFAULT_TZ;
  const startOfDay = startOfLocalDay(tz);

  // Count cold sends today on this account. We count anything where
  // counted_against_cap=true (the canonical "this used a slot"
  // marker), regardless of category — `cold` always sets it true,
  // and we don't want a future category-rename to silently drop
  // counts.
  const usedRow = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(emailSendEvents)
    .where(
      and(
        eq(emailSendEvents.connectedAccountId, connectedAccountId),
        eq(emailSendEvents.countedAgainstCap, true),
        gte(emailSendEvents.sentAt, startOfDay),
      ),
    );
  const used = usedRow[0]?.n ?? 0;

  const bypassedRow = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(emailSendEvents)
    .where(
      and(
        eq(emailSendEvents.connectedAccountId, connectedAccountId),
        eq(emailSendEvents.capBypassed, true),
        gte(emailSendEvents.sentAt, startOfDay),
      ),
    );
  const bypassedToday = bypassedRow[0]?.n ?? 0;

  const remaining = Math.max(0, cap - used);
  return { used, cap, remaining, atCap: used >= cap, bypassedToday };
}

/**
 * Classify a send as cold or warm. The thread is "warm" if it
 * already has at least one inbound message before this send; "cold"
 * otherwise (new thread, or thread that's never received a reply).
 */
export async function classifySend(opts: {
  threadId: string | null;
}): Promise<"cold" | "warm"> {
  if (!opts.threadId) return "cold";
  const inbound = await db
    .select({ id: emailMessages.id })
    .from(emailMessages)
    .where(and(eq(emailMessages.threadId, opts.threadId), eq(emailMessages.direction, "inbound")))
    .limit(1);
  return inbound[0] ? "warm" : "cold";
}

export type PreflightResult =
  | { ok: true; category: "cold" | "warm"; usage: SendUsage }
  | { ok: false; reason: "at_cap"; usage: SendUsage; category: "cold" };

/**
 * Run before sending. Classifies the send + checks the cap. Returns
 * { ok: false, reason: 'at_cap' } when a cold send would push the
 * account past its cap. The caller can then either block, or — if
 * the actor is admin and supplies bypassCap=true — call sendGmailMessage
 * anyway and pass capBypassed=true to recordSendEvent.
 *
 * Warm sends never block.
 */
export async function preflightSend(opts: {
  connectedAccountId: string;
  threadId: string | null;
}): Promise<PreflightResult> {
  const category = await classifySend({ threadId: opts.threadId });
  const usage = await loadSendUsage(opts.connectedAccountId);
  if (category === "cold" && usage.atCap) {
    return { ok: false, reason: "at_cap", usage, category };
  }
  return { ok: true, category, usage };
}

/**
 * Record a send event AFTER sendGmailMessage succeeds. Idempotent
 * via the natural ordering of the caller: only call once per
 * successful send.
 *
 * Phase C.1 adds templateId + teamId. teamId is required for new
 * sends; legacy backfill in migration 0071 handles existing rows.
 * templateId is optional (null = freeform compose).
 */
export async function recordSendEvent(opts: {
  connectedAccountId: string;
  threadId: string | null;
  sentByUserId: string;
  recipientEmail: string;
  category: "cold" | "warm";
  capBypassed?: boolean;
  /** Template used for this send, if any (Phase C.1). */
  templateId?: string | null;
  /** Owning team — denormalized for fast analytics queries
   *  (Phase C.1). Required for new sends. */
  teamId: string;
  /** Operational send-type taxonomy (migration 0088). Optional and
   *  backward-compatible: when omitted, send_type mirrors `category`
   *  (cold/warm) and the cap behaves exactly as before. Pass
   *  'operational' for transactional/internal mail that must NOT eat
   *  the daily cold budget -- that intent forces countedAgainstCap to
   *  false regardless of category. countedAgainstCap remains the
   *  authoritative cap flag for loadSendUsage. */
  intent?: SendType;
}): Promise<void> {
  // send_type defaults to the cap category so existing callers (which
  // don't pass intent) record 'cold'/'warm' exactly as before.
  const sendType: SendType = opts.intent ?? opts.category;
  // Cold sends count against the cap; warm sends do not. Operational
  // mail never counts against the cold budget regardless of category.
  // Bypassed cold sends are still marked counted=true so the operator
  // UI shows a true picture of inbox usage today.
  const countedAgainstCap = sendType !== "operational" && opts.category === "cold";
  await db.insert(emailSendEvents).values({
    connectedAccountId: opts.connectedAccountId,
    threadId: opts.threadId,
    sentByUserId: opts.sentByUserId,
    recipientEmail: opts.recipientEmail,
    category: opts.category,
    sendType,
    countedAgainstCap,
    capBypassed: Boolean(opts.capBypassed),
    templateId: opts.templateId ?? null,
    teamId: opts.teamId,
  });
}
