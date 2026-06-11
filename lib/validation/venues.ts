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

import { toE164 } from "@/lib/phone";
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

/**
 * JSON-encoded array of additional venue emails. The form serializes its
 * dynamic field list into ONE hidden input because formToObject collapses
 * repeated keys to the last value. Deduped case-insensitively, capped at
 * 10 — every address ends up in venues.alternate_emails and compose
 * paths join primary + alternates into the To line.
 */
const alternateEmailsSchema = z
  .union([
    z.literal("").transform(() => [] as string[]),
    z.string().transform((raw, ctx) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid email list." });
        return z.NEVER;
      }
      if (!Array.isArray(parsed)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid email list." });
        return z.NEVER;
      }
      const cleaned = parsed.map((v) => String(v).trim()).filter((v) => v.length > 0);
      for (const e of cleaned) {
        if (!emailSchema.safeParse(e).success) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `"${e}" is not a valid email address.`,
          });
          return z.NEVER;
        }
      }
      return [...new Map(cleaned.map((e) => [e.toLowerCase(), e])).values()].slice(0, 10);
    }),
  ])
  .optional();

// Auto-normalize any pasted/typed format (Google national, dashed, spaced, no
// country code) to E.164 BEFORE validating, so staff are never nagged about the
// format. A bare 10-digit number becomes +1XXXXXXXXXX.
const optionalPhone = z.preprocess(
  (v) => (typeof v === "string" ? toE164(v) : v),
  z.union([z.literal("").transform(() => undefined), e164PhoneSchema]).optional(),
);

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
  alternateEmails: alternateEmailsSchema,
  /** Primary contact person (owner / manager). Optional. */
  contactName: z
    .union([z.literal("").transform(() => undefined), z.string().trim().max(120)])
    .optional(),
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
  // Free-text opening hours pasted from Google Maps. Capped at 2KB
  // since multi-line "Mon 4PM-2AM\n..." entries rarely exceed 200
  // chars, and we want headroom for special-cases ("Holiday hours:
  // closed Dec 24-26"). 5KB matches internalNotes but feels excessive
  // for hours; 2KB is plenty.
  hours: z.union([z.literal("").transform(() => undefined), z.string().max(2000)]).optional(),
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
