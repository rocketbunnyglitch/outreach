/**
 * POST /api/cron/gmail-poll
 *   Header: X-Cron-Secret: <env.CRON_SECRET>
 *
 * Drives one pass of the Gmail polling worker. Wire to system cron at
 * 5-minute cadence:
 *
 *   *\/5 * * * * curl -sS -X POST \
 *     -H "X-Cron-Secret: $CRON_SECRET" \
 *     https://outreach.barcrawlconnect.com/api/cron/gmail-poll \
 *     > /dev/null
 *
 * Idempotent — SKIP LOCKED ensures two overlapping invocations don't
 * claim the same inbox.
 */

import { recordCronRun } from "@/lib/cron-runs";
import { drainGmailPolls } from "@/lib/gmail-poll-worker";
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
    return await recordCronRun("gmail-poll", async () => {
      const summary = await drainGmailPolls();
      const ms = Date.now() - start;
      logger.info({ ...summary, ms }, "gmail-poll drain complete");
      return NextResponse.json({ ok: true, ms, ...summary });
    });
  } catch (err) {
    logger.error({ err }, "gmail-poll drain failed");
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}
