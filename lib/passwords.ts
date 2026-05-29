/**
 * Password hashing helpers — wraps bcryptjs with sane defaults.
 *
 * Why bcryptjs (pure-JS) over bcrypt (native): native bcrypt fails to
 * install on platforms with mismatched glibc / missing build tools,
 * which we've hit in deploy CI before. The pure-JS implementation is
 * a hair slower but the throughput difference is irrelevant at a few
 * sign-ins/sec; pick deploy simplicity.
 *
 * Cost factor 12 = ~250ms per hash on a modern x86. Adjust if logins
 * feel sluggish on the target server.
 */

import { compare, hash } from "bcryptjs";

const BCRYPT_COST = 12;

/** Minimum acceptable password length for new passwords. */
export const MIN_PASSWORD_LENGTH = 10;

export interface PasswordValidationError {
  ok: false;
  error: string;
}

export interface PasswordValidationOk {
  ok: true;
}

export function validatePassword(pw: string): PasswordValidationOk | PasswordValidationError {
  if (typeof pw !== "string") return { ok: false, error: "Password is required." };
  if (pw.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (pw.length > 200) {
    return { ok: false, error: "Password is too long (200 character max)." };
  }
  return { ok: true };
}

export function hashPassword(pw: string): Promise<string> {
  return hash(pw, BCRYPT_COST);
}

export function verifyPassword(pw: string, hashed: string): Promise<boolean> {
  return compare(pw, hashed);
}
