"use server";

/**
 * Server actions for OutreachBrand and CrawlBrand mutations.
 *
 * Every action:
 *   1. Resolves the current authenticated staff member via requireStaff();
 *      this redirects to /login if there is no session.
 *   2. Validates input with Zod.
 *   3. Encrypts secret fields via lib/crypto.
 *   4. Runs inside withAuditContext(staff.id, ...) so audit_log captures
 *      who made the change (Phase 3+).
 *   5. Revalidates the brand pages so the new state shows immediately.
 *
 * Returns a plain { ok, error?, brand? } object so client forms can read
 * the result without throwing. Server actions in Next.js can't return
 * non-plain objects via the JSON wire format.
 */

import { crawlBrands, outreachBrands } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { encrypt, isEncryptionAvailable } from "@/lib/crypto";
import { withAuditContext } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  type CrawlBrandCreateInput,
  type OutreachBrandCreateInput,
  crawlBrandCreateSchema,
  crawlBrandUpdateSchema,
  outreachBrandCreateSchema,
  outreachBrandUpdateSchema,
} from "@/lib/validation/brands";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

// =========================================================================
// Helpers
// =========================================================================

/**
 * Parse FormData → plain object suitable for Zod validation.
 *
 * Rules applied:
 *   - Empty strings become undefined (Zod `.optional()` then short-circuits;
 *     for partial updates this means "field not provided" rather than "set
 *     to empty string").
 *   - The "_none" sentinel from <Select>-with-nullable-FK becomes null,
 *     which the Zod schema's `.nullable()` accepts.
 *   - String "true" / "on" become real true; "false" / "off" become false
 *     (Radix Switch and HTML checkboxes both use these).
 *   - For repeated keys (rare; only matters if we add hidden+visible pairs
 *     later) the last entry wins.
 */
function formToObject(form: FormData): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  const seenKeys = new Set<string>();
  for (const key of form.keys()) seenKeys.add(key);

  for (const key of seenKeys) {
    const values = form.getAll(key);
    const last = values[values.length - 1];

    if (typeof last !== "string") {
      // File or other non-string value — pass through.
      obj[key] = last;
      continue;
    }

    // Sentinel translations
    if (last === "") {
      obj[key] = undefined;
      continue;
    }
    if (last === "_none") {
      obj[key] = null;
      continue;
    }
    if (last === "true" || last === "on") {
      obj[key] = true;
      continue;
    }
    if (last === "false" || last === "off") {
      obj[key] = false;
      continue;
    }

    obj[key] = last;
  }

  return obj;
}

/**
 * Encrypt a possibly-empty secret value. Returns:
 *   - undefined if input is undefined (caller should omit from update)
 *   - null if input is empty/null (caller should write NULL to clear)
 *   - encrypted string otherwise
 *
 * Returns an error if encryption is unavailable but a secret was provided.
 */
function encryptOptionalSecret(
  value: string | null | undefined,
): { ok: true; value: string | null | undefined } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null || value === "") return { ok: true, value: null };
  if (!isEncryptionAvailable()) {
    return {
      ok: false,
      error: "APP_ENCRYPTION_KEY is not configured. Cannot store secrets at rest.",
    };
  }
  return { ok: true, value: encrypt(value) };
}

// =========================================================================
// OutreachBrand actions
// =========================================================================

export async function createOutreachBrand(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string; slug: string }>> {
  const { staff } = await requireStaff();

  const parsed = outreachBrandCreateSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const input: OutreachBrandCreateInput = parsed.data;

  const tokenResult = encryptOptionalSecret(input.postmarkServerToken);
  if (!tokenResult.ok) return { ok: false, error: tokenResult.error };

  try {
    const [row] = await withAuditContext(staff.id, async (tx) =>
      tx
        .insert(outreachBrands)
        .values({
          slug: input.slug,
          displayName: input.displayName,
          emailDomain: input.emailDomain,
          postmarkAccountId: input.postmarkAccountId ?? null,
          postmarkSenderSignature: input.postmarkSenderSignature ?? null,
          postmarkServerToken: tokenResult.value ?? null,
          emailSignatureHtml: input.emailSignatureHtml ?? null,
          emailSignatureText: input.emailSignatureText ?? null,
          quoLineE164: input.quoLineE164 ?? null,
          status: input.status,
        })
        .returning({ id: outreachBrands.id, slug: outreachBrands.slug }),
    );

    if (!row) {
      return { ok: false, error: "Insert returned no row." };
    }

    logger.info({ id: row.id, slug: row.slug }, "outreach_brand created");
    revalidatePath("/brands");
    revalidatePath("/");
    return { ok: true, data: row };
  } catch (err) {
    return wrapDbError(err, "create outreach brand");
  }
}

