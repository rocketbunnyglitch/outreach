/**
 * City × Campaign junction validation.
 *
 * Adding a city to a campaign sets per-city goals (target venue counts,
 * sales goal) and an optional lead staffer. The same city can exist in
 * many campaigns; the same campaign can include many cities. The unique
 * index on (city_id, campaign_id) prevents duplicates.
 */

import { z } from "zod";

const uuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Must be a valid UUID");

const positiveSmallintSchema = z
  .union([
    z.literal("").transform(() => undefined),
    z.coerce.number().int().nonnegative().lte(32767),
  ])
  .optional();

const positiveBigintCentsSchema = z
  .union([z.literal("").transform(() => undefined), z.coerce.number().int().nonnegative()])
  .optional();

export const cityCampaignCreateSchema = z.object({
  cityId: uuidSchema,
  campaignId: uuidSchema,
  priority: positiveSmallintSchema,
  targetVenueCount: positiveSmallintSchema,
  targetWristbandCount: positiveSmallintSchema,
  targetFinalCount: positiveSmallintSchema,
  targetMiddleCount: positiveSmallintSchema,
  salesGoalCents: positiveBigintCentsSchema,
  leadStaffId: z
    .union([
      z.literal("_none").transform(() => null),
      z.literal("").transform(() => undefined),
      uuidSchema,
    ])
    .optional(),
  status: z.enum(["planning", "active", "confirmed", "cancelled"]).optional(),
});

export const cityCampaignUpdateSchema = cityCampaignCreateSchema.partial();
export type CityCampaignCreateInput = z.infer<typeof cityCampaignCreateSchema>;
export type CityCampaignUpdateInput = z.infer<typeof cityCampaignUpdateSchema>;
