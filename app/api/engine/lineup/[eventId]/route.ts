/**
 * GET /api/engine/lineup/[eventId]
 *
 * Public JSON API (Spec phase 5.7): the confirmed, publish-safe lineup for ONE
 * crawl night. Used by the Eventbrite push (5.9) to rewrite a single listing's
 * venue block, and by the Smart Map (5.10) to refresh one event's pins after a
 * recordLineupChange (lib/lineup-events.ts) signal.
 *
 * SAFETY + AUTH: identical contract to the collection route
 * (app/api/engine/lineup/route.ts). The DTO comes from lib/lineup-state.ts and
 * exposes ONLY public-safe confirmed venue facts (CLAUDE.md section 8 rule #6);
 * auth is the static X-Engine-Api-Key header matched against env ENGINE_API_KEY,
 * mirroring the cron shared-secret pattern. Fails closed.
 *
 * Example:
 *   curl -H "X-Engine-Api-Key: $ENGINE_API_KEY" \
 *     "https://outreach.barcrawlconnect.com/api/engine/lineup/<event-uuid>"
 */

import { getEventLineup } from "@/lib/lineup-state";
import { logger } from "@/lib/logger";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorize(req: Request): NextResponse | null {
  const expected = process.env.ENGINE_API_KEY;
  if (!expected || expected.length === 0) {
    return NextResponse.json({ error: "ENGINE_API_KEY not configured on server" }, { status: 500 });
  }
  const got = req.headers.get("x-engine-api-key");
  if (got !== expected) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  return null;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ eventId: string }> },
): Promise<Response> {
  const denied = authorize(req);
  if (denied) return denied;

  const { eventId } = await ctx.params;
  if (!eventId) {
    return NextResponse.json({ error: "Missing event id" }, { status: 400 });
  }

  try {
    const lineup = await getEventLineup(eventId);
    if (!lineup) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }
    return NextResponse.json(lineup);
  } catch (err) {
    logger.error({ err, eventId }, "engine event-lineup API failed");
    return NextResponse.json({ error: "Failed to load lineup" }, { status: 500 });
  }
}
