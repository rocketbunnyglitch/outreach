import "server-only";

import { logger } from "./logger";
import { getRedis } from "./redis";

/**
 * Brute-force throttle for the password sign-in path.
 *
 * The /login form has no rate limit by itself, so a stolen email +
 * dictionary could grind passwords as fast as the DB will answer. This
 * adds a Redis-backed sliding counter keyed by the *normalized email*:
 *
 *   - Each failed attempt increments login:fail:<email> with a TTL.
 *   - Once the count crosses MAX_ATTEMPTS the account is locked out for
 *     the remainder of the window — sign-in is refused before bcrypt
 *     even runs, so a locked account costs the attacker nothing to keep
 *     hammering and gains them nothing.
 *   - A successful sign-in clears the counter.
 *
 * Keyed by email (not IP) on purpose: this is a ~6-seat internal tool
 * behind a single egress, so an IP key would lock the whole team out
 * together. Email keying contains the lockout to the targeted account.
 *
 * Fails OPEN: if Redis is unreachable we allow the attempt rather than
 * lock everyone out of the admin during a Redis blip. Brute-force
 * protection is defense-in-depth here, not the only control.
 */

const MAX_ATTEMPTS = 8;
const WINDOW_SECONDS = 15 * 60; // 15 minutes

function key(email: string): string {
  return `login:fail:${email.trim().toLowerCase()}`;
}

export interface ThrottleState {
  locked: boolean;
  retryAfterSeconds: number;
}

/**
 * Check whether this email is currently locked out. Call BEFORE
 * attempting authentication.
 */
export async function checkLoginThrottle(email: string): Promise<ThrottleState> {
  try {
    const client = getRedis();
    const k = key(email);
    const raw = await client.get(k);
    const count = raw ? Number.parseInt(raw, 10) : 0;
    if (count >= MAX_ATTEMPTS) {
      const ttl = await client.ttl(k);
      return { locked: true, retryAfterSeconds: ttl > 0 ? ttl : WINDOW_SECONDS };
    }
    return { locked: false, retryAfterSeconds: 0 };
  } catch (err) {
    logger.warn({ err }, "login throttle check failed; failing open");
    return { locked: false, retryAfterSeconds: 0 };
  }
}

/** Record a failed sign-in attempt and (re)arm the window TTL. */
export async function recordLoginFailure(email: string): Promise<void> {
  try {
    const client = getRedis();
    const k = key(email);
    const count = await client.incr(k);
    // Set/refresh expiry only on the first failure of a window so the
    // lockout doesn't slide forever under a sustained attack.
    if (count === 1) {
      await client.expire(k, WINDOW_SECONDS);
    }
  } catch (err) {
    logger.warn({ err }, "login throttle increment failed");
  }
}

/** Clear the failure counter after a successful sign-in. */
export async function clearLoginFailures(email: string): Promise<void> {
  try {
    await getRedis().del(key(email));
  } catch (err) {
    logger.warn({ err }, "login throttle clear failed");
  }
}
