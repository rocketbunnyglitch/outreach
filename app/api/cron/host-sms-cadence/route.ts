/**
 * POST /api/cron/host-sms-cadence
 *   Header: X-Cron-Secret: <env.CRON_SECRET>
 *
 * Drives the external-host SMS cadence (H1-H5). Each tick recomputes which
 * H-touch is due for every external host on an upcoming crawl and sends it.
 * INERT until Twilio creds land: lib/sms.ts sendSms() logs every intended send
 * to sms_messages and only calls Twilio when configured, so a dry run still
 * produces full audit + host_sms_log visibility.
 *
 * Recommended cadence: hourly (touches resolve to a specific calendar day).
 *
 *   0 * * * * curl -sS -X POST \
 *     -H "X-Cron-Secret: $CRON_SECRET" \
 *     https://outreach.barcrawlconnect.com/api/cron/host-sms-cadence \
 *     > /dev/null
 *
 * Idempotent: re-running a tick is safe. Each touch is claimed in host_sms_log
 * via UNIQUE(external_host_id, event_id, touch_code) BEFORE the send, so an
 * overlapping or repeated tick never double-sends.
 */

import { recordCronRun } from "@/lib/cron-runs";
import { logger } from "@/lib/logger";
import { runHostSmsCadence } from "@/lib/sms-cadence";
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
    return await recordCronRun("host-sms-cadence", async () => {
      const result = await runHostSmsCadence();
      return NextResponse.json({ ok: true, ...result });
    });
  } catch (err) {
    logger.error({ err }, "host-sms-cadence cron route failed");
    return NextResponse.json({ error: "host-sms-cadence failed" }, { status: 500 });
  }
}
