"use server";

/**
 * Server actions backing the /login page.
 *
 * Note: NextAuth provides client-side `signIn()` and a JSON API at
 * /api/auth/signin, but using server actions makes the form work without
 * any client JS for the credentials path and gives us a clean redirect
 * flow that respects the `from` query param.
 */

import { signIn } from "@/auth";
import { logger } from "@/lib/logger";
import { isRedirectError } from "next/dist/client/components/redirect-error";

interface SignInResult {
  ok: boolean;
  error?: string;
}

/**
 * Sign in via the dev impersonation credentials provider.
 * Only meaningful when NODE_ENV !== production (the provider is gated there
 * in auth.ts) — in production this will return an error.
 */
export async function signInAsStaff(_prev: unknown, formData: FormData): Promise<SignInResult> {
  const email = String(formData.get("email") ?? "").trim();
  const from = String(formData.get("from") ?? "/").trim() || "/";

  if (!email) {
    return { ok: false, error: "Email is required." };
  }

  try {
    await signIn("dev-staff-impersonate", {
      email,
      redirectTo: from,
    });
    // signIn throws a redirect on success, so we never reach here on success.
    return { ok: true };
  } catch (err) {
    // Next.js redirect errors are how `signIn` signals success — let them
    // propagate up to the framework.
    if (isRedirectError(err)) throw err;

    logger.warn({ email, err }, "dev impersonation sign-in failed");
    return {
      ok: false,
      error: "No active staff member with that email. Pick from the list of seeded staff.",
    };
  }
}

/**
 * Kicks off the Google OAuth flow. Returns a redirect.
 */
export async function signInWithGoogle(formData: FormData): Promise<void> {
  const from = String(formData.get("from") ?? "/").trim() || "/";
  await signIn("google", { redirectTo: from });
}
