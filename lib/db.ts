/**
 * Postgres connection pool + Drizzle ORM instance.
 *
 * Single shared pool per process. Lazy initialization so import-time side
 * effects don't fire when this module is pulled in by build tooling.
 *
 * Audit context: the audit trigger function (db/migrations/0000_setup.sql)
 * reads the actor from the session-level setting `app.current_user_id`.
 * Use `withAuditContext(staffId, fn)` to set it for the duration of a
 * transaction. Without it, audit_log.changed_by will be NULL.
 */

import { sql } from "drizzle-orm";
import { type NodePgDatabase, drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import * as schema from "../db/schema";
import { env } from "./env";
import { logger } from "./logger";
import { publishRealtime } from "./realtime-publish";

type Database = NodePgDatabase<typeof schema>;

const poolConfig: PoolConfig = {
  connectionString: env.DATABASE_URL,
  // Conservative defaults; tune in Phase 4+ once we see real query patterns.
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
};

let _pool: Pool | undefined;

function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool(poolConfig);
    _pool.on("error", (err) => {
      logger.error({ err }, "postgres pool emitted an error");
    });
  }
  return _pool;
}

export const db: Database = drizzle(getPool(), {
  schema,
  logger: env.NODE_ENV === "development",
});

/**
 * Run a callback inside a transaction with the audit actor set to the
 * given staff member id. The audit trigger function reads this on every
 * INSERT/UPDATE/DELETE within the transaction.
 *
 * Usage:
 *   await withAuditContext(staffId, async (tx) => {
 *     await tx.update(venues).set(...).where(...);
 *     await tx.insert(notes).values(...);
 *   });
 *
 * If `staffId` is null, the transaction proceeds without an actor — used
 * for background jobs and system-initiated changes.
 */
export async function withAuditContext<T>(
  staffId: string | null,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  const result = await db.transaction(async (tx) => {
    if (staffId) {
      // Drizzle's tx.execute(sql.raw(...)) is for parameterized queries.
      // SET LOCAL doesn't accept parameters, so we validate the UUID format
      // manually before interpolation to avoid injection.
      if (!isValidUuid(staffId)) {
        throw new Error(`Invalid UUID for audit context: ${staffId}`);
      }
      await tx.execute(sql.raw(`SET LOCAL app.current_user_id = '${staffId}'`));
    }
    return fn(tx);
  });
  // Transaction committed successfully — broadcast a generic "data changed"
  // event on the firehose channel so every open client soft-refreshes. This
  // gives us live updates everywhere with no per-action wiring; the global
  // RealtimeRefresh consumer filters out the editor's own events by staffId.
  // Fire-and-forget: publishRealtime never throws and never blocks.
  publishRealtime({ table: "all", type: "update", byStaffId: staffId });
  return result;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

/**
 * Health check — does a trivial round-trip to confirm the DB is reachable.
 * Used by /api/health. Keep it cheap.
 */
export async function pingDb(): Promise<boolean> {
  try {
    const pool = getPool();
    // Race against a hard deadline so a hung pool doesn't hang health checks.
    const result = await Promise.race([
      pool.query("SELECT 1 AS ok"),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("db ping timeout")), 1500),
      ),
    ]);
    return result.rows[0]?.ok === 1;
  } catch (err) {
    logger.warn({ err }, "db ping failed");
    return false;
  }
}

/**
 * Graceful shutdown — called from instrumentation on SIGTERM.
 */
export async function closeDb(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = undefined;
  }
}
