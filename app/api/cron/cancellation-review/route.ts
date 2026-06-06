/**
 * POST /api/cron/cancellation-review
 *   Header: X-Cron-Secret: <env.CRON_SECRET>
 *
 * Phase 6.1 [ReferenceDoc 7.9]. Mid event-week, scans upcoming crawls for
 * cancellation-review risk signals (structural gaps, low ticket sales, confirmed
 * venues gone quiet) and notifies the city lead. The engine NEVER auto-cancels;
 * this only surfaces a review queue for a human to act on.
 *
 * Recommended cadence: once each morning Tue/Wed/Thu of event week. Per 7.9 the
 * review is event-week-bound, so a daily Tue-Thu trigger covers Wave 1 (Tue) and
 * Wave 2 (Wed/Thu). Re-running within the same week is safe -- the scanner
 * dedupes notifications per event over a 7-day window.
 *
 *   0 14 * * 2,3,4 curl -sS -X POST \
 *     -H "X-Cron-Secret: $CRON_SECRET" \
 *     https://outreach.barcrawlconnect.com/api/cron/cancellation-review \
 *     > /dev/null
 */

import { runCancellationReview } from "@/lib/cancellation-review";
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
    return await recordCronRun("cancellation-review", async () => {
      const result = await runCancellationReview();
      // Keep the cron_runs summary compact: counts, not the full row set.
      return NextResponse.json({
        ok: true,
        scanned: result.scanned,
        flagged: result.flagged,
        notified: result.notified,
      });
    });
  } catch (err) {
    logger.error({ err }, "cancellation-review cron route failed");
    return NextResponse.json({ error: "cancellation-review failed" }, { status: 500 });
  }
}
