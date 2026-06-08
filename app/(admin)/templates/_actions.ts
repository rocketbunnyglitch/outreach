"use server";

/**
 * Email template CRUD actions.
 *
 * The `isDefaultForStage` flag has cross-row implications: at most one
 * template per (outreach_brand, stage) can be default. When the operator
 * sets one to default, we clear the flag on any siblings in the same group.
 * Both writes go through the same `withAuditContext` transaction so the
 * audit trail captures them atomically.
 */

import { emailTemplates } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import { type ActionResult, formToObject } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import {
  type EmailTemplateCreateInput,
  type EmailTemplateUpdateInput,
  emailTemplateCreateSchema,
  emailTemplateUpdateSchema,
} from "@/lib/validation/email-templates";
import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { DatabaseError } from "pg";

function wrapDbError(err: unknown, action: string): ActionResult<never> {
  const dbErr = err as DatabaseError;
  logger.error({ err, action }, "email-template action failed");
  if (dbErr?.code === "23505") {
    return {
      ok: false,
      error: "A template with that name already exists for this brand + stage.",
    };
  }
  if (dbErr?.code === "23503") {
    return { ok: false, error: "Referenced outreach brand not found." };
  }
  return { ok: false, error: "Unexpected database error. See server logs." };
}

/**
 * Parse the subject-variants textarea (one variant per line) into the jsonb
 * array (Tier-2 A/B). Returns null when there are fewer than 2 variants -- A/B
 * needs at least two; a single line just means "no A/B, use subjectTemplate".
 */
function parseSubjectVariants(raw: FormDataEntryValue | null): string[] | null {
  if (typeof raw !== "string") return null;
  const lines = raw
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return lines.length >= 2 ? lines : null;
}

export async function createEmailTemplate(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = emailTemplateCreateSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const input: EmailTemplateCreateInput = parsed.data;

  try {
    const id = await withAuditContext(staff.id, async (tx) => {
      // If this one is marked default, clear the flag on siblings first.
      if (input.isDefaultForStage) {
        await tx
          .update(emailTemplates)
          .set({ isDefaultForStage: false, updatedBy: staff.id })
          .where(
            and(
              eq(emailTemplates.outreachBrandId, input.outreachBrandId),
              eq(emailTemplates.stage, input.stage),
              eq(emailTemplates.isDefaultForStage, true),
            ),
          );
      }
      const [row] = await tx
        .insert(emailTemplates)
        .values({
          outreachBrandId: input.outreachBrandId,
          stage: input.stage,
          name: input.name,
          subjectTemplate: input.subjectTemplate,
          subjectVariants: parseSubjectVariants(formData.get("subjectVariants")),
          bodyTemplateText: input.bodyTemplateText,
          bodyTemplateHtml: input.bodyTemplateHtml,
          isDefaultForStage: input.isDefaultForStage,
          createdBy: staff.id,
          updatedBy: staff.id,
        })
        .returning({ id: emailTemplates.id });
      if (!row) throw new Error("insert returned no row");
      return row.id;
    });
    revalidatePath("/templates");
    redirect(`/templates/${id}`);
  } catch (err) {
    // Next.js redirect() throws — let it propagate.
    if (err instanceof Error && err.message === "NEXT_REDIRECT") throw err;
    return wrapDbError(err, "create email template");
  }
}

export async function updateEmailTemplate(
  id: string,
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = emailTemplateUpdateSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const input: EmailTemplateUpdateInput = parsed.data;

  // Fetch existing template to know brand+stage for the default-flip logic.
  const [existing] = await db
    .select({
      outreachBrandId: emailTemplates.outreachBrandId,
      stage: emailTemplates.stage,
    })
    .from(emailTemplates)
    .where(eq(emailTemplates.id, id))
    .limit(1);
  if (!existing) {
    return { ok: false, error: "Template not found." };
  }

  const patch: Partial<typeof emailTemplates.$inferInsert> = {
    updatedBy: staff.id,
  };
  if (input.name !== undefined) patch.name = input.name;
  if (input.subjectTemplate !== undefined) patch.subjectTemplate = input.subjectTemplate;
  // Subject-line A/B (Tier-2): always set from the form so clearing the textarea
  // turns A/B off (null). parseSubjectVariants returns null for <2 lines.
  patch.subjectVariants = parseSubjectVariants(formData.get("subjectVariants"));
  if (input.bodyTemplateText !== undefined) patch.bodyTemplateText = input.bodyTemplateText;
  if (input.bodyTemplateHtml !== undefined) patch.bodyTemplateHtml = input.bodyTemplateHtml;
  if (input.isDefaultForStage !== undefined) patch.isDefaultForStage = input.isDefaultForStage;

  try {
    await withAuditContext(staff.id, async (tx) => {
      // Clear sibling defaults BEFORE setting this one, mirroring the
      // create-action invariant. Only do this if the operator is flipping
      // ON; flipping off is a no-op for siblings.
      if (input.isDefaultForStage === true) {
        await tx
          .update(emailTemplates)
          .set({ isDefaultForStage: false, updatedBy: staff.id })
          .where(
            and(
              eq(emailTemplates.outreachBrandId, existing.outreachBrandId),
              eq(emailTemplates.stage, existing.stage),
              eq(emailTemplates.isDefaultForStage, true),
              ne(emailTemplates.id, id),
            ),
          );
      }
      await tx.update(emailTemplates).set(patch).where(eq(emailTemplates.id, id));
    });
    revalidatePath(`/templates/${id}`);
    revalidatePath("/templates");
    return { ok: true, data: { id } };
  } catch (err) {
    return wrapDbError(err, "update email template");
  }
}

export async function archiveEmailTemplate(id: string): Promise<void> {
  const { staff } = await requireStaff();
  await withAuditContext(staff.id, async (tx) =>
    tx
      .update(emailTemplates)
      .set({ archivedAt: new Date(), updatedBy: staff.id })
      .where(eq(emailTemplates.id, id)),
  );
  revalidatePath("/templates");
  redirect("/templates");
}

/**
 * Promote a single template to be its (brand, stage)'s default —
 * clearing the flag on any sibling that previously held it. Used by
 * the inline "Make default" button on the templates list, so admins
 * don't have to open the edit page just to flip a flag.
 *
 * Returns the id so the caller can revalidate, but the call is also
 * idempotent — calling on an already-default template just no-ops.
 */
export async function setTemplateAsDefault(id: string): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const [existing] = await db
    .select({
      outreachBrandId: emailTemplates.outreachBrandId,
      stage: emailTemplates.stage,
      isDefaultForStage: emailTemplates.isDefaultForStage,
    })
    .from(emailTemplates)
    .where(eq(emailTemplates.id, id))
    .limit(1);
  if (!existing) {
    return { ok: false, error: "Template not found." };
  }
  if (existing.isDefaultForStage) {
    return { ok: true, data: { id } };
  }

  try {
    await withAuditContext(staff.id, async (tx) => {
      // Clear any existing default in the same (brand, stage) group.
      await tx
        .update(emailTemplates)
        .set({ isDefaultForStage: false, updatedBy: staff.id })
        .where(
          and(
            eq(emailTemplates.outreachBrandId, existing.outreachBrandId),
            eq(emailTemplates.stage, existing.stage),
            eq(emailTemplates.isDefaultForStage, true),
          ),
        );
      // Set this one.
      await tx
        .update(emailTemplates)
        .set({ isDefaultForStage: true, updatedBy: staff.id })
        .where(eq(emailTemplates.id, id));
    });
    revalidatePath("/templates");
    return { ok: true, data: { id } };
  } catch (err) {
    return wrapDbError(err, "set template as default");
  }
}
