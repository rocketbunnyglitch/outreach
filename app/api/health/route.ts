/**
 * Health endpoint. Used by:
 *   - scripts/update-from-zip.sh post-deploy verification
 *   - External uptime monitoring
 *   - Manual smoke checks
 *
 * Returns 200 + JSON status when all dependencies reachable.
 * Returns 503 when a dependency is down.
 */

import { isEncryptionAvailable } from "@/lib/crypto";
import { pingDb } from "@/lib/db";
import { pingRedis } from "@/lib/redis";
import { getVersion } from "@/lib/version";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const startedAt = Date.now();

export async function GET() {
  const { version, commit, builtAt } = getVersion();
  const [dbOk, redisOk] = await Promise.all([pingDb(), pingRedis()]);

  const allOk = dbOk && redisOk;
  const status = allOk ? "ok" : "degraded";
  const httpStatus = allOk ? 200 : 503;

  return NextResponse.json(
    {
      status,
      version,
      commit,
      built_at: builtAt,
      uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
      db: dbOk ? "ok" : "down",
      redis: redisOk ? "ok" : "down",
      encryption_key_configured: isEncryptionAvailable(),
    },
    {
      status: httpStatus,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    },
  );
}
