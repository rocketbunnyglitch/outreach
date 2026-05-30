/**
 * POST /api/cron/scheduled-sends
 *   Header: X-Cron-Secret: <env.CRON_SECRET>
 *
 * Dispatches every email_drafts row whose scheduled_for has elapsed
 * + isn't already sent. Each draft runs through composeAndSend
 * scoped to its own owner so per-user cap + audit + team scope all
 * work correctly.
 *
 * Recommended cadence: every 5 minutes.
 *
 *   *\/5 * * * * curl -sS -X POST \
 *     -H "X-Cron-Secret: $CRON_SECRET" \
 *     https://outreach.barcrawlconnect.com/api/cron/scheduled-sends \
 *     > /dev/null
 *
 * Idempotent: re-running mid-tick is safe (sent_at IS NULL filter
 * + 100/tick cap prevents double sends).
 */

import { logger } from "@/lib/logger";
import { runScheduledSends } from "@/lib/scheduled-send-runner";
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
    const result = await runScheduledSends();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    logger.error({ err }, "scheduled-sends cron route failed");
    return NextResponse.json({ error: "scheduled-sends failed" }, { status: 500 });
  }
}
