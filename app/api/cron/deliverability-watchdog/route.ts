/**
 * POST /api/cron/deliverability-watchdog
 *   Header: X-Cron-Secret: <env.CRON_SECRET>
 *
 * Hourly per-inbox sending-health check (best-in-class item #3,
 * 2026-06-11) — ALERT MODE: pings admins when an inbox's 7-day bounce
 * rate crosses thresholds, before the domain takes reputation damage.
 * No automatic throttling in v1.
 *
 * Recommended cadence: hourly.
 *
 *   5 * * * * curl -sS -X POST \
 *     -H "X-Cron-Secret: $CRON_SECRET" \
 *     http://127.0.0.1:3001/api/cron/deliverability-watchdog > /dev/null
 */

import { recordCronRun } from "@/lib/cron-runs";
import { runDeliverabilityWatchdog } from "@/lib/deliverability-watchdog";
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
    return await recordCronRun("deliverability-watchdog", async () => {
      const result = await runDeliverabilityWatchdog();
      return NextResponse.json({ ok: true, ...result });
    });
  } catch (err) {
    logger.error({ err }, "deliverability-watchdog cron route failed");
    return NextResponse.json({ error: "deliverability-watchdog failed" }, { status: 500 });
  }
}
