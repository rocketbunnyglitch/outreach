/**
 * cron-runs.ts -- recordCronRun() wraps a cron handler so every
 * invocation gets a row in the cron_runs table.
 *
 * Usage in a cron route:
 *
 *   import { recordCronRun } from "@/lib/cron-runs";
 *
 *   export async function POST(req: Request) {
 *     // ... CRON_SECRET check ...
 *     return await recordCronRun("stale-tagger", async () => {
 *       const result = await runStaleTagger();
 *       return NextResponse.json({ ok: true, ...result });
 *     });
 *   }
 *
 * The wrapper:
 *
 *   1. Inserts a `cron_runs` row with status='running',
 *      started_at = NOW().
 *   2. Calls the handler, captures its return value.
 *   3. On success: UPDATE the row to status='success', set
 *      finished_at + duration_ms, and JSON-stringify the
 *      handler's return body into result_summary (capped).
 *   4. On error: UPDATE the row to status='error', set
 *      finished_at + duration_ms + error_message (capped), then
 *      RE-THROW so the route's existing error handler returns
 *      a 500 to the cron scheduler. The scheduler can then
 *      retry / page based on its own policy.
 *
 * Failure-mode philosophy:
 *
 *   - A DB outage that breaks the tracking INSERT must NOT
 *     prevent the cron from running. We swallow tracking
 *     failures (log + continue) and run the handler anyway.
 *     The handler may itself fail because the DB is down --
 *     that's the handler's problem, not the tracker's.
 *
 *   - The tracking UPDATE on completion is also best-effort.
 *     If the row was successfully inserted but the UPDATE
 *     fails, the row stays in 'running' forever. The admin
 *     dashboard detects this via a finished_at-is-null +
 *     started_at > 30 minutes ago heuristic and shows it as
 *     a likely-failure.
 *
 *   - We don't transact. The cron handler does its own DB
 *     work in its own transactions; wrapping that in an
 *     outer transaction would force a long-running tx that
 *     could block other connections.
 *
 * Result-summary capping:
 *
 *   Some crons return rich JSON (e.g. drainGmailPolls returns
 *   per-account ingest counts). We JSON.stringify the response
 *   and cap at ~4 KB to defeat pathological growth. If the
 *   serialized body exceeds the cap, we store a truncated
 *   marker {"truncated": true, "size": N} instead of attempting
 *   any half-truncation that would produce invalid JSON.
 */

import "server-only";
import os from "node:os";
import { cronRuns } from "@/db/schema/cron-runs";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { eq } from "drizzle-orm";
import type { NextResponse } from "next/server";

const RESULT_SUMMARY_MAX_BYTES = 4 * 1024;
const ERROR_MESSAGE_MAX_BYTES = 2 * 1024;
const HOST = os.hostname();

export type CronName =
  | "cadence-advance"
  | "daily-digest"
  | "eventbrite-sync"
  | "follow-up-cadence"
  | "gmail-poll"
  | "inbox-alerts"
  | "inbox-daily-stats"
  | "notification-escalation"
  | "relationship-decay"
  | "scheduled-sends"
  | "stale-tagger";

/**
 * Wrap a cron handler in run-tracking. `handler` must return the
 * NextResponse the route is going to send -- the wrapper reads the
 * response body to capture the cron's own summary, then returns the
 * SAME response unchanged (no re-serialization). The route just
 * `return await recordCronRun(...)`s.
 *
 * On handler throw: tracking row is updated to error, then the
 * error is re-thrown so the route's surrounding try/catch can
 * return a 500.
 */
export async function recordCronRun(
  cronName: CronName,
  handler: () => Promise<NextResponse>,
): Promise<NextResponse> {
  const startMs = Date.now();
  let runId: string | null = null;

  try {
    const inserted = await db
      .insert(cronRuns)
      .values({ cronName, status: "running", host: HOST })
      .returning({ id: cronRuns.id });
    runId = inserted[0]?.id ?? null;
  } catch (err) {
    // Tracking-table failure must not prevent the cron itself
    // from running. We log + run the handler unwrapped.
    logger.warn({ err, cronName }, "cron-runs INSERT failed; handler will run untracked");
  }

  let response: NextResponse;
  try {
    response = await handler();
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const message = capError(err);
    if (runId) {
      try {
        await db
          .update(cronRuns)
          .set({
            status: "error",
            finishedAt: new Date(),
            durationMs,
            errorMessage: message,
          })
          .where(eq(cronRuns.id, runId));
      } catch (updateErr) {
        logger.warn({ err: updateErr, runId, cronName }, "cron-runs UPDATE-on-error failed");
      }
    }
    throw err;
  }

  const durationMs = Date.now() - startMs;
  if (runId) {
    let resultSummary: unknown = null;
    try {
      // Clone the response so we can read the body without
      // consuming the one we return. NextResponse extends Response;
      // Response.clone() is the supported way to read twice.
      const cloned = response.clone();
      const text = await cloned.text();
      resultSummary = capSummary(text);
    } catch (readErr) {
      logger.warn({ err: readErr, runId, cronName }, "cron-runs result-body read failed");
    }
    try {
      await db
        .update(cronRuns)
        .set({
          status: "success",
          finishedAt: new Date(),
          durationMs,
          resultSummary,
        })
        .where(eq(cronRuns.id, runId));
    } catch (updateErr) {
      logger.warn({ err: updateErr, runId, cronName }, "cron-runs UPDATE-on-success failed");
    }
  }

  return response;
}

function capError(err: unknown): string {
  const raw =
    err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ""}` : String(err);
  return raw.length > ERROR_MESSAGE_MAX_BYTES
    ? `${raw.slice(0, ERROR_MESSAGE_MAX_BYTES)}...[truncated]`
    : raw;
}

function capSummary(text: string): unknown {
  if (text.length === 0) return null;
  if (Buffer.byteLength(text, "utf8") > RESULT_SUMMARY_MAX_BYTES) {
    return { truncated: true, size: Buffer.byteLength(text, "utf8") };
  }
  try {
    // The route returns JSON; parse it so the column stores
    // structured data the admin page can render natively
    // instead of an opaque string.
    return JSON.parse(text);
  } catch {
    // Defensive: a route that returned non-JSON for some reason.
    // Store the raw text under a marker key so we don't lose it.
    return { raw: text.slice(0, 200) };
  }
}
