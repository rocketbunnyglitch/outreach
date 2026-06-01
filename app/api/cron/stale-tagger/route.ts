/**
 * POST /api/cron/stale-tagger
 *   Header: X-Cron-Secret: <env.CRON_SECRET>
 *
 * Runs the inbox stale-tagger that flags threads past their SLA
 * window. Recommended cadence: every 10 minutes.
 *
 *   *\/10 * * * * curl -sS -X POST \
 *     -H "X-Cron-Secret: $CRON_SECRET" \
 *     https://outreach.barcrawlconnect.com/api/cron/stale-tagger \
 *     > /dev/null
 *
 * Idempotent — running back-to-back yields the same final state.
 */

import { logger } from "@/lib/logger";
import { runStaleTagger } from "@/lib/stale-tagger";
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
    // The canonical runStaleTagger now covers Rule 5 (unassigned
    // needs_reply > 1h) -- it used to live in
    // lib/stale-rules-aux.ts as a separate pass invoked here, but
    // the aux-pass approach had a known timestamp-churn bug
    // (stale_since reset on every tick). Folding it into the
    // canonical CASE fixes that. See lib/stale-tagger.ts for the
    // full rule list.
    const result = await runStaleTagger();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    logger.error({ err }, "stale-tagger cron route failed");
    return NextResponse.json({ error: "stale-tagger failed" }, { status: 500 });
  }
}
