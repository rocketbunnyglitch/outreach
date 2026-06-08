/**
 * GET /api/track/o/<token>.gif — warm-only email open pixel.
 *
 * Public + unauthenticated by necessity (it's loaded by the recipient's mail
 * client). Always returns a real 1x1 transparent GIF and NEVER 500s to the
 * client. A pixel is only ever embedded on OUTBOUND messages sent into a WARM
 * thread (see lib/open-tracking-gate.ts); cold sends carry no token, so a
 * garbage/unknown token simply returns the gif and records nothing.
 *
 * Opens are a SOFT signal: this endpoint records visibility data only. It must
 * NEVER advance cadence, set relationship flags, or trigger sends.
 */

import { emailMessages, emailOpenEvents } from "@/db/schema";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 1x1 transparent GIF (43 bytes).
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// User agents that indicate a mail-proxy pre-fetch rather than a human read.
const PROXY_UA_RE = /GoogleImageProxy|ggpht|YahooMailProxy|Barracuda|Mimecast|Proofpoint/i;

function gif(): NextResponse {
  return new NextResponse(PIXEL, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(PIXEL.length),
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  try {
    const { token: raw } = await ctx.params;
    const token = (raw ?? "").replace(/\.gif$/i, "");
    // Unknown/garbage token -> just serve the pixel, record nothing.
    if (!UUID_RE.test(token)) return gif();

    const [msg] = await db
      .select({
        id: emailMessages.id,
        threadId: emailMessages.threadId,
        sentAt: emailMessages.sentAt,
        firstOpenedAt: emailMessages.firstOpenedAt,
        sentByStaffId: emailMessages.sentByStaffId,
      })
      .from(emailMessages)
      .where(eq(emailMessages.trackingToken, token))
      .limit(1);
    if (!msg) return gif();

    const ua = req.headers.get("user-agent") ?? "";
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || null;
    const sentMs = msg.sentAt ? new Date(msg.sentAt).getTime() : 0;
    // Pre-fetch heuristic: an open within ~10s of send, or a known mail-proxy
    // UA, is almost certainly automated (Gmail proxy / Apple MPP), not a read.
    const withinPrefetchWindow = sentMs > 0 && Date.now() - sentMs < 10_000;
    const isLikelyProxy = withinPrefetchWindow || PROXY_UA_RE.test(ua);

    await db.insert(emailOpenEvents).values({
      emailMessageId: msg.id,
      ip,
      userAgent: ua ? ua.slice(0, 500) : null,
      isLikelyProxy,
    });
    await db
      .update(emailMessages)
      .set({
        openCount: sql`${emailMessages.openCount} + 1`,
        lastOpenedAt: new Date(),
        ...(msg.firstOpenedAt ? {} : { firstOpenedAt: new Date() }),
      })
      .where(eq(emailMessages.id, msg.id));

    // Tier-2 real-time "Seen" notification. Notify the sender that a WARM venue
    // opened their email -- but ONLY on a real, non-proxy open (a Gmail/Apple
    // pre-fetch is not a human read). The pixel is warm-only by construction, so
    // any recorded open is already a warm thread. Opens stay a SOFT signal:
    // this is informational, clearly "Seen" (not "replied"), and never drives
    // cadence or sends. Deduped to one per thread per 12h so repeated opens
    // don't spam the bell.
    if (!isLikelyProxy && msg.sentByStaffId) {
      try {
        const { emitNotification } = await import("@/app/(admin)/_actions/notifications");
        await emitNotification({
          staffId: msg.sentByStaffId,
          kind: "seen",
          title: "Seen — a venue opened your email",
          linkPath: `/inbox/${msg.threadId}`,
          dedupeMinutes: 720,
        });
      } catch (err) {
        logger.warn({ err, messageId: msg.id }, "open-pixel: seen-notification failed (non-fatal)");
      }
    }
  } catch (err) {
    // Recording is best-effort; the client must always get its pixel.
    logger.warn({ err }, "open-pixel: record failed (non-fatal)");
  }
  return gif();
}
