/**
 * Send throttle — the deliverability gatekeeper.
 *
 * Every cold send must go through canSendNow() first. Returns either:
 *   - { ok: true, effectiveCap, sent24h }
 *   - { ok: false, reason, retryAt? }
 *
 * Rules enforced (in order):
 *   1. Inbox is connected (status='connected', not auto-paused)
 *   2. Within business hours (9am-5pm local) and weekday if those flags are on
 *   3. 24h rolling window count < effective daily cap (warm-up ramp aware)
 *   4. 1h rolling window count < hourly cap
 *   5. Last send was ≥ min_seconds_between_sends ago
 *
 * Warm-up ramp:
 *   When warmup_phase=true, effective cap = min(daily_send_limit,
 *   10 + days_since_warmup_started * 2). At day 14 the ramp value
 *   (10 + 28 = 38) exceeds the default cap (30), so the cap takes over.
 *
 * Auto-graduation: when the ramp value catches up to daily_send_limit
 * (or 14 days elapse, whichever first), the next successful send flips
 * warmup_phase to false. Handled in lib/send-throttle-actions.ts after
 * a send completes.
 *
 * Transactional sends (confirmation cascade, poster delivery, info
 * sheets) bypass this gate via canSendNow({ bypass: true }). Those go
 * to existing relationships, not cold prospects — the spam math
 * doesn't apply.
 */

import "server-only";

import { outreachLog, staffOutreachEmails } from "@/db/schema";
import { db } from "@/lib/db";
import { and, eq, gte, sql } from "drizzle-orm";

export interface ThrottleAllowed {
  ok: true;
  effectiveDailyCap: number;
  sent24h: number;
  sent1h: number;
  /** Day of warm-up (0 = today is day 1, 1 = day 2, ...). null when warmup_phase=false. */
  warmupDay: number | null;
}

export interface ThrottleDenied {
  ok: false;
  /** Machine-readable reason code, for UI branching */
  code:
    | "inbox_not_connected"
    | "auto_paused"
    | "outside_business_hours"
    | "weekend"
    | "daily_cap_reached"
    | "hourly_cap_reached"
    | "spacing_floor"
    | "inbox_not_found";
  /** Human-readable explanation, ready to show in UI */
  reason: string;
  /** When the next slot opens (ISO string), if computable */
  retryAt?: string;
  /** Context the UI may want to display */
  context?: {
    effectiveDailyCap?: number;
    sent24h?: number;
    sent1h?: number;
    secondsUntilNextSlot?: number;
  };
}

export type ThrottleResult = ThrottleAllowed | ThrottleDenied;

interface InboxRow extends Record<string, unknown> {
  id: string;
  status: string;
  dailySendLimit: number;
  hourlySendLimit: number;
  minSecondsBetweenSends: number;
  warmupPhase: boolean;
  warmupStartedAt: Date | null;
  businessHoursOnly: boolean;
  weekdaysOnly: boolean;
  autoPausedAt: Date | null;
  autoPausedReason: string | null;
  staffTimezone: string;
}

/**
 * Compute the effective daily cap for an inbox given warm-up state.
 *
 * Day 1-of-warmup: 10 sends. +2 per day. At day 14 the ramp value is
 * 38 which exceeds the default cap (30), so the cap takes over.
 *
 * The "day" math uses a calendar-day diff (not 24h chunks) — feels more
 * natural to the operator ("you're on day 5 of warm-up").
 */
export function effectiveDailyCap(inbox: {
  dailySendLimit: number;
  warmupPhase: boolean;
  warmupStartedAt: Date | null;
}): { cap: number; warmupDay: number | null } {
  if (!inbox.warmupPhase || !inbox.warmupStartedAt) {
    return { cap: inbox.dailySendLimit, warmupDay: null };
  }
  const dayMs = 24 * 60 * 60 * 1000;
  const daysSince = Math.max(0, Math.floor((Date.now() - inbox.warmupStartedAt.getTime()) / dayMs));
  if (daysSince >= 14) {
    // Ramp reached/exceeded the cap. Auto-graduation happens on next send.
    return { cap: inbox.dailySendLimit, warmupDay: 14 };
  }
  const rampValue = 10 + daysSince * 2;
  return {
    cap: Math.min(inbox.dailySendLimit, rampValue),
    warmupDay: daysSince + 1,
  };
}

/**
 * The main check. Looks up inbox config + staff timezone in one query,
 * then queries outreach_log for the rolling-window counts.
 */
