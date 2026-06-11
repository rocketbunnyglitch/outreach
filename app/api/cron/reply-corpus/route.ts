/**
 * POST /api/cron/reply-corpus
 *   Header: X-Cron-Secret: <env.CRON_SECRET>
 *
 * The learning-loop corpus build (operator request 2026-06-11): mines
 * email history into reply_examples + classification_examples and
 * stamps outcomes (confirmed/declined/ghosted). Fully idempotent —
 * re-runs only add what's new, so it doubles as the backfill trigger
 * after deep inbox resyncs land.
 *
 * Recommended cadence: nightly.
 *
 *   20 5 * * * curl -sS -X POST \
 *     -H "X-Cron-Secret: $CRON_SECRET" \
 *     http://127.0.0.1:3001/api/cron/reply-corpus > /dev/null
 */

import { recordCronRun } from "@/lib/cron-runs";
import { logger } from "@/lib/logger";
import { runCorpusBuild } from "@/lib/reply-corpus";
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
    return await recordCronRun("reply-corpus", async () => {
      const result = await runCorpusBuild();
      return NextResponse.json({ ok: true, ...result });
    });
  } catch (err) {
    logger.error({ err }, "reply-corpus cron route failed");
    return NextResponse.json({ error: "reply-corpus failed" }, { status: 500 });
  }
}
