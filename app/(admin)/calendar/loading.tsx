/**
 * Calendar loading skeleton — month-grid shape.
 */

import { Skeleton } from "@/components/ui/skeleton";

export default function CalendarLoading() {
  return (
    <div className="flex flex-col gap-4 p-6 animate-[fade-in_200ms_ease-out]">
      {/* Header: title + view picker + nav */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-3 w-56" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-7 w-7 rounded-md" />
          <Skeleton className="h-7 w-24 rounded-md" />
          <Skeleton className="h-7 w-7 rounded-md" />
        </div>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-zinc-200 bg-zinc-200 dark:border-zinc-800 dark:bg-zinc-800">
        {Array.from({ length: 7 }).map((_, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: stable list
            key={`h-${i}`}
            className="bg-white px-2 py-2 dark:bg-zinc-950"
          >
            <Skeleton className="h-3 w-8" />
          </div>
        ))}
        {Array.from({ length: 35 }).map((_, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: stable list
            key={`d-${i}`}
            className="flex h-24 flex-col gap-1 bg-white p-1.5 dark:bg-zinc-950"
          >
            <Skeleton className="h-3 w-4" />
            {i % 4 === 0 && <Skeleton className="h-4 w-3/4 rounded-sm" />}
            {i % 6 === 0 && <Skeleton className="h-4 w-1/2 rounded-sm" />}
          </div>
        ))}
      </div>
    </div>
  );
}
