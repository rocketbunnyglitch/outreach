/**
 * Health endpoint. Used by:
 *   - scripts/update-from-zip.sh post-deploy verification
 *   - External uptime monitoring
 *   - Manual smoke checks
 *
 * Returns 200 + JSON status when all dependencies reachable.
 * Returns 503 when a dependency is down.
 *
 * Backup freshness:
 *   The backup-db.sh script writes a status file at
 *   /var/lib/outreach/last-backup.json after each successful run. We
 *   read it here so external monitoring can alert when backups stop —
 *   silently failing backups are the classic "everything is fine
 *   until the day you need them and they're three weeks stale" trap.
 *
 *   When the file is missing or older than 36 hours (a daily backup
 *   has 12 hours of slack), the health response reports
 *   backup_status='stale' but still returns 200 so an alert
 *   threshold can be set per-organization.
 */

import { promises as fs } from "node:fs";
import { isEncryptionAvailable } from "@/lib/crypto";
import { pingDb } from "@/lib/db";
import { pingRedis } from "@/lib/redis";
import { getVersion } from "@/lib/version";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const startedAt = Date.now();

const BACKUP_STATUS_FILE = "/var/lib/outreach/last-backup.json";
const BACKUP_STALE_AFTER_MS = 36 * 60 * 60 * 1000; // 36 hours

interface BackupStatus {
  state: "ok" | "stale" | "unknown";
  last_run_at: string | null;
  hours_since_last: number | null;
  last_object_key: string | null;
  last_size_mb: number | null;
}

async function readBackupStatus(): Promise<BackupStatus> {
  try {
    const raw = await fs.readFile(BACKUP_STATUS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as {
      last_run_at?: string;
      object_key?: string;
      size_mb?: number;
    };
    if (!parsed.last_run_at) {
      return {
        state: "unknown",
        last_run_at: null,
        hours_since_last: null,
        last_object_key: null,
        last_size_mb: null,
      };
    }
    const lastMs = new Date(parsed.last_run_at).getTime();
    if (!Number.isFinite(lastMs)) {
      return {
        state: "unknown",
        last_run_at: null,
        hours_since_last: null,
        last_object_key: null,
        last_size_mb: null,
      };
    }
    const ageMs = Date.now() - lastMs;
    const hoursSinceLast = Math.round((ageMs / 3_600_000) * 10) / 10;
    return {
      state: ageMs < BACKUP_STALE_AFTER_MS ? "ok" : "stale",
      last_run_at: parsed.last_run_at,
      hours_since_last: hoursSinceLast,
      // Do NOT expose the backup's S3 object key on the public, unauthenticated
      // health endpoint (it leaks the backup storage path). Monitoring only
      // needs state + staleness.
      last_object_key: null,
      last_size_mb: parsed.size_mb ?? null,
    };
  } catch {
    // File missing or unreadable — backups haven't run, or this isn't
    // a production host. Report 'unknown' rather than failing the
    // whole health check.
    return {
      state: "unknown",
      last_run_at: null,
      hours_since_last: null,
      last_object_key: null,
      last_size_mb: null,
    };
  }
}

export async function GET() {
  const { version, commit, builtAt } = getVersion();
  const [dbOk, redisOk, backup] = await Promise.all([pingDb(), pingRedis(), readBackupStatus()]);

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
      backup,
    },
    {
      status: httpStatus,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    },
  );
}