export async function updateOutreachBrand(
  id: string,
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();

  const parsed = outreachBrandUpdateSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const input = parsed.data;

  const tokenResult = encryptOptionalSecret(input.postmarkServerToken);
  if (!tokenResult.ok) return { ok: false, error: tokenResult.error };

  // Build patch — only include fields that were actually provided.
  const patch: Partial<typeof outreachBrands.$inferInsert> = {};
  if (input.slug !== undefined) patch.slug = input.slug;
  if (input.displayName !== undefined) patch.displayName = input.displayName;
  if (input.emailDomain !== undefined) patch.emailDomain = input.emailDomain;
  if (input.postmarkAccountId !== undefined)
    patch.postmarkAccountId = input.postmarkAccountId ?? null;
  if (input.postmarkSenderSignature !== undefined)
    patch.postmarkSenderSignature = input.postmarkSenderSignature ?? null;
  if (tokenResult.value !== undefined) patch.postmarkServerToken = tokenResult.value;
  if (input.emailSignatureHtml !== undefined)
    patch.emailSignatureHtml = input.emailSignatureHtml ?? null;
  if (input.emailSignatureText !== undefined)
    patch.emailSignatureText = input.emailSignatureText ?? null;
  if (input.quoLineE164 !== undefined) patch.quoLineE164 = input.quoLineE164 ?? null;
  if (input.status !== undefined) patch.status = input.status;

  if (Object.keys(patch).length === 0) {
    return { ok: true, data: { id } };
  }

  try {
    await withAuditContext(staff.id, async (tx) =>
      tx.update(outreachBrands).set(patch).where(eq(outreachBrands.id, id)),
    );
    logger.info({ id, fields: Object.keys(patch) }, "outreach_brand updated");
    revalidatePath("/brands");
    revalidatePath(`/brands/outreach/${id}`);
    return { ok: true, data: { id } };
  } catch (err) {
    return wrapDbError(err, "update outreach brand");
  }
}

export async function archiveOutreachBrand(id: string): Promise<void> {
  const { staff } = await requireStaff();
  await withAuditContext(staff.id, async (tx) =>
    tx
      .update(outreachBrands)
      .set({ archivedAt: new Date(), status: "retired" })
      .where(eq(outreachBrands.id, id)),
  );
  logger.info({ id }, "outreach_brand archived");
  revalidatePath("/brands");
  redirect("/brands");
}

// =========================================================================
// CrawlBrand actions
// =========================================================================

export async function createCrawlBrand(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string; slug: string }>> {
  const { staff } = await requireStaff();

  const parsed = crawlBrandCreateSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const input: CrawlBrandCreateInput = parsed.data;

  const tokenResult = encryptOptionalSecret(input.eventbriteApiToken);
  if (!tokenResult.ok) return { ok: false, error: tokenResult.error };

  try {
    const [row] = await withAuditContext(staff.id, async (tx) =>
      tx
        .insert(crawlBrands)
        .values({
          slug: input.slug,
          displayName: input.displayName,
          holidayType: input.holidayType,
          geography: input.geography,
          publicDomain: input.publicDomain ?? null,
          primaryColorHex: input.primaryColorHex ?? null,
          accentColorHex: input.accentColorHex ?? null,
          tagline: input.tagline ?? null,
          publicFooterText: input.publicFooterText ?? null,
          eventbriteOrganizationId: input.eventbriteOrganizationId ?? null,
          eventbriteApiToken: tokenResult.value ?? null,
          defaultOutreachBrandId: input.defaultOutreachBrandId ?? null,
          publicAssetsEnabled: input.publicAssetsEnabled,
          templateVersion: input.templateVersion,
          status: input.status,
        })
        .returning({ id: crawlBrands.id, slug: crawlBrands.slug }),
    );

    if (!row) {
      return { ok: false, error: "Insert returned no row." };
    }

    logger.info({ id: row.id, slug: row.slug }, "crawl_brand created");
    revalidatePath("/brands");
    revalidatePath("/");
    return { ok: true, data: row };
  } catch (err) {
    return wrapDbError(err, "create crawl brand");
  }
}

