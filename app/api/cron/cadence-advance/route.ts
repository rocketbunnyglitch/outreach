/**
 * POST /api/cron/cadence-advance
 *   Header: X-Cron-Secret: <env.CRON_SECRET>
 *
 * Daily cadence-advance pass (Phase 1.10). Turns due cadence touches into
 * review-ready engine drafts. Recommended schedule: every morning around the
 * start of business in the operator timezone.
 *
 *   0 6 * * * curl -sS -X POST \
 *     -H "X-Cron-Secret: $CRON_SECRET" \
 *     https://outreach.barcrawlconnect.com/api/cron/cadence-advance \
 *     > /dev/null
 *
 * Idempotent -- a thread is paused after its draft is generated, so back-to-back
 * runs converge. Dormant until Phase 1.11 backfills cadence_state (no
 * cadence_state set => the scan returns nothing). Runs alongside the OLD
 * follow-up-cadence cron during the cutover.
 */

import { runCadenceAdvance } from "@/lib/cadence-advance";
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
  const got = req.headers.get("x-cron-secret");
  if (got !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    return await recordCronRun("cadence-advance", async () => {
      const result = await runCadenceAdvance();
      return NextResponse.json({ ok: true, ...result });
    });
  } catch (err) {
    logger.error({ err }, "cadence-advance cron route failed");
    return NextResponse.json({ error: "cadence-advance failed" }, { status: 500 });
  }
}
