import { logger } from "@/lib/logger";
import { NextResponse } from "next/server";

/**
 * Temporary diagnostic sink for the pre-React beacon (lib/client-diag.ts).
 * Public (see middleware allowlist) because the failure we're chasing can
 * happen before the user is authenticated. Logs to pm2 and returns 204.
 * No DB, no side effects. Remove once the profile-load bug is root-caused.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const text = await req.text();
    let body: unknown;
    try {
      body = JSON.parse(text.slice(0, 8000));
    } catch {
      body = { unparsed: text.slice(0, 500) };
    }
    logger.warn({ clientDiag: body }, "client-diag report");
  } catch (err) {
    logger.error({ err }, "client-diag: failed to handle report");
  }
  return new NextResponse(null, { status: 204 });
}
