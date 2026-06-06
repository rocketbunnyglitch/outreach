/**
 * Gmail-style "N-M  < >" pager for the 50-per-page thread list. Server
 * component -- just two Links built from the preserved folder/filter
 * query (which never carries `page`, so switching folders resets to 1).
 */

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

export function InboxPagination({
  page,
  hasMore,
  pageSize,
  preservedQuery,
}: {
  page: number;
  hasMore: boolean;
  pageSize: number;
  /** Already carries folder + filters; must NOT contain `page`. */
  preservedQuery: string;
}) {
  // Single page -> nothing to page through.
  if (page <= 1 && !hasMore) return null;

  const start = (page - 1) * pageSize + 1;
  const end = start + pageSize - 1;

  function hrefFor(p: number): string {
    const q = new URLSearchParams(preservedQuery);
    if (p <= 1) q.delete("page");
    else q.set("page", String(p));
    const s = q.toString();
    return s ? `/inbox?${s}` : "/inbox";
  }

  const arrowBase = "rounded p-1 transition-colors";
  return (
    <div className="flex items-center justify-end gap-1 border-zinc-200/60 border-t px-3 py-2 text-xs text-zinc-500 dark:border-zinc-800/40">
      <span className="mr-1 font-mono tabular-nums">
        {start}-{end}
      </span>
      {page > 1 ? (
        <Link
          href={hrefFor(page - 1)}
          aria-label="Newer"
          className={`${arrowBase} hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100`}
        >
          <ChevronLeft className="h-4 w-4" />
        </Link>
      ) : (
        <span className={`${arrowBase} opacity-30`} aria-disabled="true">
          <ChevronLeft className="h-4 w-4" />
        </span>
      )}
      {hasMore ? (
        <Link
          href={hrefFor(page + 1)}
          aria-label="Older"
          className={`${arrowBase} hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100`}
        >
          <ChevronRight className="h-4 w-4" />
        </Link>
      ) : (
        <span className={`${arrowBase} opacity-30`} aria-disabled="true">
          <ChevronRight className="h-4 w-4" />
        </span>
      )}
    </div>
  );
}
