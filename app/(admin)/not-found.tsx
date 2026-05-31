/**
 * Admin shell not-found surface.
 *
 * Renders when a server component calls `notFound()` or when a
 * URL deeper in the (admin) tree resolves to nothing. Next's
 * default 404 is a tiny black-and-white wedge — this gives
 * operators a recognizable, navigable card instead.
 */

import { FileQuestion } from "lucide-react";
import Link from "next/link";

export default function AdminNotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6 py-12">
      <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-900">
            <FileQuestion className="h-5 w-5 text-zinc-500" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-base text-zinc-900 tracking-tight dark:text-zinc-100">
              We couldn't find that page
            </h2>
            <p className="mt-1 text-sm text-zinc-600 leading-relaxed dark:text-zinc-400">
              The record might have been archived, the link could be wrong, or you may not have
              access. Try the Cmd+K palette to jump straight to what you're looking for.
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white text-xs hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Back to dashboard
          </Link>
          <Link
            href="/inbox"
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-3 py-1.5 font-medium text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Open inbox
          </Link>
        </div>
      </div>
    </div>
  );
}
