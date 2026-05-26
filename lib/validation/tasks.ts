/**
 * Task validation.
 *
 * Tasks are polymorphic — they target a venue_event, venue, city_campaign,
 * wristband, or are misc. The (target_type, target_id) pair is enforced
 * at the application layer (Postgres doesn't do polymorphic FKs cleanly).
 *
 * SLA threshold lets a task be soft-due (no breach alerting) or hard-due
 * (surfaces on dashboard once breached).
 */

import { z } from "zod";

const uuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Must be a valid UUID");

const taskTargetTypeEnum = z.enum(["venue_event", "venue", "city_campaign", "wristband", "misc"]);

const taskStatusEnum = z.enum(["pending", "in_progress", "completed", "cancelled"]);

const taskSourceEnum = z.enum(["auto", "manual"]);

const isoDateTime = z
  .string()
  .refine((s) => !Number.isNaN(new Date(s).getTime()), "Must be a valid ISO datetime")
  .transform((s) => new Date(s));

export const taskCreateSchema = z.object({
  title: z.string().trim().min(1, "Required").max(280),
  description: z.string().trim().max(4000).optional().default(""),
  targetType: taskTargetTypeEnum.default("misc"),
  targetId: uuidSchema.nullable().optional(),
  assignedStaffId: uuidSchema.nullable().optional(),
  dueAt: isoDateTime.nullable().optional(),
  slaThresholdMinutes: z
    .union([
      z.coerce
        .number()
        .int()
        .min(0)
        .max(60 * 24 * 30),
      z.literal(""),
    ])
    .nullable()
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
  // 'source' is fixed to 'manual' for UI-created tasks; auto tasks are
  // inserted from server-side triggers (Phase 7b cascade).
});
export type TaskCreateInput = z.infer<typeof taskCreateSchema>;

export const taskUpdateSchema = z.object({
  id: uuidSchema,
  title: z.string().trim().min(1, "Required").max(280),
  description: z.string().trim().max(4000).optional().default(""),
  status: taskStatusEnum,
  assignedStaffId: uuidSchema.nullable().optional(),
  dueAt: isoDateTime.nullable().optional(),
  slaThresholdMinutes: z
    .union([
      z.coerce
        .number()
        .int()
        .min(0)
        .max(60 * 24 * 30),
      z.literal(""),
    ])
    .nullable()
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
  version: z.coerce.number().int().min(1),
});
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>;

export const taskCompleteSchema = z.object({
  id: uuidSchema,
  version: z.coerce.number().int().min(1),
});
export type TaskCompleteInput = z.infer<typeof taskCompleteSchema>;

export { taskStatusEnum, taskTargetTypeEnum, taskSourceEnum };
