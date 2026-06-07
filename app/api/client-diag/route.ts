import { NextResponse } from "next/server";

/**
 * Pre-React diagnostic beacon sink. Kept as a 204 no-op so the legacy client
 * beacon (lib/client-diag.ts) doesn't error, but it no longer reads or LOGS the
 * request body: an unauthenticated endpoint must not write attacker-controlled
 * data into the server logs (log injection / spam). Safe to delete entirely once
 * nothing beacons to it.
 */
export const dynamic = "force-dynamic";

export function POST(): Response {
  return new NextResponse(null, { status: 204 });
}
