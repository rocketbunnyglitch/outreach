/**
 * Event validation. An event is one night of a crawl in one city under one
 * campaign — Halloween 2026 Toronto might have events on Oct 28, 29, 30, 31,
 * each possibly with multiple slots if scale demands.
 *
 * The required counts (wristband, middle, final, total) define the venue mix
 * needed for the night: typically 1 wristband (kickoff/anchor), 2 middle
 * stops, 1 final destination. These default to 1/2/1/4 in the schema.
 */

import { z } from "zod";

const uuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Must be a valid UUID");

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be in YYYY-MM-DD format");

const positiveSmallint = z
  .union([
    z.literal("").transform(() => undefined),
    z.coerce.number().int().nonnegative().lte(32767),
  ])
  .optional();

export const eventCreateSchema = z.object({
  cityCampaignId: uuidSchema,
  eventDate: isoDate,
  slotNumber: z
    .union([z.literal("").transform(() => 1), z.coerce.number().int().positive()])
    .default(1),
  eventbriteEventId: z
    .union([z.literal("").transform(() => undefined), z.string().max(200)])
    .optional(),
  requiredVenueCountTotal: positiveSmallint,
  requiredWristbandCount: positiveSmallint,
  requiredMiddleCount: positiveSmallint,
  requiredFinalCount: positiveSmallint,
  status: z.enum(["planned", "confirmed", "completed", "cancelled"]).optional(),
});

export const eventUpdateSchema = eventCreateSchema.partial().omit({
  cityCampaignId: true,
  eventDate: true,
  slotNumber: true,
});

export type EventCreateInput = z.infer<typeof eventCreateSchema>;
export type EventUpdateInput = z.infer<typeof eventUpdateSchema>;
