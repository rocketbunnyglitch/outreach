/**
 * digest-unsub-token.ts -- HMAC-signed unsubscribe tokens for the
 * daily-digest email "Stop these emails" link.
 *
 * Why a token (instead of just /me/preferences?unsub=1):
 *
 *   - The login wall on /me/preferences requires an active session.
 *     An operator who's been getting daily digests but hasn't logged
 *     in this week can't easily opt out without a roundtrip through
 *     auth. Anti-pattern.
 *
 *   - "One-click unsubscribe" is a deliverability signal -- inboxes
 *     (Gmail, Outlook) reward senders whose recipients can opt out
 *     without bouncing or marking as spam. A signed URL gives them
 *     that one click.
 *
 *   - We don't want to expose the raw userId in URLs (that's a PII
 *     leak in browser history + email forwarding paths). The HMAC
 *     wraps it so the URL is opaque to anyone other than the server
 *     that signed it.
 *
 * Token shape (URL-safe):
 *
 *   <payload_b64>.<sig_b64>
 *
 * Where payload is the JSON `{ userId, issuedAt }` and sig is
 * HMAC-SHA256(payload_b64, NEXTAUTH_SECRET) base64url-encoded.
 *
 * Verification refuses on:
 *   - Malformed token
 *   - Signature mismatch (timing-safe compare)
 *   - Issued more than UNSUB_TOKEN_MAX_AGE_MS ago. The default of 90
 *     days lets an operator who got a digest two months back still
 *     opt out, but eventually the token expires so a leaked
 *     screenshot or forwarded email can't be used indefinitely.
 *
 * Mirrors the impersonation-cookie pattern (same NEXTAUTH_SECRET,
 * same encoding, same timingSafeEqual) -- if that pattern is good
 * enough for impersonation grants, it's plenty for digest opt-out.
 *
 * Forge-resistance:
 *   - An attacker who can forge a valid token can unsubscribe
 *     someone from their own digest. Threat model: minor annoyance,
 *     not a security incident -- the operator can re-enable from
 *     /me/preferences. Acceptable for the deliverability win.
 */

import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

interface Payload {
  /** users.id whose dailyDigestEnabled should flip to false. */
  userId: string;
  /** Unix ms when the token was generated. Used for max-age expiry. */
  issuedAt: number;
}

/** 90 days. Long enough for back-of-stack emails, short enough that
 *  leaked tokens eventually rot. */
const UNSUB_TOKEN_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

function sign(payloadB64: string): string {
  const secret = env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is required to sign unsubscribe tokens");
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

/**
 * Generate a one-click unsubscribe token for `userId`. Output is
 * URL-safe; embed directly in the digest email's Stop link.
 */
export function signUnsubToken(userId: string): string {
  const payload: Payload = { userId, issuedAt: Date.now() };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = sign(payloadB64);
  return `${payloadB64}.${sig}`;
}

/**
 * Verify a token from the digest URL. Returns the userId on success
 * or null on any failure (malformed, bad signature, expired). NEVER
 * returns partial info -- the caller gets a userId-or-nothing
 * answer.
 *
 * Uses timingSafeEqual so a leaking-via-timing attack on the
 * signature comparison doesn't help anyone.
 */
export function verifyUnsubToken(token: string): { userId: string } | null {
  if (typeof token !== "string" || token.length === 0) return null;
  const idx = token.lastIndexOf(".");
  if (idx <= 0 || idx >= token.length - 1) return null;

  const payloadB64 = token.slice(0, idx);
  const givenSig = token.slice(idx + 1);
  const expectedSig = sign(payloadB64);

  // timingSafeEqual throws on length mismatch, so guard first.
  const a = Buffer.from(givenSig, "utf8");
  const b = Buffer.from(expectedSig, "utf8");
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  let parsed: Payload;
  try {
    parsed = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as Payload;
  } catch {
    return null;
  }
  if (typeof parsed.userId !== "string" || !parsed.userId) return null;
  if (typeof parsed.issuedAt !== "number") return null;
  if (Date.now() - parsed.issuedAt > UNSUB_TOKEN_MAX_AGE_MS) return null;

  return { userId: parsed.userId };
}
