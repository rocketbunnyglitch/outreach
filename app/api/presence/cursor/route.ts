/**
 * POST /api/presence/cursor
 *
 * Receives cursor position pings from the client (throttled to 10Hz) and
 * publishes them on a per-route Redis channel. Other open clients on the
 * same route subscribe via the existing SSE infrastructure.
 *
 * Why a separate channel from the regular presence channel?
 *   - Cursor traffic is high-frequency (10 messages/sec/user). If it
 *     shared the presence-change channel, every cursor blip would
 *     trigger a roster re-poll, which would drown out Redis with
 *     wasted SCAN calls.
 *   - Keeping cursors on their own channel lets subscribers opt out
 *     (Phase 16: a 'show peer cursors' user setting).
 *
 * No persistence: cursor positions are pure broadcast. They never hit
 * the database. If you don't receive an event for 5s, the cursor is
 * stale and the client should hide it.
 *
 * Payload shape (compact for high frequency):
 *   { staffId, displayName, x, y, viewportW, viewportH }
 *
 * x/y are in CSS pixels relative to the page top-left (not the
 * viewport), captured client-side as event.pageX / event.pageY.
 * viewportW/H are the sender's window dimensions so the receiver can
 * proportionally scale the cursor if its viewport differs.
 */

import { getCurrentStaff } from "@/lib/auth";
import { publishRealtime } from "@/lib/realtime-publish";
import { getRedis } from "@/lib/redis";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function canonicalRoute(raw: string): string {
  try {
    const url = raw.startsWith("http") ? new URL(raw) : null;
    const path = url ? url.pathname : raw;
    return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  } catch {
    return raw;
  }
}

export async function POST(req: Request) {
  const ctx = await getCurrentStaff();
  if (!ctx) return new NextResponse(null, { status: 401 });

  let body: {
    route?: string;
    x?: number;
    y?: number;
    viewportW?: number;
    viewportH?: number;
  };
  try {
    body = await req.json();
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  if (!body.route || typeof body.x !== "number" || typeof body.y !== "number") {
    return new NextResponse(null, { status: 204 });
  }

  const route = canonicalRoute(body.route);
  const channel = `realtime:cursors-route-${route}`;

  // Publish directly via the raw Redis publish, since publishRealtime's
  // shape includes staff-name/etc that we already encode in our compact
  // cursor payload. This keeps each cursor message tiny — important at
  // 10 msg/sec/user.
  const payload = JSON.stringify({
    staffId: ctx.staff.id,
    displayName: ctx.staff.displayName,
    x: body.x,
    y: body.y,
    viewportW: body.viewportW ?? 0,
    viewportH: body.viewportH ?? 0,
    at: Date.now(),
  });

  try {
    await getRedis().publish(channel, payload);
  } catch {
    // Swallow — never break the page on a publish hiccup
  }

  return new NextResponse(null, { status: 204 });
}

// Suppress unused-import warning when getRedis is the only path
void publishRealtime;
