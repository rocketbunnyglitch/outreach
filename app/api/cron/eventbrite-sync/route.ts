/**
 * POST /api/cron/eventbrite-sync
 *   Header: X-Cron-Secret: <env.CRON_SECRET>
 *
 * Drives one pass of the Eventbrite ticket-count sync worker. Wire
 * to system cron at 15-minute cadence:
 *
 *   *\/15 * * * * curl -sS -X POST \
 *     -H "X-Cron-Secret: $CRON_SECRET" \
 *     https://outreach.barcrawlconnect.com/api/cron/eventbrite-sync \
 *     > /dev/null
 *
 * 15 minutes is the chosen cadence because:
 *   - Ticket sales shift in tens, not seconds — fresher than this is
 *     wasted EB API budget
 *   - We have ~1000 req/hour on the EB token; a sync of 20 events
 *     burns 40 calls × 4 syncs/hr = 160/hr. Plenty of headroom.
 *   - Operators have a manual "Refresh from Eventbrite" button for
 *     when they need now-numbers.
 *
 * Idempotent — each sync is read-then-write per event; concurrent
 * runs simply over-write the same fresh number. No locks needed.
 */

import { recordCronRun } from "@/lib/cron-runs";
import { syncAllEventbriteTicketCounts } from "@/lib/eventbrite-sync";
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
    return new NextResponse("Forbidden", { status: 403 });
  }

  const start = Date.now();
  try {
    return await recordCronRun("eventbrite-sync", async () => {
      const summary = await syncAllEventbriteTicketCounts();
      const ms = Date.now() - start;
      if (summary.notConfigured) {
        logger.info({ ms }, "eventbrite-sync skipped: token not configured");
      } else {
        logger.info(
          {
            attempted: summary.attempted,
            succeeded: summary.succeeded,
            failed: summary.failed,
            ms,
          },
          "eventbrite-sync drain complete",
        );
      }
      return NextResponse.json({ ok: true, ms, ...summary });
    });
  } catch (err) {
    logger.error({ err }, "eventbrite-sync drain failed");
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "sync failed" },
      { status: 500 },
    );
  }
}
