/**
 * POST /api/cron/liveness
 *   Header: X-Cron-Secret: <env.CRON_SECRET>
 *
 * Anti-silence meta-monitor: checks that every learning input / automated job
 * is actually producing output (not just "running"), and pushes ONE admin
 * notification when something has gone silent. The always-fresh pull view is on
 * /admin/command. Fires daily by riding the nightly reply-corpus cron; this
 * route also allows independent scheduling / manual triggering.
 */

import { recordCronRun } from "@/lib/cron-runs";
import { runLivenessMonitor } from "@/lib/liveness-monitor";
import { logger } from "@/lib/logger";
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
    return await recordCronRun("liveness", async () => {
      const result = await runLivenessMonitor();
      return NextResponse.json({ ok: true, ...result });
    });
  } catch (err) {
    logger.error({ err }, "liveness cron route failed");
    return NextResponse.json({ error: "liveness failed" }, { status: 500 });
  }
}
