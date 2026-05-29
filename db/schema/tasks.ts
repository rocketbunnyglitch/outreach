/**
 * Tasks — both auto-generated (cadence engine) and manual (admin creates
 * follow-ups).
 *
 * Target is polymorphic via (target_type, target_id). Not enforced as FK
 * (Postgres doesn't support polymorphic FKs cleanly); enforced in the
 * app layer.
 *
 * SLA threshold drives alerting: when a task's `due_at` passes by more
 * than sla_threshold_minutes without completion, the dashboard surfaces it.
 */

import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { auditColumns, idColumn, versionColumn } from "../types";
import { taskSource, taskStatus, taskTargetType } from "./enums";
import { staffMembers } from "./users";

export const tasks = pgTable(
  "tasks",
  {
    ...idColumn,

    title: text("title").notNull(),
    description: text("description").notNull().default(""),

    source: taskSource("source").notNull().default("manual"),
    status: taskStatus("status").notNull().default("pending"),

    targetType: taskTargetType("target_type").notNull().default("misc"),
    // Polymorphic — points at venue_event / venue / city_campaign /
    // wristband / nothing depending on target_type. App enforces.
    targetId: uuid("target_id"),

    assignedStaffId: uuid("assigned_staff_id").references(() => staffMembers.id, {
      onDelete: "set null",
    }),

    dueAt: timestamp("due_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),

    // Minutes past due_at after which the task is considered SLA-breached
    // and surfaces in admin alerts. NULL = no SLA, just a soft due date.
    slaThresholdMinutes: integer("sla_threshold_minutes"),

    ...auditColumns,
    ...versionColumn,
  },
  (table) => ({
    assignedDueIdx: index("tasks_assigned_due_idx").on(table.assignedStaffId, table.dueAt),
    statusIdx: index("tasks_status_idx").on(table.status),
    targetIdx: index("tasks_target_idx").on(table.targetType, table.targetId),
    sourceIdx: index("tasks_source_idx").on(table.source),
  }),
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
