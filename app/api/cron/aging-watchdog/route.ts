/**
 * POST /api/cron/aging-watchdog
 *   Header: X-Cron-Secret: <env.CRON_SECRET>
 *
 * Daily staleness scan (best-in-class item #2, 2026-06-11): puts a
 * clock on every kind of state that quietly rots — untouched cold
 * venues, aging replies, unshipped wristbands, hostless priority
 * crawls, stuck queued drafts — and pings the owner. Notifications
 * only; never mutates workflow state.
 *
 * Recommended cadence: daily, before the workday.
 *
 *   30 11 * * * curl -sS -X POST \
 *     -H "X-Cron-Secret: $CRON_SECRET" \
 *     http://127.0.0.1:3001/api/cron/aging-watchdog > /dev/null
 */

import { runAgingWatchdog } from "@/lib/aging-watchdog";
import { recordCronRun } from "@/lib/cron-runs";
import { logger } from "@/lib/logger";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "CRON_SECRET not configured on server" }, { status: 500 });
  }
  if (req.headers.get("x-cron-secret") !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return await recordCronRun("aging-watchdog", async () => {
      const result = await runAgingWatchdog();
      return NextResponse.json({ ok: true, ...result });
    });
  } catch (err) {
    logger.error({ err }, "aging-watchdog cron route failed");
    return NextResponse.json({ error: "aging-watchdog failed" }, { status: 500 });
  }
}
