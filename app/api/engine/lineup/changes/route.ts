/**
 * GET /api/engine/lineup/changes?since=<seq>[&eventId=...][&limit=N]
 *
 * Durable lineup-change poll feed (CRM plan B1). External consumers
 * (Smart Map, Eventbrite venue-block pusher) read forward from the
 * last cursor they saw; rows come back in strict seq order, so a
 * consumer that crashes and resumes from its stored cursor never
 * misses a change — unlike the old in-memory ring buffer.
 *
 * Auth mirrors the sibling engine routes: static X-Engine-Api-Key
 * header matched against env ENGINE_API_KEY; session auth does not
 * apply (route is on the machine allowlist). Fails closed: missing
 * ENGINE_API_KEY => 500.
 *
 *   curl -H "X-Engine-Api-Key: $ENGINE_API_KEY" \
 *     "https://outreach.barcrawlconnect.com/api/engine/lineup/changes?since=0"
 *
 * Response: { changes: [{ seq, eventId, venueEventId, venueId,
 * changeType, publicPayload, createdAt }], nextCursor } — poll again
 * with since=nextCursor. publicPayload is allowlist-sanitized at write
 * time (never-do #6); this route adds no private joins on top.
 */

import { lineupChangeEvents } from "@/db/schema";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { and, asc, eq, gt } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 200;

function authorize(req: Request): NextResponse | null {
  const expected = process.env.ENGINE_API_KEY;
  if (!expected || expected.length === 0) {
    // Fail closed: an unconfigured key must not become an open endpoint.
    return NextResponse.json({ error: "ENGINE_API_KEY not configured on server" }, { status: 500 });
  }
  const got = req.headers.get("x-engine-api-key");
  if (got !== expected) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  return null;
}

export async function GET(req: Request): Promise<Response> {
  const denied = authorize(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const sinceRaw = url.searchParams.get("since")?.trim() ?? "0";
  const since = Number(sinceRaw);
  if (!Number.isFinite(since) || since < 0) {
    return NextResponse.json({ error: "'since' must be a non-negative integer" }, { status: 400 });
  }
  const limitRaw = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(MAX_LIMIT, Math.floor(limitRaw)))
    : DEFAULT_LIMIT;
  const eventId = url.searchParams.get("eventId")?.trim() || null;

  try {
    const where = eventId
      ? and(gt(lineupChangeEvents.seq, since), eq(lineupChangeEvents.eventId, eventId))
      : gt(lineupChangeEvents.seq, since);
    const rows = await db
      .select({
        seq: lineupChangeEvents.seq,
        eventId: lineupChangeEvents.eventId,
        venueEventId: lineupChangeEvents.venueEventId,
        venueId: lineupChangeEvents.venueId,
        changeType: lineupChangeEvents.changeType,
        publicPayload: lineupChangeEvents.publicPayload,
        createdAt: lineupChangeEvents.createdAt,
      })
      .from(lineupChangeEvents)
      .where(where)
      .orderBy(asc(lineupChangeEvents.seq))
      .limit(limit);

    const nextCursor = rows.at(-1)?.seq ?? since;
    return NextResponse.json({ changes: rows, nextCursor, hasMore: rows.length === limit });
  } catch (err) {
    logger.error({ err, since, eventId }, "engine lineup changes API failed");
    return NextResponse.json({ error: "Failed to load lineup changes" }, { status: 500 });
  }
}
