/**
 * Validation schemas for City create/update.
 *
 * Cities have an optional PostGIS point (lng/lat). The form takes them as
 * two separate decimal inputs; the server action assembles them into a
 * `{lat, lng}` shape that the custom Drizzle type knows how to serialize.
 */

import { z } from "zod";

// IANA timezone (e.g. America/Toronto). We're not validating against the
// full tzdata list — the operator is choosing from a curated set in the UI,
// and Postgres won't store invalid timezones anyway (it's a plain text
// column, but downstream code will fail loudly).
const timezoneSchema = z
  .string()
  .min(3)
  .regex(/^[A-Za-z][A-Za-z_]+\/[A-Za-z][A-Za-z_/-]+$/, "Must be an IANA tz like America/Toronto");

const countryCodeSchema = z
  .string()
  .length(2, "Country code must be 2 letters (ISO 3166-1 alpha-2)")
  .regex(/^[A-Z]{2}$/, "Must be uppercase letters")
  .transform((s) => s.toUpperCase());

const optionalLng = z
  .union([z.literal("").transform(() => undefined), z.coerce.number().gte(-180).lte(180)])
  .optional();

const optionalLat = z
  .union([z.literal("").transform(() => undefined), z.coerce.number().gte(-90).lte(90)])
  .optional();

const baseCity = z.object({
  countryCode: countryCodeSchema,
  name: z.string().min(1).max(120),
  region: z.union([z.literal("").transform(() => undefined), z.string().max(120)]).optional(),
  timezone: timezoneSchema,
  longitude: optionalLng,
  latitude: optionalLat,
});

const refineCoordsTogether = (data: { longitude?: number; latitude?: number }) =>
  (data.longitude === undefined) === (data.latitude === undefined);

export const cityCreateSchema = baseCity.refine(refineCoordsTogether, {
  message: "Provide both longitude and latitude, or neither",
  path: ["latitude"],
});
export type CityCreateInput = z.infer<typeof cityCreateSchema>;

export const cityUpdateSchema = baseCity.partial().refine(refineCoordsTogether, {
  message: "Provide both longitude and latitude, or neither",
  path: ["latitude"],
});
export type CityUpdateInput = z.infer<typeof cityUpdateSchema>;
