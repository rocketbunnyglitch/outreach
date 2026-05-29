/**
 * POST /api/webhooks/quo — receives Quo phone-system events.
 *
 * Quo emits webhooks for inbound + outbound calls and SMS. We use
 * these to:
 *   1. Append call outcomes to outreach_log so the operator's log
 *      stays in sync (voicemail / no_answer / completed-with-duration)
 *   2. Bump cold_outreach_entries.last_touch_at on activity
 *   3. (future) Mirror inbound SMS into the operator's inbox feed
 *
 * Security:
 *   • Signature verification via QUO_WEBHOOK_SIGNING_SECRET — without
 *     it, the handler 401s every request (fail closed).
 *   • Anti-replay: timestamps > 5 min old are rejected.
 *   • Raw body required for HMAC — we read req.text() once and never
 *     re-parse from a mutated structure.
 *
 * Reliability:
 *   • 200 returned for known + unknown event types (Quo retries on
 *     non-2xx, so we ack everything except actual signature failures).
 *   • Best-effort DB writes inside try/catch — a transient DB error
 *     won't tank the webhook delivery.
 */

import { callLogs, outreachLog, venues } from "@/db/schema";
import { matchCaller } from "@/lib/call-matching";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { mapQuoCallStatusToOutcome, verifyQuoWebhookSignature } from "@/lib/quo";
import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface QuoWebhookPayload {
  id: string;
  type: string;
  // OpenPhone-compatible: the actual event payload lives at .data.object
  data?: {
    object?: {
      id?: string;
      direction?: "incoming" | "outgoing";
      status?: string;
      duration?: number;
      to?: string | string[];
      from?: string;
      createdAt?: string;
      body?: string;
      recordingUrl?: string;
      callerName?: string;
    };
  };
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signatureHeader = req.headers.get("x-openphone-signature");

  const verified = await verifyQuoWebhookSignature({ signatureHeader, rawBody });
  if (!verified) {
    logger.warn(
      { signatureHeader: signatureHeader?.slice(0, 30) },
      "quo webhook signature invalid or secret missing",
    );
    return new NextResponse("invalid signature", { status: 401 });
  }

  let payload: QuoWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as QuoWebhookPayload;
  } catch (err) {
    logger.warn({ err }, "quo webhook body not JSON");
    // ACK so Quo doesn't retry malformed payloads we can't parse anyway
    return NextResponse.json({ ok: true });
  }

  const eventType = payload.type ?? "unknown";
  const obj = payload.data?.object;
  if (!obj?.id) {
    logger.info({ eventType }, "quo webhook payload missing object id");
    return NextResponse.json({ ok: true });
  }

  try {
    if (eventType.startsWith("call.")) {
      await handleCallEvent(eventType, obj);
    } else if (eventType.startsWith("message.")) {
      await handleMessageEvent(eventType, obj);
    } else {
      logger.info({ eventType, objectId: obj.id }, "quo webhook unhandled type");
    }
  } catch (err) {
    logger.error({ err, eventType, objectId: obj.id }, "quo webhook processing failed");
    // Still ACK — we don't want Quo to retry on our internal failure.
    // The event lands in our error log for backfill via a manual sync.
  }

  return NextResponse.json({ ok: true });
}

