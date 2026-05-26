"use server";

/**
 * Goal server actions.
 *
 * createGoal / updateGoal / deleteGoal. All go through `withAuditContext`.
 * `version` column gives optimistic concurrency.
 *
 * The form sends `targetValueDisplay` in human units (dollars for revenue,
 * whole counts otherwise). The action converts via `toStorageValue` before
 * insert.
 *
 * Scope validation (does the scopeId actually exist for that scope type?)
 * is done at the application layer because Postgres can't FK to a
 * polymorphic column. We pre-check existence in the relevant table; if
 * missing we surface a friendly error rather than letting the audit
 * trigger blow up.
 */

import {
  campaigns,
  cityCampaigns,
  crawlBrands,
  goals,
  outreachBrands,
  staffMembers,
} from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import { type ActionResult, formToObject } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import {
  type GoalCreateInput,
  type GoalDeleteInput,
  type GoalUpdateInput,
  goalCreateSchema,
  goalDeleteSchema,
  goalUpdateSchema,
  toStorageValue,
} from "@/lib/validation/goals";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { DatabaseError } from "pg";

function wrapDbError(err: unknown, action: string): ActionResult<never> {
  const dbErr = err as DatabaseError;
  logger.error({ err, action }, "goal action failed");
  if (dbErr?.code === "23503") {
    return { ok: false, error: "Referenced scope record not found." };
  }
  return { ok: false, error: "Unexpected database error. See server logs." };
}

async function scopeExists(scope: GoalCreateInput["scope"], scopeId: string): Promise<boolean> {
  if (scope === "campaign") {
    const r = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(eq(campaigns.id, scopeId))
      .limit(1);
    return r.length === 1;
  }
  if (scope === "outreach_brand") {
    const r = await db
      .select({ id: outreachBrands.id })
      .from(outreachBrands)
      .where(eq(outreachBrands.id, scopeId))
      .limit(1);
    return r.length === 1;
  }
  if (scope === "crawl_brand") {
    const r = await db
      .select({ id: crawlBrands.id })
      .from(crawlBrands)
      .where(eq(crawlBrands.id, scopeId))
      .limit(1);
    return r.length === 1;
  }
  if (scope === "city_campaign") {
    const r = await db
      .select({ id: cityCampaigns.id })
      .from(cityCampaigns)
      .where(eq(cityCampaigns.id, scopeId))
      .limit(1);
    return r.length === 1;
  }
  if (scope === "staff_weekly") {
    const r = await db
      .select({ id: staffMembers.id })
      .from(staffMembers)
      .where(eq(staffMembers.id, scopeId))
      .limit(1);
    return r.length === 1;
  }
  return false;
}

// === Create ===

export async function createGoal(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = goalCreateSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const input: GoalCreateInput = parsed.data;

  if (!(await scopeExists(input.scope, input.scopeId))) {
    return {
      ok: false,
      error: `The selected ${input.scope.replace("_", " ")} doesn't exist or has been archived.`,
    };
  }

  try {
    const id = await withAuditContext(staff.id, async (tx) => {
      const [row] = await tx
        .insert(goals)
        .values({
          scope: input.scope,
          scopeId: input.scopeId,
          metric: input.metric,
          targetValue: toStorageValue(input.metric, input.targetValueDisplay),
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          setByStaffId: staff.id,
        })
        .returning({ id: goals.id });
      return row?.id ?? "";
    });

    revalidatePath("/goals");
    revalidatePath("/");
    redirect(`/goals/${id}`);
  } catch (err) {
    if (err instanceof Error && err.message === "NEXT_REDIRECT") throw err;
    return wrapDbError(err, "createGoal");
  }
}

// === Update ===

export async function updateGoal(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = goalUpdateSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const input: GoalUpdateInput = parsed.data;

  try {
    const result = await withAuditContext(staff.id, async (tx) => {
      const updated = await tx
        .update(goals)
        .set({
          metric: input.metric,
          targetValue: toStorageValue(input.metric, input.targetValueDisplay),
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
        })
        .where(and(eq(goals.id, input.id), eq(goals.version, input.version)))
        .returning({ id: goals.id });
      return updated.length === 1;
    });

    if (!result) {
      return {
        ok: false,
        error: "This goal was modified by someone else. Refresh and try again.",
      };
    }

    revalidatePath("/goals");
    revalidatePath(`/goals/${input.id}`);
    revalidatePath("/");
    return { ok: true, data: { id: input.id } };
  } catch (err) {
    return wrapDbError(err, "updateGoal");
  }
}

// === Delete ===

export async function deleteGoal(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = goalDeleteSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return { ok: false, error: "Validation failed." };
  }
  const input: GoalDeleteInput = parsed.data;

  try {
    await withAuditContext(staff.id, async (tx) => {
      await tx.delete(goals).where(eq(goals.id, input.id));
    });

    revalidatePath("/goals");
    revalidatePath("/");
    redirect("/goals");
  } catch (err) {
    if (err instanceof Error && err.message === "NEXT_REDIRECT") throw err;
    return wrapDbError(err, "deleteGoal");
  }
}
