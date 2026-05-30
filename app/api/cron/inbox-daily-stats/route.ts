/**
 * POST /api/cron/inbox-daily-stats
 *   Header: X-Cron-Secret: <env.CRON_SECRET>
 *
 * Aggregates yesterday's per-inbox stats into inbox_daily_stats.
 * Recommended cadence: once daily, shortly after UTC midnight:
 *
 *   15 0 * * * curl -sS -X POST \
 *     -H "X-Cron-Secret: $CRON_SECRET" \
 *     https://outreach.barcrawlconnect.com/api/cron/inbox-daily-stats \
 *     > /dev/null
 *
 * Idempotent — re-running for the same day upserts via the unique
 * (account, stat_date) constraint.
 */

import { runDailyInboxStats } from "@/lib/inbox-daily-stats";
import { logger } from "@/lib/logger";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "CRON_SECRET not configured on server" }, { status: 500 });
  }
  const got = req.headers.get("x-cron-secret");
  if (got !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await runDailyInboxStats();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    logger.error({ err }, "inbox-daily-stats cron route failed");
    return NextResponse.json({ error: "inbox-daily-stats failed" }, { status: 500 });
  }
}
