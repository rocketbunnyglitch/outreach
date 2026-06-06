import "server-only";

/**
 * Twilio SMS client -- Phase 5.2.
 *
 * Mirrors lib/quo.ts: every function is INERT until the Twilio creds land, so
 * the whole SMS subsystem can ship now and go live the moment A2P 10DLC is
 * approved and the env vars are set. Nothing here can send a real message
 * unless isSmsConfigured() is true.
 *
 * Activation (.env):
 *   TWILIO_ACCOUNT_SID=AC...
 *   TWILIO_AUTH_TOKEN=...
 *   TWILIO_MESSAGING_SERVICE_SID=MG...   (preferred sender) OR
 *   TWILIO_FROM_E164=+1...               (single-number sender)
 *   TWILIO_PUBLIC_WEBHOOK_URL=https://outreach.barcrawlconnect.com/api/sms/inbound
 *
 * sendSms() ALWAYS writes an sms_messages audit row first (before any provider
 * call), so even while inert we have a dry-run record of every intended send
 * with status='unconfigured'. When configured the row is updated with the
 * Twilio SID + delivery status.
 */

import { smsMessages } from "@/db/schema";
import type { SmsKind } from "@/db/schema";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { eq } from "drizzle-orm";

export type { SmsKind };

export function isSmsConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      (process.env.TWILIO_MESSAGING_SERVICE_SID || process.env.TWILIO_FROM_E164),
  );
}

export interface SmsSendArgs {
  to: string;
  body: string;
  kind: SmsKind;
  externalHostId?: string | null;
  venueId?: string | null;
  cityCampaignId?: string | null;
  campaignId?: string | null;
  outreachBrandId?: string | null;
  relatedEventId?: string | null;
  staffId?: string | null;
  /** Accepted for caller convenience; sms_messages has no team column. */
  teamId?: string | null;
}

export interface SmsSendResult {
  id: string;
  sid: string | null;
  status: string;
}

/**
 * Send an SMS. Always records an sms_messages row. Returns the row id + the
 * provider SID (null when inert or on failure) + the resulting status, or null
 * if the audit insert itself failed (hard error).
 */
export async function sendSms(args: SmsSendArgs): Promise<SmsSendResult | null> {
  const configured = isSmsConfigured();

  let rowId: string;
  try {
    const [row] = await db
      .insert(smsMessages)
      .values({
        direction: "outbound",
        provider: "twilio",
        toE164: args.to,
        fromE164: process.env.TWILIO_FROM_E164 ?? null,
        body: args.body,
        status: configured ? "queued" : "unconfigured",
        kind: args.kind,
        externalHostId: args.externalHostId ?? null,
        venueId: args.venueId ?? null,
        cityCampaignId: args.cityCampaignId ?? null,
        campaignId: args.campaignId ?? null,
        outreachBrandId: args.outreachBrandId ?? null,
        relatedEventId: args.relatedEventId ?? null,
        staffId: args.staffId ?? null,
        createdBy: args.staffId ?? null,
        updatedBy: args.staffId ?? null,
      })
      .returning({ id: smsMessages.id });
    if (!row) return null;
    rowId = row.id;
  } catch (err) {
    logger.error({ err, to: args.to, kind: args.kind }, "sms audit insert failed");
    return null;
  }

  if (!configured) {
    // Inert: dry-run record only, no provider call.
    return { id: rowId, sid: null, status: "unconfigured" };
  }

  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID as string;
    const authToken = process.env.TWILIO_AUTH_TOKEN as string;
    const form = new URLSearchParams();
    form.set("To", args.to);
    form.set("Body", args.body);
    if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
      form.set("MessagingServiceSid", process.env.TWILIO_MESSAGING_SERVICE_SID);
    } else if (process.env.TWILIO_FROM_E164) {
      form.set("From", process.env.TWILIO_FROM_E164);
    }

    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
        signal: AbortSignal.timeout(8000),
      },
    );

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      logger.warn({ status: response.status, errBody, to: args.to }, "twilio sms send non-2xx");
      await db
        .update(smsMessages)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(smsMessages.id, rowId));
      return { id: rowId, sid: null, status: "failed" };
    }

    const json = (await response.json()) as { sid?: string; status?: string };
    const sid = json.sid ?? null;
    const status = json.status ?? "sent";
    await db
      .update(smsMessages)
      .set({ providerSid: sid, status, sentAt: new Date(), updatedAt: new Date() })
      .where(eq(smsMessages.id, rowId));
    return { id: rowId, sid, status };
  } catch (err) {
    logger.error({ err, to: args.to, kind: args.kind }, "twilio sms send threw");
    await db
      .update(smsMessages)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(smsMessages.id, rowId))
      .catch(() => {});
    return { id: rowId, sid: null, status: "failed" };
  }
}

/**
 * Verify a Twilio inbound webhook signature.
 *
 * Twilio signs requests with X-Twilio-Signature = base64(HMAC-SHA1(authToken,
 * url + sorted(key+value) concatenation of POST params)). Fail closed when the
 * auth token is missing (subsystem inert -> nothing legitimate posts here).
 */
export async function verifyTwilioSignature(opts: {
  signatureHeader: string | null;
  url: string;
  params: Record<string, string>;
}): Promise<boolean> {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    logger.warn("twilio webhook called but auth token not configured");
    return false;
  }
  if (!opts.signatureHeader) return false;

  // Twilio: data = full URL with the sorted param key+value pairs appended.
  const sortedKeys = Object.keys(opts.params).sort();
  let data = opts.url;
  for (const key of sortedKeys) {
    data += key + opts.params[key];
  }

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  const expected = Buffer.from(new Uint8Array(signature)).toString("base64");

  const provided = opts.signatureHeader;
  if (expected.length !== provided.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Classify an inbound SMS body as a compliance keyword (A2P 10DLC). Returns
 * 'stop' (opt-out), 'start' (opt-in), 'help', or null (a normal reply).
 */
export function normalizeInboundKeyword(body: string): "stop" | "start" | "help" | null {
  const word = body.trim().toUpperCase();
  if (["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"].includes(word)) return "stop";
  if (["START", "YES", "UNSTOP"].includes(word)) return "start";
  if (["HELP", "INFO"].includes(word)) return "help";
  return null;
}
