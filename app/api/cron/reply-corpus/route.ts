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
import { db } from "@/lib/db";
import { runLivenessMonitor } from "@/lib/liveness-monitor";
import { logger } from "@/lib/logger";
import { runCorpusBuild } from "@/lib/reply-corpus";
import { runScheduledProposals } from "@/lib/template-proposals";
import { sql } from "drizzle-orm";
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
    const response = await recordCronRun("reply-corpus", async () => {
      const result = await runCorpusBuild();
      return NextResponse.json({ ok: true, ...result });
    });

    // Ride-along: refresh template suggestions ~weekly off this nightly cron,
    // so it's hands-off with no separate crontab entry. 7-day gate; failures
    // here never affect the corpus build above.
    try {
      const recent = await db.execute(sql`
        SELECT 1 FROM cron_runs
        WHERE cron_name = 'template-proposals' AND status = 'success'
          AND started_at > now() - interval '6 days'
        LIMIT 1
      `);
      const ran =
        (Array.isArray(recent)
          ? recent.length
          : ((recent as { rows?: unknown[] }).rows?.length ?? 0)) > 0;
      if (!ran) {
        await recordCronRun("template-proposals", async () =>
          NextResponse.json(await runScheduledProposals()),
        );
      }
    } catch (err) {
      logger.warn({ err }, "reply-corpus: template-proposals ride-along failed");
    }

    // Daily ride-along: the anti-silence monitor. Runs every night off this
    // cron (no separate crontab); failures never affect the corpus build.
    try {
      await recordCronRun("liveness", async () => NextResponse.json(await runLivenessMonitor()));
    } catch (err) {
      logger.warn({ err }, "reply-corpus: liveness ride-along failed");
    }

    return response;
  } catch (err) {
    logger.error({ err }, "reply-corpus cron route failed");
    return NextResponse.json({ error: "reply-corpus failed" }, { status: 500 });
  }
}
