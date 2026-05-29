/**
 * impersonation-cookie.ts — admin-only impersonation grant cookie.
 *
 * The /admin/users page (commit 5) lets an admin click "Impersonate"
 * on a target user. That action signs a short-lived grant and sets
 * it as an httpOnly cookie; the user is then redirected through
 * /api/auth/signin/admin-impersonate, which triggers the
 * `admin-impersonate` Credentials provider in auth.ts.
 *
 * Cookie payload (JSON, then base64url):
 *   {
 *     targetUserId: string,
 *     grantedByUserId: string,
 *     expiresAt: number  // unix ms
 *   }
 * Cookie value: `<payload_b64>.<hmac_b64>` where the HMAC is computed
 * over the payload using NEXTAUTH_SECRET.
 *
 * Verification refuses if:
 *   - cookie missing
 *   - signature mismatch
 *   - expired
 *
 * The grant is intentionally single-use-ish: maxAge is 60 seconds so
 * the cookie disappears quickly even if the admin-impersonate sign-in
 * fails. The action that sets the cookie should also clear it after a
 * successful sign-in if it can — but expiry is the primary safety net.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "./env";

const COOKIE_NAME = "impersonate_grant";
/** 60 seconds — long enough to redirect, short enough to fail closed. */
const GRANT_TTL_MS = 60 * 1000;

interface Payload {
  targetUserId: string;
  grantedByUserId: string;
  expiresAt: number;
}

function sign(payload: string): string {
  const secret = env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is required to sign impersonation grants");
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/**
 * Issue a grant cookie and return the cookie name + value so the caller
 * can set it on the response. (We don't set it here directly so the
 * caller controls the response context — Server Action vs API route etc.)
 */
export function issueImpersonationGrant(opts: {
  targetUserId: string;
  grantedByUserId: string;
}): { name: string; value: string; maxAgeSeconds: number } {
  const payload: Payload = {
    targetUserId: opts.targetUserId,
    grantedByUserId: opts.grantedByUserId,
    expiresAt: Date.now() + GRANT_TTL_MS,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = sign(payloadB64);
  return {
    name: COOKIE_NAME,
    value: `${payloadB64}.${sig}`,
    maxAgeSeconds: Math.floor(GRANT_TTL_MS / 1000),
  };
}

/**
 * Verify the impersonation grant cookie from the current request.
 * Returns the decoded payload on success or null on any failure
 * (missing / malformed / bad signature / expired).
 */
export async function verifyImpersonationGrant(): Promise<Payload | null> {
  let raw: string | undefined;
  try {
    const jar = await cookies();
    raw = jar.get(COOKIE_NAME)?.value;
  } catch {
    return null;
  }
  if (!raw) return null;

  const dot = raw.indexOf(".");
  if (dot < 0) return null;
  const payloadB64 = raw.slice(0, dot);
  const sigB64 = raw.slice(dot + 1);
  if (!payloadB64 || !sigB64) return null;

  let expected: string;
  try {
    expected = sign(payloadB64);
  } catch {
    return null;
  }
  // Constant-time signature comparison.
  const a = Buffer.from(sigB64, "base64url");
  const b = Buffer.from(expected, "base64url");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (
    typeof payload.targetUserId !== "string" ||
    typeof payload.grantedByUserId !== "string" ||
    typeof payload.expiresAt !== "number"
  ) {
    return null;
  }
  if (Date.now() > payload.expiresAt) return null;
  return payload;
}

/** Convenience: tells callers the cookie name so they can clear it. */
export const IMPERSONATION_COOKIE_NAME = COOKIE_NAME;
