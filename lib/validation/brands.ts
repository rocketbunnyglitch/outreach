/**
 * Zod validation schemas for OutreachBrand and CrawlBrand input.
 *
 * Used by server actions (`app/(admin)/brands/_actions.ts`) and shared
 * with client forms (when React Hook Form lands in Phase 4).
 *
 * Naming convention:
 *   - `*Create` schemas: required fields for new records
 *   - `*Update` schemas: all fields optional except identifier
 *
 * Slug normalization happens here so the DB receives a canonical form.
 */

import { z } from "zod";

// =========================================================================
// Reusable atoms
// =========================================================================

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "slug must be at least 2 characters")
  .max(50, "slug must be at most 50 characters")
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "slug must contain only lowercase letters, numbers, and single hyphens",
  );

const displayName = z.string().trim().min(1, "display name is required").max(80);

const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "color must be a 6-digit hex like #ff6b35")
  .transform((s) => s.toLowerCase());

const emailDomain = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/,
    "must be a valid domain like eventsperse.com",
  );

const e164 = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, "must be E.164 format like +14165551234")
  .optional()
  .or(z.literal("").transform(() => undefined));

const optionalString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal("").transform(() => undefined));

const optionalLongText = z
  .string()
  .trim()
  .optional()
  .or(z.literal("").transform(() => undefined));

// =========================================================================
// OutreachBrand
// =========================================================================

export const outreachBrandCreateSchema = z.object({
  slug,
  displayName,
  emailDomain,
  postmarkAccountId: optionalString(100),
  postmarkSenderSignature: optionalString(200),
  postmarkServerToken: optionalString(200),
  emailSignatureHtml: optionalLongText,
  emailSignatureText: optionalLongText,
  quoLineE164: e164,
  status: z.enum(["active", "retired"]).default("active"),
});

export const outreachBrandUpdateSchema = outreachBrandCreateSchema.partial();

export type OutreachBrandCreateInput = z.infer<typeof outreachBrandCreateSchema>;
export type OutreachBrandUpdateInput = z.infer<typeof outreachBrandUpdateSchema>;

// =========================================================================
// CrawlBrand
// =========================================================================

export const crawlBrandCreateSchema = z.object({
  slug,
  displayName,
  holidayType: z.enum(["stpaddys", "halloween", "newyears", "custom"]),
  geography: z.enum(["toronto", "international"]),
  publicDomain: optionalString(200),
  primaryColorHex: hexColor.optional().or(z.literal("").transform(() => undefined)),
  accentColorHex: hexColor.optional().or(z.literal("").transform(() => undefined)),
  tagline: optionalString(200),
  publicFooterText: optionalLongText,
  eventbriteOrganizationId: optionalString(100),
  eventbriteApiToken: optionalString(500),
  defaultOutreachBrandId: z.string().uuid().optional().nullable(),
  publicAssetsEnabled: z.boolean().default(true),
  templateVersion: z.string().trim().min(1).max(20).default("v1"),
  status: z.enum(["active", "retired"]).default("active"),
});

export const crawlBrandUpdateSchema = crawlBrandCreateSchema.partial();

export type CrawlBrandCreateInput = z.infer<typeof crawlBrandCreateSchema>;
export type CrawlBrandUpdateInput = z.infer<typeof crawlBrandUpdateSchema>;
