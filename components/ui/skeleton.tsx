/**
 * Skeleton — a single shimmering rectangle. Drop in wherever the
 * real content is about to render, in the same shape and size, so
 * the user gets layout-stable feedback during loading.
 *
 * Use the `Skeleton` component for individual blocks and the
 * `SkeletonRow` / `SkeletonText` helpers for the two most common
 * compound shapes (a list row + a paragraph of text).
 *
 * Sized via Tailwind utility classes on the caller, NOT via props,
 * so the skeleton inherits its parent's spacing rules and won't
 * cause layout shift when the real content arrives.
 *
 * The shimmer is a single `animate-pulse` — cheap, no extra
 * stylesheet, plays nicely with reduced-motion via Tailwind's
 * built-in @media (prefers-reduced-motion) handling.
 */

import { cn } from "@/lib/cn";

export function Skeleton({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={cn("animate-pulse rounded-md bg-zinc-200/70 dark:bg-zinc-800/60", className)}
    />
  );
}

/**
 * Compound shape for a typical list row: an avatar circle, two
 * lines of text. Tweak via the `compact` prop for tighter rows.
 */
export function SkeletonRow({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 border-zinc-200/60 border-b px-4 dark:border-zinc-800/40",
        compact ? "py-2" : "py-3",
      )}
    >
      <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
      <div className="flex flex-1 flex-col gap-1.5">
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-2.5 w-5/6" />
      </div>
    </div>
  );
}

/**
 * Compound shape for a block of text: 3 lines, narrower as it
 * goes (matching how real prose typically lands on the last
 * line).
 */
export function SkeletonText({ lines = 3 }: { lines?: number }) {
  const widths = ["w-full", "w-11/12", "w-3/4", "w-5/6", "w-2/3"];
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          // biome-ignore lint/suspicious/noArrayIndexKey: stable list, no reorder
          key={i}
          className={cn("h-3", widths[i % widths.length])}
        />
      ))}
    </div>
  );
}
