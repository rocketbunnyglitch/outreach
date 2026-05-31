"use client";

/**
 * Admin shell error boundary.
 *
 * Next.js renders this when any server component or render in
 * the (admin) tree throws. Without it, the user sees Next's
 * default white "Application error" screen which exposes nothing
 * actionable.
 *
 * The boundary:
 *   - Renders a friendly recoverable card
 *   - Logs the digest server-side via the existing logger
 *     (the digest is the only crumb Next exposes from the
 *     server side without leaking internals)
 *   - Offers a "Try again" button (Next-provided `reset`) and
 *     a "Back to dashboard" escape hatch
 *
 * If the user keeps hitting the same error, the second action
 * gives them a way out without learning the URL structure.
 */

import { AlertTriangle, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the digest to the browser console for the operator to
    // share with support. The actual stack stays server-side in
    // Next's logs — we never leak it to the UI.
    // eslint-disable-next-line no-console
    console.error("Admin shell caught a render error", {
      message: error.message,
      digest: error.digest,
    });
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6 py-12">
      <div className="w-full max-w-md rounded-xl border border-rose-200 bg-white p-6 shadow-sm dark:border-rose-900/40 dark:bg-zinc-950">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-950/40">
            <AlertTriangle
              className="h-5 w-5 text-rose-600 dark:text-rose-400"
              aria-hidden="true"
            />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-base text-zinc-900 tracking-tight dark:text-zinc-100">
              Something went wrong rendering this page
            </h2>
            <p className="mt-1 text-sm text-zinc-600 leading-relaxed dark:text-zinc-400">
              The page hit an error mid-render. The team has been notified. You can try again, or
              head back to the dashboard.
            </p>
            {error.digest && (
              <p className="mt-2 font-mono text-[10px] text-zinc-400 uppercase tracking-widest dark:text-zinc-500">
                ref: {error.digest}
              </p>
            )}
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white text-xs hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            <RefreshCw className="h-3 w-3" />
            Try again
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-3 py-1.5 font-medium text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
