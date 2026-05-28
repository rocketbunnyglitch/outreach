/**
 * Validation schemas for Campaign create/update.
 *
 * A Campaign has FKs to BOTH an OutreachBrand and a CrawlBrand (DECISIONS#010).
 * The form must surface this two-brand decision clearly; the schema doesn't
 * try to validate brand compatibility (that's a server-side check using
 * `checkCrawlBrandGeographyCompatibility`).
 */

import { z } from "zod";

// Same slug normalization rule as brands: lowercase, hyphenated, no leading/
// trailing hyphens, 2-60 chars.
const slugSchema = z
  .string()
  .min(2, "Slug must be at least 2 characters")
  .max(60, "Slug must be at most 60 characters")
  .regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    "Slug must be lowercase letters/digits/hyphens, not starting or ending with a hyphen",
  );

const uuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Must be a valid UUID");

const holidayTypeSchema = z.enum(["stpaddys", "halloween", "newyears", "custom"]);

const campaignStatusSchema = z.enum(["planning", "active", "completed", "archived"]);

// ISO date (YYYY-MM-DD) — what the date input emits.
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be in YYYY-MM-DD format")
  .optional();

// Allow blank → undefined, otherwise positive int. cents.
const _positiveBigintCentsSchema = z
  .union([
    z.literal("").transform(() => undefined),
    z.coerce.number().int("Must be a whole number of cents").nonnegative("Must be non-negative"),
  ])
  .optional();

const _positiveIntSchema = z
  .union([z.literal("").transform(() => undefined), z.coerce.number().int().nonnegative()])
  .optional();

export const campaignCreateSchema = z
  .object({
    slug: slugSchema,
    name: z.string().min(2).max(120),
    // Per DECISIONS.md #022 staff picks brand/alias at send time, so the
    // form no longer prompts for an outreach brand. The action auto-fills
    // the legacy DB column with the first-available brand to satisfy the
    // NOT NULL constraint until the column drop in a future migration.
    outreachBrandId: uuidSchema.optional(),
    // Per #023 crawl_brands is being removed; the form no longer asks.
    // Same auto-fill pattern in the action.
    crawlBrandId: uuidSchema.optional(),
    holidayType: holidayTypeSchema,
    status: campaignStatusSchema.optional(),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    // publicSubdomain removed per #024 (public pages live outside this app).
    // revenueGoalCents + venueCountGoal removed per #025 (goals refactored
    // to admin-only ticket-sales count, lives under /admin/goals).
    //
    // NEW outreach-team goals per #025 + migration 0026. Visible on the
    // campaign form to all roles (#025 makes the dollar goal admin-only,
    // but these two are operational goals every staffer should see).
    targetCitiesScheduled: z.coerce.number().int().min(0).max(10000).optional(),
    maxPriorityForScheduling: z.coerce.number().int().min(1).max(100).optional(),
  })
  .refine((data) => !data.startDate || !data.endDate || data.startDate <= data.endDate, {
    message: "End date must be on or after start date",
    path: ["endDate"],
  });

export type CampaignCreateInput = z.infer<typeof campaignCreateSchema>;

// Update is partial except for id (which is in the URL, not the form body).
export const campaignUpdateSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    holidayType: holidayTypeSchema.optional(),
    status: campaignStatusSchema.optional(),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    // publicSubdomain / revenueGoalCents / venueCountGoal removed per
    // operator session 11 (#024 + #025).
    targetCitiesScheduled: z.coerce.number().int().min(0).max(10000).optional(),
    maxPriorityForScheduling: z.coerce.number().int().min(1).max(100).optional(),
  })
  .refine((data) => !data.startDate || !data.endDate || data.startDate <= data.endDate, {
    message: "End date must be on or after start date",
    path: ["endDate"],
  });

export type CampaignUpdateInput = z.infer<typeof campaignUpdateSchema>;
