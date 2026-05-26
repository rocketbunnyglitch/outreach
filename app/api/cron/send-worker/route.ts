/**
 * Send worker tick endpoint.
 *
 * POST /api/cron/send-worker
 *   Header: X-Cron-Secret: <env.CRON_SECRET>
 *
 * Calls drainScheduledSends() and returns the result as JSON.
 *
 * Two ways to drive this:
 *
 *   1. System cron on the VPS (recommended for now):
 *        * * * * * curl -sS -X POST -H "X-Cron-Secret: $CRON_SECRET" \
 *          https://outreach.barcrawlconnect.com/api/cron/send-worker > /dev/null
 *
 *   2. Vercel cron (if we ever migrate to Vercel):
 *        Add to vercel.json crons array.
 *
 * The endpoint is idempotent — no harm in firing it more than once per
 * minute (SKIP LOCKED prevents double-claims).
 */

import { logger } from "@/lib/logger";
import { drainFollowups, drainScheduledSends } from "@/lib/send-worker";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // Auth: shared secret in header. CRON_SECRET env var is set in .env.
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "CRON_SECRET not configured on server" }, { status: 500 });
  }
  const provided = request.headers.get("x-cron-secret");
  if (provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [scheduled, followups] = await Promise.all([drainScheduledSends(), drainFollowups()]);
    if (scheduled.claimed > 0 || followups.claimed > 0) {
      logger.info({ scheduled, followups }, "send worker tick");
    }
    return NextResponse.json({ scheduled, followups });
  } catch (err) {
    logger.error({ err }, "send worker tick failed");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Worker error" },
      { status: 500 },
    );
  }
}

// Also accept GET for quick manual testing (still requires the secret)
export async function GET(request: Request) {
  return POST(request);
}