async function handleCallEvent(
  eventType: string,
  obj: NonNullable<NonNullable<QuoWebhookPayload["data"]>["object"]>,
): Promise<void> {
  const objId = obj.id;
  if (!objId) return;
  // We care about call.completed (terminal) — earlier events get logged
  // for visibility but don't write to outreach_log.
  if (eventType !== "call.completed") {
    logger.info({ eventType, callId: objId }, "quo call non-terminal event ignored");
    return;
  }

  const otherEnd = obj.direction === "outgoing" ? obj.to : obj.from;
  const otherE164 = Array.isArray(otherEnd) ? otherEnd[0] : otherEnd;
  if (!otherE164) return;

  // Persist a raw call record for live support BEFORE outreach attribution, so
  // unmatched calls (no venue) are still surfaced on the Crawl Support tab.
  await persistCallLog(objId, obj, otherE164);

  const venueId = await findVenueByPhone(otherE164);
  if (!venueId) {
    logger.info({ callId: objId, e164: otherE164 }, "quo call: no matching venue");
    return;
  }

  const outcome = mapQuoCallStatusToOutcome(obj.status ?? "unknown", obj.duration ?? null);

  // Resolve a brand id — every venue can be on multiple brands' radar,
  // but the call originated from a specific Quo line. Match it by from.
  const ourLine = obj.direction === "outgoing" ? obj.from : obj.to;
  const ourE164 = Array.isArray(ourLine) ? ourLine[0] : ourLine;
  const outreachBrandId = ourE164 ? await findOutreachBrandByLine(ourE164) : null;
  if (!outreachBrandId) {
    logger.warn({ callId: objId, ourE164 }, "quo call: no matching outreach brand");
    return;
  }

  // Attribute to the operator who most recently touched this venue+brand
  // (typically the same person who clicked the dial button). Falls back
  // to any active staff if no prior touch exists.
  const staffMemberId = await findAttributableStaff(venueId, outreachBrandId);
  if (!staffMemberId) {
    logger.warn({ callId: objId }, "quo call: no staff to attribute");
    return;
  }

  // Idempotency: don't double-log if we already have this call id
  const existing = await db
    .select({ id: outreachLog.id })
    .from(outreachLog)
    .where(eq(outreachLog.externalId, objId))
    .limit(1)
    .then((r) => r[0]);

  if (existing) {
    // Update existing entry's outcome (initial click-to-call insert
    // marked outcome='sent'; webhook delivers the real result)
    await db
      .update(outreachLog)
      .set({
        outcome,
        notes: `Quo call ${obj.status ?? "completed"} · duration ${obj.duration ?? 0}s`,
      })
      .where(eq(outreachLog.id, existing.id));
  } else {
    await db.insert(outreachLog).values({
      venueId,
      outreachBrandId,
      channel: "call",
      outcome,
      externalId: objId,
      staffMemberId,
      notes: `Quo ${obj.direction ?? "?"} call · ${obj.status ?? "?"} · ${obj.duration ?? 0}s`,
    });
  }

  // Bump cold outreach entries (one per city_campaign) so the operator
  // sees the latest touch + status in the cold-outreach table
  await db.execute(sql`
    UPDATE cold_outreach_entries
    SET last_touch_at = NOW(),
        status = CASE
          WHEN status = 'not_contacted' THEN ${outcome}::cold_outreach_status
          WHEN ${outcome}::text IN ('voicemail','no_answer') THEN ${outcome}::cold_outreach_status
          ELSE status
        END,
        updated_at = NOW()
    WHERE venue_id = ${venueId}
      AND archived_at IS NULL
  `);
}

async function handleMessageEvent(
  eventType: string,
  obj: NonNullable<NonNullable<QuoWebhookPayload["data"]>["object"]>,
): Promise<void> {
  const objId = obj.id;
  if (!objId) return;
  // Only act on terminal delivery events for now
  if (eventType !== "message.delivered" && eventType !== "message.received") {
    return;
  }

  const otherEnd = eventType === "message.received" ? obj.from : obj.to;
  const otherE164 = Array.isArray(otherEnd) ? otherEnd[0] : otherEnd;
  if (!otherE164) return;

  const venueId = await findVenueByPhone(otherE164);
  if (!venueId) return;

  const ourLine = eventType === "message.received" ? obj.to : obj.from;
  const ourE164 = Array.isArray(ourLine) ? ourLine[0] : ourLine;
  const outreachBrandId = ourE164 ? await findOutreachBrandByLine(ourE164) : null;
  if (!outreachBrandId) return;

  // For outbound delivery confirmation: update the existing log entry's
  // outcome based on Quo's status (our initial insert marked 'sent')
  if (eventType === "message.delivered") {
    await db
      .update(outreachLog)
      .set({
        notes: `Quo SMS delivered (Quo id ${objId})`,
      })
      .where(eq(outreachLog.externalId, objId));
    return;
  }

  // Inbound message → log it
  const staffMemberId = await findAttributableStaff(venueId, outreachBrandId);
  if (!staffMemberId) {
    logger.warn({ msgId: objId }, "quo sms inbound: no staff to attribute");
    return;
  }
  await db.insert(outreachLog).values({
    venueId,
    outreachBrandId,
    channel: "sms",
    // Inbound message means the venue replied → "interested" by default;
    // operator can refine later.
    outcome: "interested",
    bodySnippet: (obj.body ?? "").slice(0, 500),
    externalId: objId,
    staffMemberId,
    notes: "Inbound SMS via Quo",
  });

  await db.execute(sql`
    UPDATE cold_outreach_entries
    SET last_touch_at = NOW(),
        status = 'interested'::cold_outreach_status,
        updated_at = NOW()
    WHERE venue_id = ${venueId}
      AND archived_at IS NULL
      AND status NOT IN ('declined','do_not_contact')
  `);
}

