/**
 * Email template validation.
 *
 * Templates are scoped per (outreach_brand × stage × name). The unique index
 * on (outreach_brand_id, stage, name) prevents accidental dupes. Default
 * template per stage is a soft constraint — when `isDefaultForStage` is set
 * true, the action clears it on any other template in the same brand×stage.
 */

import { z } from "zod";

const uuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Must be a valid UUID");

const stageEnum = z.enum([
  "cold",
  "follow_up_1",
  "follow_up_2",
  "poster_delivery",
  "confirm_2_week",
  "confirm_1_week",
  "floor_staff_3_day",
  "custom",
]);

// trigger_context validation (Phase 1.1). Mirrors TriggerContext in
// db/schema/templates.ts. Unknown keys are stripped, not rejected.
const triggerContextSchema = z.object({
  channel: z
    .enum(["cold", "warm", "post_confirm", "lifecycle", "cancellation", "post_event"])
    .optional(),
  stage: z
    .enum([
      "first_touch",
      "follow_up",
      "detail",
      "confirmation",
      "graphic",
      "info_sheets",
      "pre_event",
      "day_before",
      "day_of",
    ])
    .optional(),
  event_type: z.enum(["night", "day_party", "any"]).optional(),
  ask_size: z.enum(["big_open", "small_specific"]).optional(),
  priority: z.array(z.number().int()).optional(),
  crawls: z.enum(["multiple", "single", "any"]).optional(),
  wristband_only: z.boolean().optional(),
  prior_relationship: z.boolean().optional(),
  min_days_to_event: z.number().int().optional(),
  max_days_to_event: z.number().int().optional(),
});

export const emailTemplateCreateSchema = z.object({
  outreachBrandId: uuidSchema,
  campaignId: uuidSchema.optional(),
  templateCode: z.string().trim().min(1).max(64).optional(),
  triggerContext: triggerContextSchema.optional(),
  autoPickPriority: z.coerce.number().int().min(0).optional(),
  stage: stageEnum,
  name: z.string().trim().min(1, "Required").max(200),
  subjectTemplate: z.string().trim().min(1, "Required").max(500),
  bodyTemplateText: z.string().trim().min(1, "Required").max(20000),
  bodyTemplateHtml: z
    .union([z.literal("").transform(() => undefined), z.string().max(40000)])
    .optional(),
  isDefaultForStage: z
    .union([
      z.literal("true").transform(() => true),
      z.literal("false").transform(() => false),
      z.boolean(),
    ])
    .optional()
    .default(false),
});

export const emailTemplateUpdateSchema = emailTemplateCreateSchema.partial().omit({
  outreachBrandId: true,
  stage: true,
});

export type EmailTemplateCreateInput = z.infer<typeof emailTemplateCreateSchema>;
export type EmailTemplateUpdateInput = z.infer<typeof emailTemplateUpdateSchema>;

export const STAGE_LABELS: Record<z.infer<typeof stageEnum>, string> = {
  cold: "Cold (first contact)",
  follow_up_1: "Follow-up 1",
  follow_up_2: "Follow-up 2",
  poster_delivery: "Poster delivery",
  confirm_2_week: "Confirm — 2 weeks out",
  confirm_1_week: "Confirm — 1 week out",
  floor_staff_3_day: "Floor staff — 3 days out",
  custom: "Custom",
};
