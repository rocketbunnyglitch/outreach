/**
 * POST /api/cron/inbox-alerts
 *   Header: X-Cron-Secret: <env.CRON_SECRET>
 *
 * Walks every enabled inbox_alert_rule, evaluates against the
 * latest stats, fires + records dispatches when thresholds are
 * crossed. Cadence: every 30 minutes.
 *
 *   *\/30 * * * * curl -sS -X POST \
 *     -H "X-Cron-Secret: $CRON_SECRET" \
 *     https://outreach.barcrawlconnect.com/api/cron/inbox-alerts \
 *     > /dev/null
 *
 * Rate-limited: a fired rule won't re-fire within 24h. Adjust
 * RATE_LIMIT_HOURS in lib/inbox-alerts.ts if needed.
 */

import { runAlertEvaluator } from "@/lib/inbox-alerts";
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
    const result = await runAlertEvaluator();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    logger.error({ err }, "inbox-alerts cron route failed");
    return NextResponse.json({ error: "inbox-alerts failed" }, { status: 500 });
  }
}
