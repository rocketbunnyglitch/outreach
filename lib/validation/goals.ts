/**
 * Goal validation.
 *
 * Goals are top-down targets set by admin. The scope_id is polymorphic —
 * for scope='campaign' it must be a valid campaigns.id, for
 * scope='outreach_brand' it must be an outreach_brands.id, etc.
 * App layer enforces.
 *
 * targetValue is bigint to fit revenue in cents (e.g. $50k = 5,000,000).
 * The form accepts dollars for revenue metrics and converts; for count
 * metrics (venue_count, emails_sent, etc.) it's whole units.
 */

import { z } from "zod";

const uuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Must be a valid UUID");

export const goalScopeEnum = z.enum([
  "campaign",
  "outreach_brand",
  "crawl_brand",
  "city_campaign",
  "staff_weekly",
]);

export const goalMetricEnum = z.enum([
  "revenue_cents",
  "venue_count",
  "emails_sent",
  "calls_made",
  "confirmations",
  "replies_received",
]);

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD");

export const goalCreateSchema = z
  .object({
    scope: goalScopeEnum,
    scopeId: uuidSchema,
    metric: goalMetricEnum,
    // For revenue_cents the UI sends dollars (we convert in the action).
    // For count metrics, the raw count.
    targetValueDisplay: z.coerce.number().int().min(1, "Must be at least 1"),
    periodStart: dateSchema,
    periodEnd: dateSchema,
  })
  .refine((d) => d.periodStart <= d.periodEnd, {
    message: "Period end must be on or after period start",
    path: ["periodEnd"],
  });
export type GoalCreateInput = z.infer<typeof goalCreateSchema>;

export const goalUpdateSchema = z
  .object({
    id: uuidSchema,
    metric: goalMetricEnum,
    targetValueDisplay: z.coerce.number().int().min(1),
    periodStart: dateSchema,
    periodEnd: dateSchema,
    version: z.coerce.number().int().min(1),
  })
  .refine((d) => d.periodStart <= d.periodEnd, {
    message: "Period end must be on or after period start",
    path: ["periodEnd"],
  });
export type GoalUpdateInput = z.infer<typeof goalUpdateSchema>;

export const goalDeleteSchema = z.object({
  id: uuidSchema,
});
export type GoalDeleteInput = z.infer<typeof goalDeleteSchema>;

/**
 * Convert UI display value → DB storage value.
 *
 * For revenue_cents the UI shows whole dollars; we multiply by 100 to get
 * cents. Other metrics pass through unchanged.
 */
export function toStorageValue(metric: GoalCreateInput["metric"], display: number): bigint {
  if (metric === "revenue_cents") return BigInt(display) * 100n;
  return BigInt(display);
}

/**
 * Convert DB storage value → UI display value.
 */
export function fromStorageValue(
  metric: GoalCreateInput["metric"],
  storage: bigint | number,
): number {
  const n = typeof storage === "bigint" ? Number(storage) : storage;
  if (metric === "revenue_cents") return Math.round(n / 100);
  return n;
}

/** Human-readable label for a metric. */
export function metricLabel(metric: GoalCreateInput["metric"]): string {
  switch (metric) {
    case "revenue_cents":
      return "Revenue";
    case "venue_count":
      return "Venues confirmed";
    case "emails_sent":
      return "Emails sent";
    case "calls_made":
      return "Calls made";
    case "confirmations":
      return "Confirmations";
    case "replies_received":
      return "Replies received";
  }
}

/** Human-readable label for a scope. */
export function scopeLabel(scope: GoalCreateInput["scope"]): string {
  switch (scope) {
    case "campaign":
      return "Campaign";
    case "outreach_brand":
      return "Outreach brand";
    case "crawl_brand":
      return "Crawl brand";
    case "city_campaign":
      return "City × campaign";
    case "staff_weekly":
      return "Staff (weekly)";
  }
}
