/**
 * TableLoading — shared loading shape for any list/index page
 * that renders a table-style surface (rows of records). Pages
 * use this from their own loading.tsx via a one-liner.
 */

import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";

interface TableLoadingProps {
  /** Page title placeholder width. */
  titleWidth?: string;
  /** How many skeleton rows to render. Default 8. */
  rows?: number;
  /** Whether to render a top action button placeholder
   *  (e.g. "New venue", "Add task"). Default true. */
  showAction?: boolean;
  /** Whether to render the filter chip row above the table.
   *  Default true. */
  showFilters?: boolean;
}

export function TableLoading({
  titleWidth = "w-48",
  rows = 8,
  showAction = true,
  showFilters = true,
}: TableLoadingProps) {
  return (
    <div className="flex flex-col gap-4 p-6 animate-[fade-in_200ms_ease-out]">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className={`h-6 ${titleWidth}`} />
          <Skeleton className="h-3 w-72 max-w-full" />
        </div>
        {showAction && <Skeleton className="h-8 w-28" />}
      </div>

      {/* Filter chips */}
      {showFilters && (
        <div className="flex flex-wrap items-center gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton
              // biome-ignore lint/suspicious/noArrayIndexKey: stable list
              key={i}
              className="h-7 w-24 rounded-full"
            />
          ))}
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="border-zinc-200 border-b px-4 py-2.5 dark:border-zinc-800">
          <Skeleton className="h-3 w-40" />
        </div>
        {Array.from({ length: rows }).map((_, i) => (
          <SkeletonRow
            // biome-ignore lint/suspicious/noArrayIndexKey: stable list
            key={i}
          />
        ))}
      </div>
    </div>
  );
}
