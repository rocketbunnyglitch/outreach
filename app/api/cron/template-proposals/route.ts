/**
 * POST /api/cron/template-proposals
 *   Header: X-Cron-Secret: <env.CRON_SECRET>
 *
 * Weekly learning pass: drafts NEW + IMPROVEMENT template proposals from the
 * team's best-performing replies for every active campaign, and notifies admins
 * when anything new lands. The engine only DRAFTS — promotion (and sending)
 * stays a human action.
 *
 * Fires automatically by riding the nightly reply-corpus cron on a 7-day gate
 * (no separate crontab entry needed). This route also lets an operator schedule
 * or trigger it independently:
 *
 *   0 6 * * 1 curl -sS -X POST \
 *     -H "X-Cron-Secret: $CRON_SECRET" \
 *     http://127.0.0.1:3001/api/cron/template-proposals > /dev/null
 */

import { recordCronRun } from "@/lib/cron-runs";
import { logger } from "@/lib/logger";
import { runScheduledProposals } from "@/lib/template-proposals";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "CRON_SECRET not configured on server" }, { status: 500 });
  }
  if (req.headers.get("x-cron-secret") !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return await recordCronRun("template-proposals", async () => {
      const result = await runScheduledProposals();
      return NextResponse.json({ ok: true, ...result });
    });
  } catch (err) {
    logger.error({ err }, "template-proposals cron route failed");
    return NextResponse.json({ error: "template-proposals failed" }, { status: 500 });
  }
}
