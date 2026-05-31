"use client";

/**
 * Admin shell error boundary.
 *
 * Next.js renders this when any server component or render in
 * the (admin) tree throws. Without it, the user sees Next's
 * default white "Application error" screen which exposes nothing
 * actionable.
 *
 * For developer-free operation, this boundary also offers:
 *   - The Next.js digest reference (always shown if present)
 *   - A "Copy for Claude" button that puts a diagnosis-ready blob
 *     on the clipboard. Paste it into a Claude chat alongside
 *     docs/CLAUDE_TROUBLESHOOTING.md and Claude can grep the
 *     server logs for the matching entry by digest.
 *
 * If the user keeps hitting the same error, the "Back to dashboard"
 * action gives them a way out without learning the URL structure.
 */

import { maybeReloadForChunkError } from "@/lib/chunk-reload";
import { AlertTriangle, ClipboardCopy, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // A stale code-split chunk after a deploy lands here; reload once
    // to pull the current build instead of showing the error card.
    if (maybeReloadForChunkError(error)) return;
    // Log the digest to the browser console for the operator to
    // share with support. The actual stack stays server-side in
    // Next's logs — we never leak it to the UI.
    // eslint-disable-next-line no-console
    console.error("Admin shell caught a render error", {
      message: error.message,
      digest: error.digest,
    });
  }, [error]);

  async function copyForClaude() {
    const url =
      typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : "";
    const time = new Date().toISOString();
    const blob = [
      `Next.js digest: ${error.digest ?? "(no digest)"}`,
      `Message: ${error.message}`,
      `URL: ${url}`,
      `Time: ${time}`,
      "",
      "Please diagnose this for me. Grep the PM2 logs for the Next.js digest to find the matching server-side stack trace. See docs/CLAUDE_TROUBLESHOOTING.md in the repo for the codebase tour.",
    ].join("\n");
    try {
      await navigator.clipboard.writeText(blob);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Best-effort fallback
      try {
        const ta = document.createElement("textarea");
        ta.value = blob;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      } catch {
        // Operator can still read the digest off the screen.
      }
    }
  }

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
              The page hit an error mid-render. You can try again, head back to the dashboard, or
              copy the diagnostic info and paste it into Claude / Claude Code.
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
          <button
            type="button"
            onClick={copyForClaude}
            className="inline-flex items-center gap-1.5 rounded-md border border-violet-200 bg-violet-50/40 px-3 py-1.5 font-medium text-violet-800 text-xs hover:bg-violet-100/60 dark:border-violet-900/40 dark:bg-violet-950/30 dark:text-violet-200 dark:hover:bg-violet-950/50"
            title="Copy a Claude-ready diagnostic blob to your clipboard"
          >
            <ClipboardCopy className="h-3 w-3" />
            {copied ? "Copied" : "Copy for Claude"}
          </button>
        </div>
      </div>
    </div>
  );
}
