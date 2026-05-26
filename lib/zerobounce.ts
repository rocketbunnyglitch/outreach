import "server-only";

/**
 * ZeroBounce client + caching layer.
 *
 * Validates email addresses against ZeroBounce and caches results in
 * the email_validations table. Re-validation policy: skip if the cached
 * row is < 90 days old.
 *
 * Activation:
 *   Set ZEROBOUNCE_API_KEY in the server env. Without it, this module
 *   no-ops gracefully — venues with emails are saved as usual, just
 *   without a validation status until the key is added.
 *
 * Rate limits:
 *   ZeroBounce free tier = 100 credits. Hit-rate matters; the 90-day
 *   cache keeps us under the limit for a normal-volume operator.
 *
 * Spec references:
 *   - emailValidationStatus enum: valid | invalid | catch_all | unknown
 *     | spamtrap | abuse | do_not_mail
 *   - Re-validation window: 90 days (DECISIONS.md §6.6)
 */

import { emailValidations } from "@/db/schema";
import { db, withAuditContext } from "@/lib/db";
import { logger } from "@/lib/logger";
import { eq } from "drizzle-orm";

const REVALIDATE_AFTER_DAYS = 90;
const ZB_ENDPOINT = "https://api.zerobounce.net/v2/validate";

export type EmailValidationStatus =
  | "valid"
  | "invalid"
  | "catch_all"
  | "unknown"
  | "spamtrap"
  | "abuse"
  | "do_not_mail";

/**
 * Run-or-skip: validates the email via ZeroBounce if not cached or if
 * the cache is stale. Returns the validation row state (cached or
 * freshly validated).
 *
 * Returns null when:
 *   - ZEROBOUNCE_API_KEY isn't configured (graceful no-op)
 *   - The email is obviously malformed (no @)
 *   - The ZeroBounce API call fails (logged, swallowed)
 *
 * Safe to call from any write path — fire-and-forget pattern works,
 * the caller doesn't need to await the result if they just want the
 * cache populated.
 */
export async function validateEmail(
  rawEmail: string,
  staffMemberId?: string,
): Promise<{ status: EmailValidationStatus; cached: boolean } | null> {
  const apiKey = process.env.ZEROBOUNCE_API_KEY;
  if (!apiKey) return null;

  const email = rawEmail.trim().toLowerCase();
  if (!email || !email.includes("@")) return null;

  // Cache hit + still fresh?
  const cached = await db
    .select({
      status: emailValidations.status,
      validatedAt: emailValidations.validatedAt,
    })
    .from(emailValidations)
    .where(eq(emailValidations.email, email))
    .limit(1)
    .then((r) => r[0]);

  if (cached) {
    const ageMs = Date.now() - cached.validatedAt.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays < REVALIDATE_AFTER_DAYS) {
      return { status: cached.status as EmailValidationStatus, cached: true };
    }
  }

  // Hit the API
  let zbResult: { status: EmailValidationStatus; raw: Record<string, unknown> } | null = null;
  try {
    const url = `${ZB_ENDPOINT}?api_key=${encodeURIComponent(apiKey)}&email=${encodeURIComponent(email)}`;
    const response = await fetch(url, {
      method: "GET",
      // Don't cache at the fetch layer — we control caching via the DB.
      cache: "no-store",
      // Tight timeout — operator UI should never be blocked > 5s on this
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      throw new Error(`ZeroBounce returned ${response.status}`);
    }
    const raw = (await response.json()) as Record<string, unknown>;
    // ZeroBounce's "status" field maps to our enum almost 1:1
    //   valid | invalid | catch-all | unknown | spamtrap | abuse | do_not_mail
    // We just normalize the hyphen.
    const rawStatus = String(raw.status ?? "unknown").replace("-", "_");
    const status: EmailValidationStatus = (
      [
        "valid",
        "invalid",
        "catch_all",
        "unknown",
        "spamtrap",
        "abuse",
        "do_not_mail",
      ] as EmailValidationStatus[]
    ).includes(rawStatus as EmailValidationStatus)
      ? (rawStatus as EmailValidationStatus)
      : "unknown";
    zbResult = { status, raw };
  } catch (err) {
    logger.warn({ err, email: maskEmail(email) }, "zerobounce validation failed");
    return null;
  }

  // Upsert into cache
  try {
    if (staffMemberId) {
      await withAuditContext(staffMemberId, async (tx) => {
        await tx
          .insert(emailValidations)
          .values({
            email,
            status: zbResult.status,
            rawResponse: zbResult.raw,
            createdBy: staffMemberId,
            updatedBy: staffMemberId,
          })
          .onConflictDoUpdate({
            target: emailValidations.email,
            set: {
              status: zbResult.status,
              rawResponse: zbResult.raw,
              validatedAt: new Date(),
              updatedBy: staffMemberId,
            },
          });
      });
    } else {
      await db
        .insert(emailValidations)
        .values({
          email,
          status: zbResult.status,
          rawResponse: zbResult.raw,
        })
        .onConflictDoUpdate({
          target: emailValidations.email,
          set: {
            status: zbResult.status,
            rawResponse: zbResult.raw,
            validatedAt: new Date(),
          },
        });
    }
  } catch (err) {
    logger.error({ err, email: maskEmail(email) }, "zerobounce cache write failed");
  }

  return { status: zbResult.status, cached: false };
}

/**
 * Fire-and-forget wrapper for write paths. Spawn the validation in the
 * background so the user's save action returns immediately, then the
 * cache fills + re-renders show the pill on next page load.
 *
 * Avoids holding open the request thread during a 1-3s ZeroBounce call.
 */
export function validateEmailInBackground(
  rawEmail: string | null | undefined,
  staffMemberId?: string,
): void {
  if (!rawEmail) return;
  // Top-level Promise — no await. setImmediate isn't ideal in Next/Edge,
  // but we're server-only here so a bare promise + .catch is fine.
  validateEmail(rawEmail, staffMemberId).catch((err) => {
    logger.error({ err }, "background email validation failed");
  });
}

export function isZeroBounceConfigured(): boolean {
  return !!process.env.ZEROBOUNCE_API_KEY;
}

/** Returns the latest cached status without calling the API. */
export async function getCachedValidation(rawEmail: string): Promise<EmailValidationStatus | null> {
  const email = rawEmail.trim().toLowerCase();
  if (!email) return null;
  const cached = await db
    .select({ status: emailValidations.status })
    .from(emailValidations)
    .where(eq(emailValidations.email, email))
    .limit(1)
    .then((r) => r[0]);
  return cached ? (cached.status as EmailValidationStatus) : null;
}

/**
 * Bulk validate — used by /admin batch jobs or the warm-up runner.
 * Loops one-by-one to respect the cached-skip path; ZeroBounce charges
 * per validated lookup.
 */
export async function validateEmailsBatch(
  emails: string[],
  staffMemberId?: string,
): Promise<{ validated: number; cached: number; skipped: number }> {
  let validated = 0;
  let cached = 0;
  let skipped = 0;
  for (const email of emails) {
    const result = await validateEmail(email, staffMemberId);
    if (!result) skipped++;
    else if (result.cached) cached++;
    else validated++;
  }
  return { validated, cached, skipped };
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "<malformed>";
  return `${local.charAt(0)}***@${domain}`;
}
