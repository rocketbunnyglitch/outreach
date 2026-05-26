"use server";

/**
 * Server actions for Campaign CRUD.
 *
 * Mirrors the brand actions pattern:
 *   1. requireStaff() → redirect to /login if no session
 *   2. Validate with Zod
 *   3. Server-side compatibility check: a Toronto-only CrawlBrand can't be
 *      paired with an international Campaign and vice versa
 *   4. Insert/update inside withAuditContext(staff.id, ...)
 *   5. Revalidate + redirect
 *
 * The two-FK brand structure (DECISIONS#010) is the most important thing
 * the form has to surface — every Campaign FK references BOTH an
 * OutreachBrand and a CrawlBrand. Mixing them up wrong = sending email
 * under the wrong brand identity.
 */

import { campaigns, crawlBrands } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { withAuditContext } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  type CampaignCreateInput,
  type CampaignUpdateInput,
  campaignCreateSchema,
  campaignUpdateSchema,
} from "@/lib/validation/campaigns";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { DatabaseError } from "pg";

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

function formToObject(form: FormData): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const key of new Set(form.keys())) {
    const values = form.getAll(key);
    const last = values[values.length - 1];
    if (typeof last !== "string") {
      obj[key] = last;
      continue;
    }
    if (last === "") obj[key] = undefined;
    else if (last === "_none") obj[key] = null;
    else if (last === "true" || last === "on") obj[key] = true;
    else if (last === "false" || last === "off") obj[key] = false;
    else obj[key] = last;
  }
  return obj;
}

function wrapDbError(err: unknown, action: string): ActionResult<never> {
  const dbErr = err as DatabaseError;
  logger.error({ err, action }, "campaign action failed");
  if (dbErr?.code === "23505") {
    return { ok: false, error: "A campaign with that slug already exists." };
  }
  if (dbErr?.code === "23503") {
    return { ok: false, error: "Referenced brand or country not found." };
  }
  return { ok: false, error: "Unexpected database error. See server logs." };
}

/**
 * Check that the chosen CrawlBrand's geography is consistent with the
 * holiday type. e.g. a Toronto-only StPaddysCrawl brand should not be
 * paired with a Halloween campaign — different brand families.
 *
 * For Phase 4 we keep this minimal: ensure the CrawlBrand's holidayType
 * matches the Campaign's holidayType. (Geography compatibility was a Phase
 * 2 helper aimed at city assignment; here we just match holidays.)
 */
async function validateCrawlBrandCompatibility(
  crawlBrandId: string,
  holidayType: "stpaddys" | "halloween" | "newyears" | "custom",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [row] = await db
    .select({ holidayType: crawlBrands.holidayType })
    .from(crawlBrands)
    .where(eq(crawlBrands.id, crawlBrandId))
    .limit(1);
  if (!row) {
    return { ok: false, error: "Crawl brand not found" };
  }
  if (row.holidayType !== holidayType && holidayType !== "custom") {
    return {
      ok: false,
      error: `Crawl brand is a ${row.holidayType} brand; this campaign is ${holidayType}. Mixing brand families is not allowed.`,
    };
  }
  return { ok: true };
}

// Imported here so the helper can use it.
import { db } from "@/lib/db";

export async function createCampaign(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string; slug: string }>> {
  const { staff } = await requireStaff();

  const parsed = campaignCreateSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const input: CampaignCreateInput = parsed.data;

  const compat = await validateCrawlBrandCompatibility(input.crawlBrandId, input.holidayType);
  if (!compat.ok) {
    return {
      ok: false,
      error: compat.error,
      fieldErrors: { crawlBrandId: [compat.error] },
    };
  }

  try {
    const [row] = await withAuditContext(staff.id, async (tx) =>
      tx
        .insert(campaigns)
        .values({
          slug: input.slug,
          name: input.name,
          outreachBrandId: input.outreachBrandId,
          crawlBrandId: input.crawlBrandId,
          holidayType: input.holidayType,
          status: input.status ?? "planning",
          startDate: input.startDate,
          endDate: input.endDate,
          publicSubdomain: input.publicSubdomain,
          revenueGoalCents:
            input.revenueGoalCents !== undefined ? BigInt(input.revenueGoalCents) : undefined,
          venueCountGoal: input.venueCountGoal,
          createdBy: staff.id,
          updatedBy: staff.id,
        })
        .returning({ id: campaigns.id, slug: campaigns.slug }),
    );
    if (!row) throw new Error("Insert returned no row");

    revalidatePath("/campaigns");
    revalidatePath("/");
    redirect(`/campaigns/${row.id}`);
  } catch (err) {
    return wrapDbError(err, "create campaign");
  }
}

export async function updateCampaign(
  id: string,
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();

  const parsed = campaignUpdateSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const input: CampaignUpdateInput = parsed.data;

  const patch: Partial<typeof campaigns.$inferInsert> = {
    updatedBy: staff.id,
  };
  if (input.name !== undefined) patch.name = input.name;
  if (input.holidayType !== undefined) patch.holidayType = input.holidayType;
  if (input.status !== undefined) patch.status = input.status;
  if (input.startDate !== undefined) patch.startDate = input.startDate;
  if (input.endDate !== undefined) patch.endDate = input.endDate;
  if (input.publicSubdomain !== undefined) patch.publicSubdomain = input.publicSubdomain;
  if (input.revenueGoalCents !== undefined) patch.revenueGoalCents = BigInt(input.revenueGoalCents);
  if (input.venueCountGoal !== undefined) patch.venueCountGoal = input.venueCountGoal;

  try {
    await withAuditContext(staff.id, async (tx) =>
      tx.update(campaigns).set(patch).where(eq(campaigns.id, id)),
    );
    revalidatePath(`/campaigns/${id}`);
    revalidatePath("/campaigns");
    return { ok: true, data: { id } };
  } catch (err) {
    return wrapDbError(err, "update campaign");
  }
}

export async function archiveCampaign(id: string): Promise<void> {
  const { staff } = await requireStaff();
  await withAuditContext(staff.id, async (tx) =>
    tx
      .update(campaigns)
      .set({ status: "archived", archivedAt: new Date(), updatedBy: staff.id })
      .where(eq(campaigns.id, id)),
  );
  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${id}`);
  redirect("/campaigns");
}
