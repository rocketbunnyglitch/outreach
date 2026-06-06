/**
 * POST /api/sms/inbound -- Twilio inbound SMS webhook (Phase 5.3).
 *
 * Twilio POSTs application/x-www-form-urlencoded (From, To, Body, MessageSid,
 * ...). We:
 *   1. Verify X-Twilio-Signature (fail closed; subsystem inert without the
 *      auth token so nothing legitimate posts here until configured).
 *   2. Log the inbound message to sms_messages.
 *   3. Handle STOP / START / HELP compliance keywords -> sms_consent_log.
 *   4. If the sender matches an external host, mark their most recent pending
 *      host SMS cadence touch as responded (the "Reply YES" path, 5.4).
 *
 * Always returns 200 with empty TwiML so Twilio does not retry on our internal
 * hiccups; only a bad signature returns 401.
 */

import { externalHosts, smsConsentLog, smsMessages } from "@/db/schema";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { normalizeInboundKeyword, verifyTwilioSignature } from "@/lib/sms";
import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

function twiml(): NextResponse {
  return new NextResponse(EMPTY_TWIML, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  // Parse the form params (Twilio uses urlencoded).
  const params: Record<string, string> = {};
  try {
    const form = await req.formData();
    for (const [key, value] of form.entries()) {
      params[key] = typeof value === "string" ? value : "";
    }
  } catch (err) {
    logger.warn({ err }, "twilio inbound: could not parse form body");
    return twiml();
  }

  const webhookUrl =
    process.env.TWILIO_PUBLIC_WEBHOOK_URL ??
    `${process.env.APP_URL ?? "http://localhost:3001"}/api/sms/inbound`;
  const verified = await verifyTwilioSignature({
    signatureHeader: req.headers.get("x-twilio-signature"),
    url: webhookUrl,
    params,
  });
  if (!verified) {
    logger.warn("twilio inbound: signature invalid or auth token missing");
    return new NextResponse("invalid signature", { status: 401 });
  }

  const fromE164 = params.From ?? "";
  const toE164 = params.To ?? "";
  const body = params.Body ?? "";
  const messageSid = params.MessageSid ?? params.SmsSid ?? null;
  if (!fromE164) return twiml();

  try {
    // 2. Log the inbound message.
    await db.insert(smsMessages).values({
      direction: "inbound",
      provider: "twilio",
      providerSid: messageSid,
      fromE164,
      toE164,
      body,
      status: "received",
      kind: "system",
    });

    // 3. Compliance keywords.
    const keyword = normalizeInboundKeyword(body);
    if (keyword) {
      const action = keyword === "stop" ? "stop" : keyword === "start" ? "start" : "help";
      await db.insert(smsConsentLog).values({
        phoneE164: fromE164,
        action,
        source: "inbound_webhook",
        note: body.slice(0, 200),
      });
    }

    // 4. Host cadence response tracking. If the sender is a known external
    // host, mark their most recent un-answered cadence touch as responded.
    const [host] = await db
      .select({ id: externalHosts.id })
      .from(externalHosts)
      .where(eq(externalHosts.phoneE164, fromE164))
      .limit(1);
    if (host?.id) {
      await db.execute(sql`
        UPDATE host_sms_log
        SET status = 'responded', responded_at = NOW(), response_body = ${body.slice(0, 500)}
        WHERE id = (
          SELECT id FROM host_sms_log
          WHERE external_host_id = ${host.id} AND responded_at IS NULL
          ORDER BY created_at DESC
          LIMIT 1
        )
      `);
    }
  } catch (err) {
    logger.error({ err, fromE164 }, "twilio inbound processing failed (acked anyway)");
  }

  return twiml();
}
