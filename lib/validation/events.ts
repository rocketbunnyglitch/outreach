/**
 * Event validation. An event is one night of a crawl in one city under one
 * campaign — Halloween 2026 Toronto might have events on Oct 28, 29, 30, 31,
 * each possibly with multiple slots if scale demands.
 *
 * Phase 8b (Halloween) added richer fields:
 *   - dayPart: thursday_night / friday_night / saturday_day / ...
 *   - crawlNumber: 1, 2, 3 within a daypart
 *   - ticketSalesCount: operational count (alongside revenue tracking)
 *   - startsAt / endsAt: actual datetimes
 *   - routeLabel: free-text label
 *   - eventbriteUrl: full URL (vs. just the ID)
 *   - middleVenueGroupId: optional FK to the new shared-middle table
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

// Empty string → undefined, else coerce.
const optionalSmallint = z
  .union([z.literal("").transform(() => undefined), z.coerce.number().int().positive().lte(32767)])
  .optional();

const optionalInteger = z
  .union([z.literal("").transform(() => 0), z.coerce.number().int().nonnegative()])
  .optional();

const optionalUuid = z.union([z.literal("").transform(() => undefined), uuidSchema]).optional();

const optionalText = z
  .union([z.literal("").transform(() => undefined), z.string().max(500)])
  .optional();

// Accepts the browser-native datetime-local format YYYY-MM-DDTHH:MM
const optionalDateTime = z
  .union([
    z.literal("").transform(() => undefined),
    z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, "Must be a valid datetime"),
  ])
  .optional();

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

export const eventCreateSchema = z.object({
  cityCampaignId: uuidSchema,
  eventDate: isoDate,
  slotNumber: z
    .union([z.literal("").transform(() => 1), z.coerce.number().int().positive()])
    .default(1),
  eventbriteEventId: z
    .union([z.literal("").transform(() => undefined), z.string().max(200)])
    .optional(),
  eventbriteUrl: optionalText,
  // Halloween-aware fields
  dayPart: optionalDayPart,
  crawlNumber: optionalSmallint,
  ticketSalesCount: optionalInteger,
  startsAt: optionalDateTime,
  endsAt: optionalDateTime,
  routeLabel: optionalText,
  middleVenueGroupId: optionalUuid,
  // Required counts
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
