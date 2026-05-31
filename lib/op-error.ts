import "server-only";

/**
 * Operator error codes — short, copy-pasteable identifiers that
 * bridge a user-facing toast / error message and the structured
 * log line that explains what actually happened.
 *
 * Why this exists
 * ---------------
 * The app has 200+ try/catch blocks across server actions. When
 * the catch fires, the operator typically sees a generic message
 * like "Save failed." — friendly but not diagnostic. Finding the
 * matching log line means SSH-ing in + grepping PM2 logs by
 * approximate timestamp, which is friction for a solo operator
 * who wants Claude or Claude Code to triage the bug.
 *
 * This module gives every error a short code like "E-2K9P-7F3M":
 *   - shown in the toast / error UI right next to the message
 *   - logged with the structured error context (stack, params,
 *     staffId, action name, URL)
 *   - reads back in a single grep: `pm2 logs | grep E-2K9P-7F3M`
 *   - safe to share with Claude — no secrets, no internals
 *
 * The code does NOT encode the error. It's a random identifier
 * that ties one user-visible event to one server-side log line.
 * To debug, you take the code from the UI, grep the logs for it,
 * and paste the matching log entry into Claude.
 *
 * Format
 * ------
 *   E-XXXX-YYYY
 *     - E         literal "E" prefix so codes are recognizable
 *     - XXXX      timestamp slice (4 base36 chars, ~60 mins of
 *                  resolution — enough to roughly bucket "when"
 *                  without parsing)
 *     - YYYY      4 random base36 chars from crypto
 *   Total: 11 chars including dashes.
 *
 * Collisions: 36^4 ≈ 1.7M per hour. Even at 10 errors/sec the
 * collision probability is negligible.
 *
 * Usage
 * -----
 *   const { code, log } = newOpError("inbox.send_reply");
 *   try {
 *     ...
 *   } catch (err) {
 *     log(err, { threadId, draftId });
 *     return { ok: false, error: "Couldn't send the reply.", code };
 *   }
 *
 * The `log` helper writes one structured `logger.error` line that
 * includes the code, the action tag, the original error (with
 * stack), and any extra context. That single line is everything
 * Claude needs to diagnose.
 */

import { logger } from "@/lib/logger";

const ALPHABET = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O for readability
const ALPHABET_LEN = ALPHABET.length;

function randomBase34(len: number): string {
  let out = "";
  // crypto.getRandomValues is available in Node 18+ and the browser;
  // server-only file so we don't need a browser fallback path.
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < len; i++) {
    out += ALPHABET[(bytes[i] ?? 0) % ALPHABET_LEN];
  }
  return out;
}

function timeBase34(): string {
  // Take the lower-order bits of the timestamp so the "time slice"
  // changes meaningfully within an hour (rather than being a full
  // unix-time encoding which is overkill). Resolution ~1 min.
  const minutes = Math.floor(Date.now() / 60_000);
  let n = minutes & 0xfffff; // 20 bits → 4 base34 chars
  let out = "";
  for (let i = 0; i < 4; i++) {
    out = (ALPHABET[n % ALPHABET_LEN] ?? "0") + out;
    n = Math.floor(n / ALPHABET_LEN);
  }
  return out;
}

/** Generate a new operator-facing error code. Pure — no logging. */
export function newErrorCode(): string {
  return `E-${timeBase34()}-${randomBase34(4)}`;
}

/**
 * Convenience: produces a code + a bound logger so the call site
 * looks like:
 *
 *   const op = newOpError("city_campaigns.upsertColdOutreachEntry");
 *   try {
 *     ...
 *   } catch (err) {
 *     op.log(err, { cityCampaignId, venueId });
 *     return { ok: false, error: "Couldn't add the venue.", code: op.code };
 *   }
 *
 * The single log line tagged with `op.code` is everything you need
 * to paste into Claude / Claude Code for a diagnosis.
 */
export interface OpError {
  /** The shareable code (`E-XXXX-YYYY`). */
  code: string;
  /**
   * Log this error. Includes the code + tag in the structured log
   * line so a single grep finds it. Pass any context that would
   * help a future debugger: ids, params, who triggered it.
   *
   * `err` can be anything caught — Error, unknown, string. The
   * underlying logger handles stringification + redaction.
   */
  log: (err: unknown, context?: Record<string, unknown>) => void;
}

export function newOpError(tag: string): OpError {
  const code = newErrorCode();
  return {
    code,
    log(err, context) {
      // One line, structured. Claude can read this directly.
      logger.error(
        {
          err,
          code,
          tag,
          ...context,
        },
        `[op-error ${code}] ${tag}`,
      );
    },
  };
}

/**
 * Format an error message + code for display together. The convention
 * across the UI:
 *
 *   "Couldn't send the reply. · E-2K9P-7F3M"
 *
 * Components that want a richer layout (e.g. a copy button) read the
 * code separately and lay it out themselves.
 */
export function formatErrorWithCode(message: string, code?: string | null): string {
  if (!code) return message;
  return `${message} · ${code}`;
}
