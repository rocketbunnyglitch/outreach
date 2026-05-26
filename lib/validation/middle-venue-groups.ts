/**
 * Middle venue group validation.
 *
 * Groups hold venues that share the "middle" role across multiple crawls
 * within one city_campaign. The cluster builder writes here too — it
 * collects a walking-distance cluster of venues and saves them as a
 * group with one server action.
 */

import { z } from "zod";

const uuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Must be a valid UUID");

const dayPartEnum = z.enum([
  "thursday_night",
  "friday_night",
  "saturday_day",
  "saturday_night",
  "sunday_day",
  "sunday_night",
  "other",
]);

const optionalDayPart = z.union([z.literal("").transform(() => undefined), dayPartEnum]).optional();

const optionalText = z
  .union([z.literal("").transform(() => undefined), z.string().max(500)])
  .optional();

export const middleVenueGroupCreateSchema = z.object({
  cityCampaignId: uuidSchema,
  name: z.string().trim().min(1, "Required").max(120),
  dayPart: optionalDayPart,
  notes: optionalText,
  /**
   * Comma-separated venue IDs the cluster builder passed in. The action
   * splits, validates each as UUID, and inserts middle_venue_group_members
   * in the same transaction as the group.
   */
  venueIds: z
    .string()
    .transform((s) =>
      s
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean),
    )
    .pipe(z.array(uuidSchema).min(0).max(50))
    .optional(),
});
export type MiddleVenueGroupCreateInput = z.infer<typeof middleVenueGroupCreateSchema>;

export const middleVenueGroupUpdateSchema = z.object({
  id: uuidSchema,
  name: z.string().trim().min(1).max(120),
  dayPart: optionalDayPart,
  notes: optionalText,
  status: z.union([z.literal("").transform(() => "planning"), z.string().max(40)]).optional(),
  version: z.coerce.number().int().min(1),
});
export type MiddleVenueGroupUpdateInput = z.infer<typeof middleVenueGroupUpdateSchema>;

export const middleVenueGroupMemberAddSchema = z.object({
  middleVenueGroupId: uuidSchema,
  venueId: uuidSchema,
});

export const middleVenueGroupMemberRemoveSchema = z.object({
  id: uuidSchema,
});