async function persistCallLog(
  externalId: string,
  obj: NonNullable<NonNullable<QuoWebhookPayload["data"]>["object"]>,
  callerE164: string,
): Promise<void> {
  try {
    const direction = obj.direction === "outgoing" ? "outgoing" : "incoming";
    const objTo = Array.isArray(obj.to) ? obj.to[0] : (obj.to ?? null);
    const match = await matchCaller(callerE164);
    const values = {
      provider: "quo",
      externalId,
      direction: direction as "incoming" | "outgoing",
      fromE164: direction === "incoming" ? callerE164 : (obj.from ?? null),
      toE164: direction === "incoming" ? objTo : callerE164,
      callerName: obj.callerName ?? null,
      status: obj.status ?? null,
      durationSeconds: typeof obj.duration === "number" ? obj.duration : null,
      recordingUrl: obj.recordingUrl ?? null,
      occurredAt: obj.createdAt ? new Date(obj.createdAt) : new Date(),
      matchType: match.matchType,
      matchedVenueId: match.venueId,
      matchedStaffId: match.staffId,
      areaCode: match.areaCode,
    };

    const [existing] = await db
      .select({ id: callLogs.id })
      .from(callLogs)
      .where(eq(callLogs.externalId, externalId))
      .limit(1);
    if (existing) {
      await db
        .update(callLogs)
        .set({
          status: values.status,
          durationSeconds: values.durationSeconds,
          recordingUrl: values.recordingUrl,
          callerName: values.callerName,
          matchType: values.matchType,
          matchedVenueId: values.matchedVenueId,
          matchedStaffId: values.matchedStaffId,
          areaCode: values.areaCode,
        })
        .where(eq(callLogs.id, existing.id));
    } else {
      await db.insert(callLogs).values(values);
    }
  } catch (err) {
    logger.warn({ err, externalId }, "persistCallLog failed (call_logs may not be migrated)");
  }
}

async function findVenueByPhone(e164: string): Promise<string | null> {
  const row = await db
    .select({ id: venues.id })
    .from(venues)
    .where(eq(venues.phoneE164, e164))
    .limit(1)
    .then((r) => r[0]);
  return row?.id ?? null;
}

async function findOutreachBrandByLine(e164: string): Promise<string | null> {
  const result = await db.execute<{ id: string }>(sql`
    SELECT id FROM outreach_brands WHERE quo_line_e164 = ${e164} LIMIT 1
  `);
  const rows: Array<{ id: string }> = Array.isArray(result)
    ? (result as unknown as Array<{ id: string }>)
    : ((result as unknown as { rows: Array<{ id: string }> }).rows ?? []);
  return rows[0]?.id ?? null;
}

/**
 * Resolve a staff id to attribute webhook-driven outreach_log entries to.
 *
 * Order of preference:
 *   1. Most recent outreach_log entry on (venue, brand) — same operator
 *      who likely initiated the click-to-call
 *   2. Any active staff (oldest first, deterministic fallback)
 *
 * Returns null if neither exists — caller logs + drops the entry.
 */
async function findAttributableStaff(
  venueId: string,
  outreachBrandId: string,
): Promise<string | null> {
  const recent = await db.execute<{ staff_member_id: string }>(sql`
    SELECT staff_member_id FROM outreach_log
    WHERE venue_id = ${venueId}
      AND outreach_brand_id = ${outreachBrandId}
      AND staff_member_id IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const recentRows: Array<{ staff_member_id: string }> = Array.isArray(recent)
    ? (recent as unknown as Array<{ staff_member_id: string }>)
    : ((recent as unknown as { rows: Array<{ staff_member_id: string }> }).rows ?? []);
  if (recentRows[0]?.staff_member_id) return recentRows[0].staff_member_id;

  const fallback = await db.execute<{ id: string }>(sql`
    SELECT id FROM users
    WHERE status = 'active'
    ORDER BY created_at ASC
    LIMIT 1
  `);
  const fallbackRows: Array<{ id: string }> = Array.isArray(fallback)
    ? (fallback as unknown as Array<{ id: string }>)
    : ((fallback as unknown as { rows: Array<{ id: string }> }).rows ?? []);
  return fallbackRows[0]?.id ?? null;
}
