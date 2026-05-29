/**
 * invite-token helpers — issue, hash, and consume single-use invite
 * and password-reset tokens.
 *
 * Raw tokens are 32 random bytes encoded as URL-safe base64 (43
 * chars). Only the SHA-256 hash is stored; the raw token only
 * exists in:
 *   - the response of issueInviteToken/issueResetToken (so the caller
 *     can build the email link)
 *   - the email body
 *   - the URL the user clicks
 *
 * After acceptance the row is marked accepted_at + accepted_by_user_id
 * and consumeToken() will reject it. The /set-password page does an
 * atomic "lookup hash + check expiry + check not accepted + mark
 * accepted" so the same link can't be raced.
 */

import { createHash, randomBytes } from "node:crypto";

const TOKEN_BYTES = 32;
const INVITE_TTL_DAYS = 7;
const RESET_TTL_MINUTES = 60;

/** Generate a raw token + its hash. The raw value is what goes in the email. */
export function generateToken(): { raw: string; hash: string } {
  const raw = randomBytes(TOKEN_BYTES).toString("base64url");
  const hash = hashToken(raw);
  return { raw, hash };
}

/** Hash a token for DB storage / lookup. */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("base64url");
}

/** Default expiry for a new invite. */
export function inviteExpiresAt(): Date {
  return new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/** Default expiry for a password reset. */
export function resetExpiresAt(): Date {
  return new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000);
}
