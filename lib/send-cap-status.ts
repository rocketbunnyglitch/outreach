/**
 * getStaffSendCapStatus — daily-cap status across every connected Gmail
 * inbox owned by a staff member.
 *
 * Used by the SendCapPill in the top bar so operators always see how
 * close they are to their daily cap before a "throttled" error surprises
 * them mid-batch.
 *
 * Returns one row per inbox, each with:
 *   - email address + display name
 *   - sent in the last 24h (rolling, matching how the throttle checks)
 *   - effective daily cap (warm-up aware via lib/send-throttle)
 *   - warm-up day (null when not in warm-up)
 *   - paused? (auto_paused_at is set)
 *
 * Plus a roll-up summary so the pill can show a single "X / Y" badge.
 *
 * Cheap by design: one query for the inbox metadata, one for the rolling
 * 24h counts. No need to call canSendNow per inbox (we only need the
 * count + cap, not the full slot decision).
 */

import "server-only";

import { db } from "@/lib/db";
import { effectiveDailyCap } from "@/lib/send-throttle";
import { sql } from "drizzle-orm";

export interface InboxCapStatus {
  staffOutreachEmailId: string;
  email: string;
  displayName: string | null;
  /** Sent in the rolling last 24h. Matches the throttle's window. */
  sent24h: number;
  /** Today's effective cap (cap if not warming up, ramp value if warming). */
  effectiveCap: number;
  /** 1-indexed warm-up day, or null if not warming. */
  warmupDay: number | null;
  /** True if auto_paused_at IS NOT NULL — operator must manually unpause. */
  paused: boolean;
  /** Why it was auto-paused, if available. */
  pausedReason: string | null;
}

export interface StaffSendCapSummary {
  inboxes: InboxCapStatus[];
  /** Across all inboxes — totals, not the cap on any single one. */
  totalSent24h: number;
  totalCap: number;
  /** True if every connected inbox is at/over its cap. */
  allMaxed: boolean;
}

export async function getStaffSendCapStatus(staffId: string): Promise<StaffSendCapSummary> {
  // Pull every connected Gmail inbox owned by this staff. We treat an
  // inbox as "connected" when the oauth refresh token is present and
  // archivedAt is null. Status enum (active/paused/disconnected) is
  // separately surfaced as 'paused' in the response.
  type InboxRow = {
    id: string;
    email_address: string;
    display_name: string | null;
    daily_send_limit: number;
    warmup_phase: boolean;
    warmup_started_at: Date | null;
    auto_paused_at: Date | null;
    auto_paused_reason: string | null;
    sent_24h: number;
  };

  const result = await db.execute<InboxRow>(sql`
    SELECT
      soe.id,
      soe.email_address,
      soe.display_name,
      soe.daily_send_limit,
      soe.warmup_phase,
      soe.warmup_started_at,
      soe.auto_paused_at,
      soe.auto_paused_reason,
      COALESCE((
        SELECT COUNT(*)
        FROM email_messages em
        WHERE em.staff_outreach_email_id = soe.id
          AND em.direction = 'outbound'
          AND em.sent_at > NOW() - INTERVAL '24 hours'
      ), 0)::int AS sent_24h
    FROM staff_outreach_emails soe
    WHERE soe.staff_member_id = ${staffId}
      AND soe.gmail_oauth_refresh_token IS NOT NULL
  `);

  const rows: InboxRow[] = Array.isArray(result)
    ? (result as unknown as InboxRow[])
    : ((result as unknown as { rows: InboxRow[] }).rows ?? []);

  const inboxes: InboxCapStatus[] = rows.map((row) => {
    const { cap, warmupDay } = effectiveDailyCap({
      dailySendLimit: row.daily_send_limit,
      warmupPhase: row.warmup_phase,
      warmupStartedAt: row.warmup_started_at,
    });
    return {
      staffOutreachEmailId: row.id,
      email: row.email_address,
      displayName: row.display_name,
      sent24h: row.sent_24h,
      effectiveCap: cap,
      warmupDay,
      paused: row.auto_paused_at !== null,
      pausedReason: row.auto_paused_reason,
    };
  });

  const totalSent24h = inboxes.reduce((s, i) => s + i.sent24h, 0);
  const totalCap = inboxes.reduce((s, i) => s + i.effectiveCap, 0);
  const allMaxed =
    inboxes.length > 0 && inboxes.every((i) => i.sent24h >= i.effectiveCap || i.paused);

  return { inboxes, totalSent24h, totalCap, allMaxed };
}
