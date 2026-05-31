/**
 * Inbox-shaped loading skeleton. Mirrors the three-pane layout
 * so the page swap is layout-stable during navigation.
 */

import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";

export default function InboxLoading() {
  return (
    <div className="flex animate-[fade-in_200ms_ease-out] min-h-[calc(100vh-8rem)] flex-col lg:flex-row">
      {/* Left pane — folder list (desktop only) */}
      <aside className="hidden shrink-0 border-zinc-200/80 lg:block lg:w-[220px] lg:border-r dark:border-zinc-800/60">
        <div className="flex flex-col gap-2 p-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton
              // biome-ignore lint/suspicious/noArrayIndexKey: stable list
              key={i}
              className="h-7 w-full"
            />
          ))}
        </div>
      </aside>

      {/* Middle pane — thread list */}
      <section className="flex-1 overflow-hidden border-zinc-200/80 lg:w-[380px] lg:flex-none lg:border-r dark:border-zinc-800/60">
        <div className="flex items-center gap-2 border-zinc-200/80 border-b px-3 py-1.5 dark:border-zinc-800/60">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton
              // biome-ignore lint/suspicious/noArrayIndexKey: stable list
              key={i}
              className="h-5 w-16 rounded-full"
            />
          ))}
        </div>
        <div className="flex flex-col gap-2 border-zinc-200/80 border-b bg-zinc-50/40 px-3 py-2.5 dark:border-zinc-800/60">
          <Skeleton className="h-7 w-full" />
        </div>
        {Array.from({ length: 10 }).map((_, i) => (
          <SkeletonRow
            // biome-ignore lint/suspicious/noArrayIndexKey: stable list
            key={i}
          />
        ))}
      </section>

      {/* Right pane — thread detail (desktop) */}
      <section className="hidden flex-1 lg:flex lg:flex-col">
        <div className="border-zinc-200/80 border-b px-6 py-4 dark:border-zinc-800/60">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="mt-2 h-3 w-1/3" />
        </div>
        <div className="flex flex-col gap-4 p-6">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </section>
    </div>
  );
}
