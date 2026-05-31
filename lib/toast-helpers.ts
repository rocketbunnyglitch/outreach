"use client";

/**
 * showActionError — small wrapper around the toast API for the
 * common pattern:
 *
 *   if (!result.ok) {
 *     showActionError(toast, result, { fallback: "Status update failed." });
 *     return;
 *   }
 *
 * Pulls the message + code + tag off the ActionResult and hands
 * them to the toast. The toast renders the "Copy for Claude"
 * button automatically when there's a code attached.
 *
 * Why this exists: every server action call site has the same
 * three lines to surface an error. This helper consolidates the
 * fallback message + code propagation into one call so callers
 * never forget to pass the code through.
 */

import type { useToast } from "@/components/ui/toast";

interface ActionFailure {
  ok: false;
  error: string;
  code?: string;
  fieldErrors?: Record<string, string[]>;
}

interface Opts {
  /** Fallback message when result.error is empty. */
  fallback?: string;
  /** Optional short tag identifying which action this is — written
   *  into the clipboard blob so Claude knows which file to look
   *  at. e.g. "cold_outreach.bulk_archive". When the server
   *  attached its own code, the tag isn't strictly necessary
   *  (the server log line already has it), but it makes the
   *  client-side blob more self-describing. */
  tag?: string;
}

type ToastApi = ReturnType<typeof useToast>;

export function showActionError(toast: ToastApi, result: ActionFailure, opts: Opts = {}): void {
  toast.show({
    kind: "error",
    message: result.error || opts.fallback || "Something went wrong.",
    code: result.code,
    tag: opts.tag,
  });
}
