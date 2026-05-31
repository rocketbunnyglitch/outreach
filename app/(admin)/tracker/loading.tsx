/**
 * Tracker dashboard loading skeleton. The dashboard has a hero
 * row of stat cards + a long table of cities so we approximate
 * both shapes.
 */

import { Skeleton } from "@/components/ui/skeleton";

export default function TrackerLoading() {
  return (
    <div className="flex flex-col gap-4 p-6 animate-[fade-in_200ms_ease-out]">
      {/* Hero stats row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: stable list
            key={i}
            className="flex aspect-square min-h-[140px] flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 sm:min-h-[260px] dark:border-zinc-800 dark:bg-zinc-950"
          >
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-10 w-24" />
            <Skeleton className="mt-auto h-2 w-16" />
          </div>
        ))}
      </div>

      {/* Cities table */}
      <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="border-zinc-200 border-b px-4 py-3 dark:border-zinc-800">
          <div className="grid grid-cols-12 gap-2">
            <Skeleton className="col-span-3 h-3" />
            <Skeleton className="col-span-2 h-3" />
            <Skeleton className="col-span-2 h-3" />
            <Skeleton className="col-span-2 h-3" />
            <Skeleton className="col-span-3 h-3" />
          </div>
        </div>
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: stable list
            key={i}
            className="grid grid-cols-12 gap-2 border-zinc-200/60 border-b px-4 py-3 dark:border-zinc-800/40"
          >
            <Skeleton className="col-span-3 h-4" />
            <Skeleton className="col-span-2 h-4 w-12" />
            <Skeleton className="col-span-2 h-3 w-16" />
            <Skeleton className="col-span-2 h-3 w-20" />
            <Skeleton className="col-span-3 h-3" />
          </div>
        ))}
      </div>
    </div>
  );
}
