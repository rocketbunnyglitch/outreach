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

export const emailTemplateCreateSchema = z.object({
  outreachBrandId: uuidSchema,
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
