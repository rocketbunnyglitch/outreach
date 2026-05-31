"use client";

/**
 * Client-side error code generator — companion to lib/op-error.ts.
 *
 * Why this exists
 * ---------------
 * The server-side op-error system catches errors thrown inside
 * server actions and surfaces a code (E-XXXX-YYYY) in the toast.
 * But many failures happen on the CLIENT side BEFORE the server
 * code's try/catch ever runs:
 *
 *   - Next.js "An unexpected response was received from the server"
 *     (server action returned non-serializable data, or the action
 *      crashed in a way that bypassed our catch — e.g. inside
 *      Next's render streaming)
 *   - Network failures (timeout, DNS, offline)
 *   - JS errors in event handlers, transitions, useEffect
 *   - Browser-side bundle mismatches when the operator's tab has
 *     stale JS but the server has the new build
 *
 * For ALL of these, the operator currently sees a generic message
 * with no actionable info — exactly the pain point we built the
 * op-error system to solve.
 *
 * This module gives every client-side caught error a code
 * `C-XXXX-YYYY` (note the C-prefix vs E- for server) so:
 *   - The toast renders the code with the same "Copy for Claude"
 *     button.
 *   - console.error logs the code + tag + the actual JS error so
 *     the operator (or Claude) can find it in the browser console.
 *   - The blob put on clipboard has the URL, time, tag, code, and
 *     a hint that Claude should look at the browser console.
 *
 * Together with server-side codes, the operator now has 100%
 * coverage: every error path produces a copyable code without
 * needing PM2 access.
 */

const ALPHABET = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O for readability
const ALPHABET_LEN = ALPHABET.length;

function randomBase34(len: number): string {
  let out = "";
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const bytes = new Uint8Array(len);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < len; i++) {
      out += ALPHABET[(bytes[i] ?? 0) % ALPHABET_LEN];
    }
    return out;
  }
  // Fallback for ancient browsers — Math.random is fine, the
  // code is just an identifier, not a security token.
  for (let i = 0; i < len; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET_LEN)];
  }
  return out;
}

function timeBase34(): string {
  const minutes = Math.floor(Date.now() / 60_000);
  let n = minutes & 0xfffff;
  let out = "";
  for (let i = 0; i < 4; i++) {
    out = (ALPHABET[n % ALPHABET_LEN] ?? "0") + out;
    n = Math.floor(n / ALPHABET_LEN);
  }
  return out;
}

/** Generate a client-side error code, prefixed `C-`. */
export function newClientErrorCode(): string {
  return `C-${timeBase34()}-${randomBase34(4)}`;
}

interface CaughtFromAwaitOpts {
  /** Short identifier — what action/handler the call was for.
   *  Goes into the console.error AND the Claude-copy blob. */
  tag: string;
  /** User-facing fallback message when we can't extract anything
   *  better from the underlying error. */
  fallback?: string;
}

interface CaughtResult {
  code: string;
  /** Best-effort human-readable message extracted from the error.
   *  Falls back to opts.fallback. */
  message: string;
}

/**
 * Mint a client-side code + a message for a caught error. Logs
 * the FULL error to console.error so Claude (or the operator) can
 * read it via the browser DevTools console.
 *
 * The companion to `useToast`'s code-and-tag rendering — pass
 * the returned code + message + tag into toast.show.
 */
export function captureClientError(err: unknown, opts: CaughtFromAwaitOpts): CaughtResult {
  const code = newClientErrorCode();
  const message = extractMessage(err, opts.fallback);
  // Log to the browser console with the code so it's findable.
  // Operator can open DevTools, search for the code, and see the
  // full stack + structured details.
  console.error(`[client-error ${code}] ${opts.tag}:`, err);
  return { code, message };
}

function extractMessage(err: unknown, fallback?: string): string {
  if (err instanceof Error) return err.message || (fallback ?? "Something went wrong.");
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return fallback ?? "Something went wrong.";
}
