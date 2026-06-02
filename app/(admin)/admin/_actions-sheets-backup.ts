"use server";

/**
 * Admin -> Google Sheets backup ("Export Now") + status surface.
 *
 * The nightly backup (scripts/backup-to-sheets.ts) normally runs via
 * system cron at 04:00 UTC. This action lets an admin trigger it on
 * demand and reads the last run's status from the cron_runs table
 * (cron_name='sheets-backup'), which the script writes on every run.
 *
 * Trigger model:
 *   - We spawn `npm run backup:sheets` as a DETACHED child process
 *     from the app's working directory (which is the deployed app
 *     root, where scripts/ + node_modules/.bin/tsx live) and return
 *     immediately. The export can take many seconds against the
 *     Sheets API -- we do NOT block the request on it.
 *   - The script records its own success/failure (and the workbook
 *     URL / CSV-fallback path) into cron_runs. The admin card polls
 *     getSheetsBackupStatus() to show the outcome.
 *
 * Admin-only. NEVER throws -- failures return ok:false with a
 * user-readable message.
 */

import { spawn } from "node:child_process";
import { cronRuns } from "@/db/schema/cron-runs";
import { hasMinimumRole, requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { desc, eq, sql } from "drizzle-orm";

const CRON_NAME = "sheets-backup";

export interface SheetsBackupStatus {
  /** Whether the backup is wired up (env vars present in the runtime). */
  configured: boolean;
  lastRun: {
    status: string;
    startedAt: string;
    finishedAt: string | null;
    durationMs: number | null;
    errorMessage: string | null;
    /** Workbook URL or CSV-fallback path, pulled from result_summary. */
    sheetUrl: string | null;
    csvPath: string | null;
    destination: string | null;
    cities: number | null;
    events: number | null;
  } | null;
}

/**
 * Read the most recent sheets-backup run for the admin card. Also
 * reports whether the backup is configured (env present) so the
 * card can prompt the operator to finish wiring if not.
 */
export async function getSheetsBackupStatus(): Promise<SheetsBackupStatus> {
  const { staff } = await requireStaff();
  if (!hasMinimumRole(staff, "admin")) {
    return { configured: false, lastRun: null };
  }

  const configured = Boolean(
    process.env.SHEETS_BACKUP_SPREADSHEET_ID && process.env.SHEETS_BACKUP_CAMPAIGN_SLUG,
  );

  try {
    const rows = await db
      .select({
        status: cronRuns.status,
        startedAt: cronRuns.startedAt,
        finishedAt: cronRuns.finishedAt,
        durationMs: cronRuns.durationMs,
        errorMessage: cronRuns.errorMessage,
        resultSummary: cronRuns.resultSummary,
      })
      .from(cronRuns)
      .where(eq(cronRuns.cronName, CRON_NAME))
      .orderBy(desc(cronRuns.startedAt))
      .limit(1);

    const head = rows[0];
    if (!head) return { configured, lastRun: null };

    const summary = (head.resultSummary ?? {}) as Record<string, unknown>;
    return {
      configured,
      lastRun: {
        status: head.status,
        startedAt: head.startedAt.toISOString(),
        finishedAt: head.finishedAt ? head.finishedAt.toISOString() : null,
        durationMs: head.durationMs,
        errorMessage: head.errorMessage,
        sheetUrl: typeof summary.sheetUrl === "string" ? summary.sheetUrl : null,
        csvPath: typeof summary.csvPath === "string" ? summary.csvPath : null,
        destination: typeof summary.destination === "string" ? summary.destination : null,
        cities: typeof summary.cities === "number" ? summary.cities : null,
        events: typeof summary.events === "number" ? summary.events : null,
      },
    };
  } catch (err) {
    logger.error({ err }, "sheets backup: failed to read status");
    return { configured, lastRun: null };
  }
}

/**
 * Trigger the backup script now. Spawns the npm script detached and
 * returns immediately; the card polls getSheetsBackupStatus() for
 * the outcome the script records into cron_runs.
 */
export async function runSheetsBackupNow(): Promise<ActionResult<{ triggered: true }>> {
  const { staff } = await requireStaff();
  if (!hasMinimumRole(staff, "admin")) {
    return { ok: false, error: "Admin role required." };
  }

  if (!process.env.SHEETS_BACKUP_SPREADSHEET_ID || !process.env.SHEETS_BACKUP_CAMPAIGN_SLUG) {
    return {
      ok: false,
      error:
        "Backup is not configured. Set SHEETS_BACKUP_SPREADSHEET_ID and SHEETS_BACKUP_CAMPAIGN_SLUG in the app environment first.",
    };
  }

  try {
    // Mark a 'running' row so the card shows progress immediately;
    // the script will INSERT its own terminal row on completion. We
    // do NOT update this row -- the script's final row is the
    // authoritative one and getSheetsBackupStatus() reads the most
    // recent. Best-effort; never blocks the trigger.
    await db
      .execute(
        sql`INSERT INTO cron_runs (cron_name, status, host) VALUES (${CRON_NAME}, 'running', ${"admin-trigger"})`,
      )
      .catch((err) => logger.warn({ err }, "sheets backup: could not mark running row"));

    const child = spawn("npm", ["run", "--silent", "backup:sheets"], {
      cwd: process.cwd(),
      detached: true,
      stdio: "ignore",
      env: process.env,
    });
    // Unref so the request can return without waiting for the export.
    child.unref();
    child.on("error", (err) => {
      logger.error({ err }, "sheets backup: spawn failed");
    });

    logger.info({ staffId: staff.id }, "sheets backup: manual export triggered");
    return { ok: true, data: { triggered: true } };
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    logger.error({ err }, "sheets backup: trigger failed");
    return { ok: false, error: `Could not start the export: ${msg}` };
  }
}
