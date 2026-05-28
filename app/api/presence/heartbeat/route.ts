/**
 * POST /api/presence/heartbeat
 *
 * Records a heartbeat for the authenticated staffer on `route` and
 * returns the current list of viewers on that route. Clients call this
 * every 10s while a presence-enabled page is mounted.
 *
 * Request body:
 *   { route: string, focusedRowId?: string, focusedCellId?: string }
 *
 * Response:
 *   { viewers: PresenceEntry[] }
 *
 * Why same-response (not SSE)?
 *   Presence is low-stakes; ≤10s lag for avatar joins is acceptable
 *   and keeps the v1 build simple. Phase 13 may upgrade to SSE-based
 *   presence if focus highlighting (per-row avatars) needs faster
 *   updates than the heartbeat cadence allows.
 */

import { getCurrentStaff } from "@/lib/auth";
import { listViewers, recordHeartbeat } from "@/lib/presence";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Normalize the route so trailing slashes / query params don't fragment
// presence buckets (e.g. /venues vs /venues?sort=name).
function canonicalRoute(raw: string): string {
  try {
    // Strip protocol/host if a full URL slipped in
    const url = raw.startsWith("http") ? new URL(raw) : null;
    const path = url ? url.pathname : raw;
    // Strip trailing slash (except root)
    const trimmed = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
    return trimmed;
  } catch {
    return raw;
  }
}

export async function POST(req: Request) {
  const ctx = await getCurrentStaff();
  if (!ctx) return new NextResponse("Unauthorized", { status: 401 });

  let body: {
    route?: string;
    focusedRowId?: string;
    focusedCellId?: string;
    lastActiveAt?: string;
  };
  try {
    body = await req.json();
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  if (!body.route || typeof body.route !== "string") {
    return new NextResponse("Missing route", { status: 400 });
  }

  const route = canonicalRoute(body.route);

  await recordHeartbeat(route, {
    staffId: ctx.staff.id,
    displayName: ctx.staff.displayName,
    focusedRowId: body.focusedRowId,
    focusedCellId: body.focusedCellId,
    lastActiveAt: typeof body.lastActiveAt === "string" ? body.lastActiveAt : undefined,
  });

  const viewers = await listViewers(route);

  return NextResponse.json({ viewers });
}
