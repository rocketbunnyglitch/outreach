/**
 * POST /api/presence/drop
 *
 * Best-effort "I'm leaving this route" call fired from the
 * usePresenceHeartbeat hook on unmount. Removes the staffer's presence
 * entry immediately so other viewers don't see them lingering for the
 * full 30s TTL.
 *
 * Optional — if this never fires (network drop, browser killed the
 * process), the TTL cleans up in 30s anyway.
 */

import { getCurrentStaff } from "@/lib/auth";
import { dropPresence } from "@/lib/presence";
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
  if (!ctx) return new NextResponse("Unauthorized", { status: 401 });

  let body: { route?: string };
  try {
    body = await req.json();
  } catch {
    // sendBeacon delivers as a Blob; some browsers parse weirdly. Tolerate.
    return new NextResponse(null, { status: 204 });
  }

  if (!body.route) return new NextResponse(null, { status: 204 });

  await dropPresence(canonicalRoute(body.route), ctx.staff.id);
  return new NextResponse(null, { status: 204 });
}