export async function canSendNow(opts: {
  staffOutreachEmailId: string;
  /**
   * When true, skip business-hours + daily/hourly caps. Used for
   * transactional sends (confirmation cascade, poster delivery, info
   * sheets) going to existing relationships. The 24h Gmail hard limit
   * still applies — Google enforces that, not us.
   */
  bypass?: boolean;
  /** Override "now" for tests. Defaults to current time. */
  now?: Date;
}): Promise<ThrottleResult> {
  const now = opts.now ?? new Date();

  // Pull inbox + staff timezone in one query
  const rows = await db.execute<InboxRow>(sql`
    SELECT
      soe.id,
      soe.status,
      soe.daily_send_limit AS "dailySendLimit",
      soe.hourly_send_limit AS "hourlySendLimit",
      soe.min_seconds_between_sends AS "minSecondsBetweenSends",
      soe.warmup_phase AS "warmupPhase",
      soe.warmup_started_at AS "warmupStartedAt",
      soe.business_hours_only AS "businessHoursOnly",
      soe.weekdays_only AS "weekdaysOnly",
      soe.auto_paused_at AS "autoPausedAt",
      soe.auto_paused_reason AS "autoPausedReason",
      s.timezone AS "staffTimezone"
    FROM staff_outreach_emails soe
    JOIN staff_members s ON s.id = soe.staff_member_id
    WHERE soe.id = ${opts.staffOutreachEmailId}
    LIMIT 1
  `);
  const list = Array.isArray(rows)
    ? (rows as unknown as InboxRow[])
    : ((rows as unknown as { rows: InboxRow[] }).rows ?? []);
  const inbox = list[0];

  if (!inbox) {
    return {
      ok: false,
      code: "inbox_not_found",
      reason: "Inbox configuration not found.",
    };
  }

  if (inbox.status !== "connected") {
    return {
      ok: false,
      code: "inbox_not_connected",
      reason: "This Gmail inbox isn't connected. Visit Settings → Inboxes to reconnect.",
    };
  }

  if (inbox.autoPausedAt) {
    return {
      ok: false,
      code: "auto_paused",
      reason: `Inbox auto-paused: ${inbox.autoPausedReason ?? "unknown reason"}. Review deliverability and clear the pause in Settings.`,
    };
  }

  // Business-hours / weekday gate (skipped if bypass=true)
  if (!opts.bypass) {
    const local = nowInTimezone(now, inbox.staffTimezone);

    if (inbox.weekdaysOnly && (local.dayOfWeek === 0 || local.dayOfWeek === 6)) {
      return {
        ok: false,
        code: "weekend",
        reason:
          "Cold sends are weekday-only. Switch off 'weekdays only' in inbox settings to override.",
        retryAt: nextWeekday9amISO(now, inbox.staffTimezone),
      };
    }

    if (inbox.businessHoursOnly) {
      if (local.hour < 9 || local.hour >= 17) {
        return {
          ok: false,
          code: "outside_business_hours",
          reason: `Outside 9am-5pm in your timezone (${inbox.staffTimezone}). Cold sends are gated to business hours by default.`,
          retryAt: next9amISO(now, inbox.staffTimezone),
        };
      }
    }
  }

  // Compute the effective daily cap (warm-up aware)
  const { cap, warmupDay } = effectiveDailyCap(inbox);

  // Rolling 24h count
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const counts = await db
    .select({
      sent24h: sql<number>`count(*) filter (where created_at >= ${twentyFourHoursAgo})::int`,
      sent1h: sql<number>`count(*) filter (where created_at >= ${oneHourAgo})::int`,
      lastSentAt: sql<Date | null>`max(created_at)`,
    })
    .from(outreachLog)
    .where(
      and(
        eq(outreachLog.staffOutreachEmailId, opts.staffOutreachEmailId),
        eq(outreachLog.channel, "email"),
        eq(outreachLog.outcome, "sent"),
        gte(outreachLog.createdAt, twentyFourHoursAgo),
      ),
    );

  const sent24h = Number(counts[0]?.sent24h ?? 0);
  const sent1h = Number(counts[0]?.sent1h ?? 0);
  const lastSentAt = counts[0]?.lastSentAt ? new Date(counts[0].lastSentAt) : null;

  // Daily cap
  if (!opts.bypass && sent24h >= cap) {
    // Compute when the oldest send rolls off (giving back a slot)
    const oldest = await db
      .select({ createdAt: outreachLog.createdAt })
      .from(outreachLog)
      .where(
        and(
          eq(outreachLog.staffOutreachEmailId, opts.staffOutreachEmailId),
          eq(outreachLog.channel, "email"),
          eq(outreachLog.outcome, "sent"),
          gte(outreachLog.createdAt, twentyFourHoursAgo),
        ),
      )
      .orderBy(outreachLog.createdAt)
      .limit(1);
    const retryAt = oldest[0]?.createdAt
      ? new Date(oldest[0].createdAt.getTime() + 24 * 60 * 60 * 1000).toISOString()
      : undefined;

    return {
      ok: false,
      code: "daily_cap_reached",
      reason: `Daily send cap reached (${sent24h}/${cap}${warmupDay ? `, warm-up day ${warmupDay}/14` : ""}). Next slot opens when the oldest send rolls off.`,
      retryAt,
      context: { effectiveDailyCap: cap, sent24h, sent1h },
    };
  }

  // Hourly cap
  if (!opts.bypass && sent1h >= inbox.hourlySendLimit) {
    return {
      ok: false,
      code: "hourly_cap_reached",
      reason: `Hourly cap reached (${sent1h}/${inbox.hourlySendLimit}). Spread sends across the day for better deliverability.`,
      context: { effectiveDailyCap: cap, sent24h, sent1h },
    };
  }

  // Spacing floor
  if (!opts.bypass && lastSentAt) {
    const secondsSince = Math.floor((now.getTime() - lastSentAt.getTime()) / 1000);
    if (secondsSince < inbox.minSecondsBetweenSends) {
      const wait = inbox.minSecondsBetweenSends - secondsSince;
      return {
        ok: false,
        code: "spacing_floor",
        reason: `Wait ${wait}s before next send (spacing floor: ${inbox.minSecondsBetweenSends}s). Helps avoid burst-flagging.`,
        retryAt: new Date(now.getTime() + wait * 1000).toISOString(),
        context: { secondsUntilNextSlot: wait },
      };
    }
  }

  return {
    ok: true,
    effectiveDailyCap: cap,
    sent24h,
    sent1h,
    warmupDay,
  };
}

