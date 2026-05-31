/**
 * Admin shell loading skeleton.
 *
 * Next.js renders this between route navigations while the server
 * component for the new page is streaming. Without it, the
 * existing page stays visible for a moment and then the body
 * flashes empty as the new server tree mounts — a jarring
 * experience.
 *
 * The skeleton renders a generic page-shaped placeholder: a
 * header strip, a few cards, a list. Real pages override this
 * with their own loading.tsx for tighter shape matching.
 */

import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";

export default function AdminLoading() {
  return (
    <div className="flex flex-col gap-4 p-6 animate-[fade-in_200ms_ease-out]">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-3 w-72" />
        </div>
        <Skeleton className="h-8 w-24" />
      </div>

      {/* Stat cards row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: stable list
            key={i}
            className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
          >
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-7 w-20" />
            <Skeleton className="h-2 w-24" />
          </div>
        ))}
      </div>

      {/* Body — list / table */}
      <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="border-zinc-200 border-b px-4 py-3 dark:border-zinc-800">
          <Skeleton className="h-4 w-40" />
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonRow
            // biome-ignore lint/suspicious/noArrayIndexKey: stable list
            key={i}
          />
        ))}
      </div>
    </div>
  );
}