export async function updateCrawlBrand(
  id: string,
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();

  const parsed = crawlBrandUpdateSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const input = parsed.data;

  const tokenResult = encryptOptionalSecret(input.eventbriteApiToken);
  if (!tokenResult.ok) return { ok: false, error: tokenResult.error };

  const patch: Partial<typeof crawlBrands.$inferInsert> = {};
  if (input.slug !== undefined) patch.slug = input.slug;
  if (input.displayName !== undefined) patch.displayName = input.displayName;
  if (input.holidayType !== undefined) patch.holidayType = input.holidayType;
  if (input.geography !== undefined) patch.geography = input.geography;
  if (input.publicDomain !== undefined) patch.publicDomain = input.publicDomain ?? null;
  if (input.primaryColorHex !== undefined) patch.primaryColorHex = input.primaryColorHex ?? null;
  if (input.accentColorHex !== undefined) patch.accentColorHex = input.accentColorHex ?? null;
  if (input.tagline !== undefined) patch.tagline = input.tagline ?? null;
  if (input.publicFooterText !== undefined) patch.publicFooterText = input.publicFooterText ?? null;
  if (input.eventbriteOrganizationId !== undefined)
    patch.eventbriteOrganizationId = input.eventbriteOrganizationId ?? null;
  if (tokenResult.value !== undefined) patch.eventbriteApiToken = tokenResult.value;
  if (input.defaultOutreachBrandId !== undefined)
    patch.defaultOutreachBrandId = input.defaultOutreachBrandId ?? null;
  if (input.publicAssetsEnabled !== undefined)
    patch.publicAssetsEnabled = input.publicAssetsEnabled;
  if (input.templateVersion !== undefined) patch.templateVersion = input.templateVersion;
  if (input.status !== undefined) patch.status = input.status;

  if (Object.keys(patch).length === 0) {
    return { ok: true, data: { id } };
  }

  try {
    await withAuditContext(staff.id, async (tx) =>
      tx.update(crawlBrands).set(patch).where(eq(crawlBrands.id, id)),
    );
    logger.info({ id, fields: Object.keys(patch) }, "crawl_brand updated");
    revalidatePath("/brands");
    revalidatePath(`/brands/crawl/${id}`);
    return { ok: true, data: { id } };
  } catch (err) {
    return wrapDbError(err, "update crawl brand");
  }
}

export async function archiveCrawlBrand(id: string): Promise<void> {
  const { staff } = await requireStaff();
  await withAuditContext(staff.id, async (tx) =>
    tx
      .update(crawlBrands)
      .set({ archivedAt: new Date(), status: "retired" })
      .where(eq(crawlBrands.id, id)),
  );
  logger.info({ id }, "crawl_brand archived");
  revalidatePath("/brands");
  redirect("/brands");
}

// =========================================================================
// Error handling
// =========================================================================

function wrapDbError(err: unknown, operation: string): ActionResult<never> {
  // Postgres errors have a `code` field for SQLSTATE.
  const e = err as { code?: string; message?: string; constraint?: string };
  if (e.code === "23505") {
    // unique_violation
    return {
      ok: false,
      error: `Conflict: that ${e.constraint ?? "value"} is already in use.`,
    };
  }
  if (e.code === "23503") {
    // foreign_key_violation
    return {
      ok: false,
      error: "Cannot complete operation: referenced record not found.",
    };
  }
  logger.error({ err }, `${operation} failed`);
  return {
    ok: false,
    error: `Failed to ${operation}. See server logs.`,
  };
}