/**
 * After a successful send, call this to auto-graduate warm-up if the
 * inbox has hit day 14 OR if the daily_send_limit was raised above the
 * current ramp value. Idempotent — calling on an already-graduated
 * inbox is a no-op.
 */
export async function maybeGraduateWarmup(staffOutreachEmailId: string): Promise<void> {
  const row = await db
    .select({
      warmupPhase: staffOutreachEmails.warmupPhase,
      warmupStartedAt: staffOutreachEmails.warmupStartedAt,
      dailySendLimit: staffOutreachEmails.dailySendLimit,
    })
    .from(staffOutreachEmails)
    .where(eq(staffOutreachEmails.id, staffOutreachEmailId))
    .limit(1)
    .then((r) => r[0]);
  if (!row || !row.warmupPhase || !row.warmupStartedAt) return;

  const dayMs = 24 * 60 * 60 * 1000;
  const daysSince = Math.floor((Date.now() - row.warmupStartedAt.getTime()) / dayMs);
  const rampValue = 10 + daysSince * 2;

  if (daysSince >= 14 || rampValue >= row.dailySendLimit) {
    await db
      .update(staffOutreachEmails)
      .set({ warmupPhase: false })
      .where(eq(staffOutreachEmails.id, staffOutreachEmailId));
  }
}

// ---------- timezone helpers ----------

interface LocalTimeParts {
  hour: number;
  minute: number;
  dayOfWeek: number; // 0=Sun, 6=Sat
}

function nowInTimezone(d: Date, timezone: string): LocalTimeParts {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour12: false,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    const parts = fmt.formatToParts(d);
    const partMap = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    const hour = Number.parseInt(partMap.hour ?? "0", 10);
    const minute = Number.parseInt(partMap.minute ?? "0", 10);
    const weekdayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    const dayOfWeek = weekdayMap[partMap.weekday ?? "Mon"] ?? 1;
    return { hour, minute, dayOfWeek };
  } catch {
    // Bad timezone string — fall back to UTC-ish behavior
    return { hour: d.getUTCHours(), minute: d.getUTCMinutes(), dayOfWeek: d.getUTCDay() };
  }
}

function next9amISO(from: Date, timezone: string): string {
  // Compute "next 9am in the inbox's timezone" by:
  //   1. Reading current local hour/minute via Intl
  //   2. Adding (9 - localHour) hours (or +24 if past 9am)
  //   3. Returning the resulting absolute Date as ISO
  const local = nowInTimezone(from, timezone);
  const hoursToAdd = local.hour < 9 ? 9 - local.hour : 24 + (9 - local.hour);
  const target = new Date(from.getTime() + hoursToAdd * 3600 * 1000);
  // Zero out the minutes by subtracting local.minute
  target.setMinutes(target.getMinutes() - local.minute, 0, 0);
  return target.toISOString();
}

function nextWeekday9amISO(from: Date, timezone: string): string {
  const local = nowInTimezone(from, timezone);
  let daysToAdd = 1;
  let dow = (local.dayOfWeek + 1) % 7;
  while (dow === 0 || dow === 6) {
    daysToAdd += 1;
    dow = (dow + 1) % 7;
  }
  const target = new Date(from.getTime() + daysToAdd * 24 * 3600 * 1000);
  // Snap to 9am-ish by reusing next9am logic on the future date
  return next9amISO(target, timezone);
}
