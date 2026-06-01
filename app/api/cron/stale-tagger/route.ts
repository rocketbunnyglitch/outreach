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
import { runAuxStaleRules } from "@/lib/stale-rules-aux";
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
    const result = await runStaleTagger();
    // Run the auxiliary pass right after the canonical tagger so the
    // unassigned-inbound rule is evaluated against the state the main
    // tagger just settled. Its `flagged` count is merged into the
    // response alongside the tagger's newlyStale / cleared.
    const aux = await runAuxStaleRules();
    return NextResponse.json({ ok: true, ...result, ...aux });
  } catch (err) {
    logger.error({ err }, "stale-tagger cron route failed");
    return NextResponse.json({ error: "stale-tagger failed" }, { status: 500 });
  }
}
