/**
 * Validation schemas for Venue create/update.
 *
 * Venues are tied to a City. Phone numbers must be E.164 (single + leading
 * digit, then 9-15 digits). Emails are validated by Zod's default.
 *
 * Address + Google Place ID + lat/lng are all optional at create time —
 * Phase 5 lead generation will populate them automatically from the Google
 * Maps cluster builder. For manually-entered venues, only the city + name
 * are required.
 */

import { z } from "zod";

const uuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Must be a valid UUID");

const e164PhoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{9,14}$/, "Must be in E.164 format (e.g. +14165551234)");

const emailSchema = z.string().email("Invalid email address");

const optionalLng = z
  .union([z.literal("").transform(() => undefined), z.coerce.number().gte(-180).lte(180)])
  .optional();

const optionalLat = z
  .union([z.literal("").transform(() => undefined), z.coerce.number().gte(-90).lte(90)])
  .optional();

const optionalString = (max = 255) =>
  z.union([z.literal("").transform(() => undefined), z.string().max(max)]).optional();

const optionalEmail = z.union([z.literal("").transform(() => undefined), emailSchema]).optional();

const optionalPhone = z
  .union([z.literal("").transform(() => undefined), e164PhoneSchema])
  .optional();

const optionalInt = z
  .union([z.literal("").transform(() => undefined), z.coerce.number().int().positive()])
  .optional();

const baseVenue = z.object({
  cityId: uuidSchema,
  name: z.string().min(1).max(200),
  googlePlaceId: optionalString(200),
  address: optionalString(500),
  longitude: optionalLng,
  latitude: optionalLat,
  phoneE164: optionalPhone,
  email: optionalEmail,
  websiteUrl: z
    .union([z.literal("").transform(() => undefined), z.string().url("Must be a valid URL")])
    .optional(),
  instagramHandle: z
    .union([
      z.literal("").transform(() => undefined),
      z
        .string()
        .regex(/^@?[a-zA-Z0-9._]{1,30}$/, "Instagram handle: letters, digits, dot, underscore")
        .transform((s) => (s.startsWith("@") ? s.slice(1) : s)),
    ])
    .optional(),
  capacity: optionalInt,
  servesAlcohol: z.coerce.boolean().optional(),
  internalNotes: z.union([z.literal("").transform(() => ""), z.string().max(5000)]).optional(),
  doNotContact: z.coerce.boolean().optional(),
  doNotContactReason: optionalString(500),
});

const refineCoordsTogether = (data: { longitude?: number; latitude?: number }) =>
  (data.longitude === undefined) === (data.latitude === undefined);

export const venueCreateSchema = baseVenue.refine(refineCoordsTogether, {
  message: "Provide both longitude and latitude, or neither",
  path: ["latitude"],
});
export type VenueCreateInput = z.infer<typeof venueCreateSchema>;

export const venueUpdateSchema = baseVenue.partial().refine(refineCoordsTogether, {
  message: "Provide both longitude and latitude, or neither",
  path: ["latitude"],
});
export type VenueUpdateInput = z.infer<typeof venueUpdateSchema>;
