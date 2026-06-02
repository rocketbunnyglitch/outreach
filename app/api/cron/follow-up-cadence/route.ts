/**
 * POST /api/cron/follow-up-cadence
 *   Header: X-Cron-Secret: <env.CRON_SECRET>
 *
 * Daily follow-up cadence pass. Recommended cadence: once a day
 * around the start of business (e.g. 09:00 local).
 *
 *   0 9 * * * curl -sS -X POST \
 *     -H "X-Cron-Secret: $CRON_SECRET" \
 *     https://outreach.barcrawlconnect.com/api/cron/follow-up-cadence \
 *     > /dev/null
 *
 * Idempotent — back-to-back runs converge to the same state. Safe to
 * call hourly if needed.
 */

import { recordCronRun } from "@/lib/cron-runs";
import { runFollowUpCadence } from "@/lib/follow-up-cadence";
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
    return await recordCronRun("follow-up-cadence", async () => {
      const result = await runFollowUpCadence();
      return NextResponse.json({ ok: true, ...result });
    });
  } catch (err) {
    logger.error({ err }, "follow-up-cadence cron route failed");
    return NextResponse.json({ error: "follow-up-cadence failed" }, { status: 500 });
  }
}
