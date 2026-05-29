"use server";

/**
 * Row-level activity history.
 *
 * Loads the audit_log entries for a given (table_name, record_id) pair
 * and shapes them into something the UI can render as a diff-style
 * timeline. Optionally bundles related records — e.g. a cold outreach
 * row's history includes BOTH the cold_outreach_entries changes AND
 * the underlying venue's changes, because operators think of them as
 * one thing.
 *
 * Returns most recent first. Capped at 50 entries per record to keep
 * the popover responsive — deeper history is available via the
 * audit log page.
 */

import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export interface ActivityEntry {
  id: string;
  table: string;
  operation: "INSERT" | "UPDATE" | "DELETE";
  changedAt: string; // ISO
  changedByDisplayName: string | null;
  /** Field-level diffs computed from old/new JSON snapshots */
  changes: Array<{
    field: string;
    from: string | null;
    to: string | null;
  }>;
}

const SYSTEM_FIELDS = new Set([
  "id",
  "created_at",
  "updated_at",
  "created_by",
  "updated_by",
  "version",
]);

interface AuditRow extends Record<string, unknown> {
  id: string;
  table_name: string;
  operation: "INSERT" | "UPDATE" | "DELETE";
  changed_at: string;
  changed_by_display_name: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
}

function computeChanges(row: AuditRow): ActivityEntry["changes"] {
  // Skip system noise — we care about business field changes
  const before = row.old_values ?? {};
  const after = row.new_values ?? {};
  const keys = new Set<string>([
    ...Object.keys(before).filter((k) => !SYSTEM_FIELDS.has(k)),
    ...Object.keys(after).filter((k) => !SYSTEM_FIELDS.has(k)),
  ]);

  const changes: ActivityEntry["changes"] = [];
  for (const k of keys) {
    const fromVal = before[k];
    const toVal = after[k];
    if (JSON.stringify(fromVal) === JSON.stringify(toVal)) continue;
    changes.push({
      field: k,
      from: fromVal == null ? null : String(fromVal),
      to: toVal == null ? null : String(toVal),
    });
  }
  return changes;
}

export async function loadRowActivity(params: {
  /** Primary record — required */
  table: string;
  recordId: string;
  /** Optional secondary record to merge in (e.g. underlying venue) */
  alsoTable?: string;
  alsoRecordId?: string;
  /** Default 50; cap is 200 */
  limit?: number;
}): Promise<ActivityEntry[]> {
  await requireStaff();

  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);

  const result = await db.execute<AuditRow>(sql`
    SELECT
      al.id::text AS id,
      al.table_name,
      al.operation::text AS operation,
      al.changed_at::text,
      sm.display_name AS changed_by_display_name,
      al.old_values,
      al.new_values
    FROM audit_log al
    LEFT JOIN users sm ON sm.id = al.changed_by
    WHERE
      (al.table_name = ${params.table} AND al.record_id = ${params.recordId}::uuid)
      ${
        params.alsoTable && params.alsoRecordId
          ? sql`OR (al.table_name = ${params.alsoTable} AND al.record_id = ${params.alsoRecordId}::uuid)`
          : sql``
      }
    ORDER BY al.changed_at DESC
    LIMIT ${limit}
  `);

  const rows: AuditRow[] = Array.isArray(result)
    ? (result as unknown as AuditRow[])
    : ((result as unknown as { rows: AuditRow[] }).rows ?? []);

  return (
    rows
      .map((r) => ({
        id: r.id,
        table: r.table_name,
        operation: r.operation,
        changedAt: r.changed_at,
        changedByDisplayName: r.changed_by_display_name,
        changes: computeChanges(r),
      }))
      // Drop noise events — INSERTs we'll keep (first-touch milestone)
      // but UPDATEs with zero non-system changes are pruned.
      .filter((e) => e.operation === "INSERT" || e.changes.length > 0)
  );
}

/**
 * Summary tuple used for the inline 'last edit by X · Yh ago' badge.
 * One light query, no JSON parsing — just the most recent changed_by
 * and changed_at for a record.
 */
export interface ActivitySummary {
  lastChangedBy: string | null;
  lastChangedAt: string | null;
}

export async function loadActivitySummary(params: {
  table: string;
  recordId: string;
  alsoTable?: string;
  alsoRecordId?: string;
}): Promise<ActivitySummary> {
  await requireStaff();

  const result = await db.execute<{
    last_changed_at: string | null;
    display_name: string | null;
  }>(sql`
    SELECT
      al.changed_at::text AS last_changed_at,
      sm.display_name
    FROM audit_log al
    LEFT JOIN users sm ON sm.id = al.changed_by
    WHERE
      (al.table_name = ${params.table} AND al.record_id = ${params.recordId}::uuid)
      ${
        params.alsoTable && params.alsoRecordId
          ? sql`OR (al.table_name = ${params.alsoTable} AND al.record_id = ${params.alsoRecordId}::uuid)`
          : sql``
      }
    ORDER BY al.changed_at DESC
    LIMIT 1
  `);

  const rows: Array<{ last_changed_at: string | null; display_name: string | null }> =
    Array.isArray(result)
      ? (result as unknown as Array<{
          last_changed_at: string | null;
          display_name: string | null;
        }>)
      : ((
          result as unknown as {
            rows: Array<{ last_changed_at: string | null; display_name: string | null }>;
          }
        ).rows ?? []);

  const row = rows[0];
  return {
    lastChangedBy: row?.display_name ?? null,
    lastChangedAt: row?.last_changed_at ?? null,
  };
}
