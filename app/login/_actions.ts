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
import { checkLoginThrottle, clearLoginFailures, recordLoginFailure } from "@/lib/login-throttle";
import { isRedirectError } from "next/dist/client/components/redirect-error";

export interface SignInResult {
  ok: boolean;
  error?: string;
}

/**
 * Constrain the post-login redirect to a same-site, absolute path.
 *
 * `from` arrives from the login URL's query string, fully attacker-
 * controllable. Passing it to signIn's redirectTo unchecked is a classic
 * open redirect: `/login?from=https://evil.example` (or the protocol-
 * relative `//evil.example`, or a backslash variant browsers normalize to
 * `//`) would bounce an authenticated user off-site. Only allow a path
 * that starts with a single forward slash.
 */
function safeRedirect(raw: string): string {
  const v = raw.trim();
  if (!v.startsWith("/")) return "/";
  // Reject protocol-relative (`//host`) and backslash tricks (`/\host`,
  // which several browsers treat as `//host`), plus their encoded forms.
  if (v.startsWith("//") || v.startsWith("/\\") || v.startsWith("/%2f") || v.startsWith("/%5c")) {
    return "/";
  }
  return v;
}

export async function signInWithPassword(
  _prev: unknown,
  formData: FormData,
): Promise<SignInResult> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const from = safeRedirect(String(formData.get("from") ?? "/") || "/");

  if (!email || !password) {
    return { ok: false, error: "Email and password are required." };
  }

  // Brute-force throttle: refuse before touching bcrypt once an account
  // has too many recent failures.
  const throttle = await checkLoginThrottle(email);
  if (throttle.locked) {
    const minutes = Math.max(1, Math.ceil(throttle.retryAfterSeconds / 60));
    logger.warn({ email }, "password sign-in blocked by throttle");
    return {
      ok: false,
      error: `Too many failed attempts. Try again in about ${minutes} minute${
        minutes === 1 ? "" : "s"
      }, or contact an admin.`,
    };
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
    if (isRedirectError(err)) {
      // Successful sign-in: clear the failure counter for this account.
      await clearLoginFailures(email);
      throw err;
    }

    // AuthError from NextAuth bubbles up as a generic Error here; the
    // authorize() function returns null on bad creds so we don't get a
    // specific reason. That's intentional — we don't want to leak
    // "user exists but password wrong" vs "no such user".
    await recordLoginFailure(email);
    logger.warn({ email }, "password sign-in failed");
    return {
      ok: false,
      error: "Invalid email or password. Try again or contact an admin.",
    };
  }
}
