"use server";

/**
 * Server actions backing the /login page.
 *
 * Single sign-in path: email + password. Calls the "password" Credentials
 * provider configured in auth.ts. signIn() throws a NEXT_REDIRECT on
 * success (handled by isRedirectError below) or returns null/throws
 * AuthError on failure.
 */

import { signIn } from "@/auth";
import { logger } from "@/lib/logger";
import { isRedirectError } from "next/dist/client/components/redirect-error";

export interface SignInResult {
  ok: boolean;
  error?: string;
}

export async function signInWithPassword(
  _prev: unknown,
  formData: FormData,
): Promise<SignInResult> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const from = String(formData.get("from") ?? "/").trim() || "/";

  if (!email || !password) {
    return { ok: false, error: "Email and password are required." };
  }

  try {
    await signIn("password", {
      email,
      password,
      redirectTo: from,
    });
    // signIn throws a redirect on success — never reached.
    return { ok: true };
  } catch (err) {
    // Next.js redirect errors are how `signIn` signals success.
    if (isRedirectError(err)) throw err;

    // AuthError from NextAuth bubbles up as a generic Error here; the
    // authorize() function returns null on bad creds so we don't get a
    // specific reason. That's intentional — we don't want to leak
    // "user exists but password wrong" vs "no such user".
    logger.warn({ email }, "password sign-in failed");
    return {
      ok: false,
      error: "Invalid email or password. Try again or contact an admin.",
    };
  }
}
