/**
 * audit_log — row-level change history populated by the audit trigger
 * function defined in db/migrations/0000_setup.sql.
 *
 * High-volume table; uses bigserial PK (not UUID) since we don't need
 * cross-system uniqueness here and bigserial is more index-friendly.
 *
 * The trigger function reads the current actor from the session-level
 * setting `app.current_user_id`, which the app sets at the start of each
 * transaction via `SET LOCAL app.current_user_id = ...`. NULL means a
 * system-initiated change (e.g. background jobs without a user context).
 *
 * Spec §5.3 row-level change log. Visible in the admin Audit Log Viewer
 * (Section 7.10).
 */

import { bigserial, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { auditOperation } from "./enums";

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),

    tableName: text("table_name").notNull(),
    recordId: uuid("record_id"), // null for tables without UUID id

    operation: auditOperation("operation").notNull(),
    changedBy: uuid("changed_by"), // staff_member.id; null for system

    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),

    // JSONB snapshots. For INSERT only new_values is populated; for DELETE
    // only old_values; UPDATE has both.
    oldValues: jsonb("old_values"),
    newValues: jsonb("new_values"),
  },
  (table) => ({
    tableRecordIdx: index("audit_log_table_record_idx").on(
      table.tableName,
      table.recordId,
      table.changedAt,
    ),
    changedByIdx: index("audit_log_changed_by_idx").on(table.changedBy, table.changedAt),
    changedAtIdx: index("audit_log_changed_at_idx").on(table.changedAt),
  }),
);

export type AuditLogEntry = typeof auditLog.$inferSelect;
