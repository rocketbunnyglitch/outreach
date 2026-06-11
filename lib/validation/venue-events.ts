/**
 * VenueEvent validation — the venue×event junction.
 *
 * Every venue participating in an event has a role (wristband/middle/final)
 * and a status that moves through the negotiation pipeline (lead → contacted
 * → interested → negotiating → confirmed). Slot times are HH:MM 24h.
 *
 * The cadence timestamps (two_week_email_sent_at etc.) are populated by
 * Phase 6 automation — not editable in this Phase 4c form.
 */

import { z } from "zod";

const uuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Must be a valid UUID");

const timeOfDay = z
  .union([
    z.literal("").transform(() => undefined),
    z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Must be HH:MM (24h)"),
  ])
  .optional();

const optionalString = (max = 500) =>
  z.union([z.literal("").transform(() => undefined), z.string().max(max)]).optional();

const optionalE164 = z
  .union([
    z.literal("").transform(() => undefined),
    z.string().regex(/^\+[1-9]\d{9,14}$/, "Must be E.164 format"),
  ])
  .optional();

const optionalStaffId = z
  .union([
    z.literal("_none").transform(() => null),
    z.literal("").transform(() => undefined),
    uuidSchema,
  ])
  .optional();

const base = z.object({
  eventId: uuidSchema,
  venueId: uuidSchema,
  role: z.enum(["wristband", "middle", "final"]),
  status: z
    .enum(["lead", "contacted", "interested", "negotiating", "confirmed", "declined", "cancelled"])
    .default("lead"),
  slotStartTime: timeOfDay,
  slotEndTime: timeOfDay,
  agreedHoursText: optionalString(200),
  drinkSpecials: optionalString(500),
  nightOfContactName: optionalString(200),
  nightOfContactPhoneE164: optionalE164,
  ourContactStaffId: optionalStaffId,
  /** Per-event override of OUR contact's phone (e.g. a staffer's
   *  personal cell for one crawl night instead of the Quo line).
   *  Shown on the staff sheet next to the our-contact name. */
  ourContactOverridePhoneE164: optionalE164,
});

export const venueEventCreateSchema = base;
export const venueEventUpdateSchema = base.partial().omit({
  eventId: true,
  venueId: true,
});

export type VenueEventCreateInput = z.infer<typeof venueEventCreateSchema>;
export type VenueEventUpdateInput = z.infer<typeof venueEventUpdateSchema>;
