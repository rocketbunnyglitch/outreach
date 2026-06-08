"use server";

/**
 * "Send at best time" server action (Tier-2 send-time optimization).
 *
 * Resolves the venue's city timezone + that venue's inbound-reply history, then
 * asks the pure lib/send-time.bestSendWindow for the next good LOCAL send slot
 * (off the dinner/service rush; biased to the venue's reply hour when known).
 *
 * Timing ONLY -- deliverability-neutral. It returns a `scheduled_for` ISO; the
 * composer feeds that to the existing operator-approved scheduleDraftSend path
 * (lib/scheduled-send-runner.ts dispatches it). It NEVER sends and never
 * touches the send-safety boundary.
 */

import { cities, cityCampaigns, emailMessages, emailThreads, venues } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { type ReplyHistoryPoint, bestSendWindow, getZonedParts } from "@/lib/send-time";
import { and, desc, eq, gte } from "drizzle-orm";

/** App-wide fallback zone (matches users.timezone default) when a venue/city
 *  has no resolvable city timezone. */
const DEFAULT_TZ = "America/Toronto";
/** How far back to look for reply-hour history, and the row cap. */
const HISTORY_LOOKBACK_DAYS = 120;
const HISTORY_ROW_CAP = 100;

export interface BestSendTimeResult {
  /** Suggested scheduled_for, ISO. */
  iso: string;
  /** Whether the suggestion came from this venue's reply history or the heuristic. */
  source: "reply_history" | "heuristic";
  /** Whether RIGHT NOW is a peak-service window for this venue (for the hint). */
  isPeakNow: boolean;
  /** Human-readable rationale. */
  reason: string;
  /** Localized label of the suggested time, e.g. "Sat, Jun 13, 11:00 AM". */
  localLabel: string;
  /** The IANA zone used. */
  timezone: string;
}

async function resolveTimezone(
  venueId?: string | null,
  cityCampaignId?: string | null,
): Promise<string> {
  if (cityCampaignId) {
    const [row] = await db
      .select({ tz: cities.timezone })
      .from(cityCampaigns)
      .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
      .where(eq(cityCampaigns.id, cityCampaignId))
      .limit(1);
    if (row?.tz) return row.tz;
  }
  if (venueId) {
    const [row] = await db
      .select({ tz: cities.timezone })
      .from(venues)
      .innerJoin(cities, eq(cities.id, venues.cityId))
      .where(eq(venues.id, venueId))
      .limit(1);
    if (row?.tz) return row.tz;
  }
  return DEFAULT_TZ;
}

async function loadReplyHistory(
  venueId: string | null | undefined,
  timezone: string,
): Promise<ReplyHistoryPoint[]> {
  if (!venueId) return [];
  const since = new Date(Date.now() - HISTORY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ sentAt: emailMessages.sentAt })
    .from(emailMessages)
    .innerJoin(emailThreads, eq(emailThreads.id, emailMessages.threadId))
    .where(
      and(
        eq(emailThreads.venueId, venueId),
        eq(emailMessages.direction, "inbound"),
        gte(emailMessages.sentAt, since),
      ),
    )
    .orderBy(desc(emailMessages.sentAt))
    .limit(HISTORY_ROW_CAP);
  return rows.map((r) => {
    const p = getZonedParts(timezone, r.sentAt);
    return { localHour: p.hour, localDay: p.weekday };
  });
}

export async function getBestSendTime(input: {
  venueId?: string | null;
  cityCampaignId?: string | null;
}): Promise<ActionResult<BestSendTimeResult>> {
  await requireStaff();
  try {
    const timezone = await resolveTimezone(input.venueId, input.cityCampaignId);
    const replyHistory = await loadReplyHistory(input.venueId, timezone);
    const now = new Date();
    const r = bestSendWindow({ cityTimezone: timezone, now, replyHistory });
    const localLabel = r.sendAt.toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone,
    });
    return {
      ok: true,
      data: {
        iso: r.sendAt.toISOString(),
        source: r.source,
        isPeakNow: r.isPeakNow,
        reason: r.reason,
        localLabel,
        timezone,
      },
    };
  } catch (err) {
    logger.error({ err, input }, "getBestSendTime failed");
    return { ok: false, error: "Couldn't compute a best send time." };
  }
}
