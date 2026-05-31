/**
 * EmptyState — the friendly "nothing here yet" surface that
 * pages use when a list/table is empty. Pages should never show
 * a blank or "no rows" plain text — they should explain why,
 * what the user could do about it, and (when applicable) provide
 * a primary CTA.
 *
 * Shape:
 *   - large icon (60px)
 *   - title (one short line, sentence-cased, no period)
 *   - description (one to two sentences)
 *   - optional action button
 *
 * Used by every list/index page across the admin shell as part
 * of the Phase H UX-foundations work.
 */

import { cn } from "@/lib/cn";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";

interface EmptyStateProps {
  /** Lucide icon component, rendered at 60px. */
  icon: LucideIcon;
  /** One short line. Sentence case, no terminating period. */
  title: string;
  /** One to two sentences. Avoid jargon. */
  description?: string;
  /** Primary call-to-action. Either an href (for navigation) or
   *  an onClick (for opening a modal / firing an action). */
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  /** Secondary action — usually a "Learn more" link. */
  secondaryAction?: {
    label: string;
    href: string;
  };
  /** Visual variant. Default is the neutral zinc tone; `tinted`
   *  uses a soft indigo wash for hero placements (the inbox
   *  empty pane). */
  tone?: "neutral" | "tinted";
  /** Padding scale. `compact` for embedded contexts (a rail or
   *  card body); `default` for full-page empty states. */
  size?: "compact" | "default";
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  tone = "neutral",
  size = "default",
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        size === "default" ? "gap-3 px-6 py-12" : "gap-2 px-4 py-6",
        tone === "tinted" &&
          "rounded-xl bg-indigo-50/40 ring-1 ring-indigo-100 dark:bg-indigo-950/20 dark:ring-indigo-900/40",
        className,
      )}
    >
      <Icon
        className={cn(
          "shrink-0",
          size === "default" ? "h-12 w-12" : "h-8 w-8",
          tone === "tinted"
            ? "text-indigo-400 dark:text-indigo-500"
            : "text-zinc-300 dark:text-zinc-600",
        )}
        strokeWidth={1.5}
      />
      <h3
        className={cn(
          "font-semibold text-zinc-900 tracking-tight dark:text-zinc-100",
          size === "default" ? "text-base" : "text-sm",
        )}
      >
        {title}
      </h3>
      {description && (
        <p className="max-w-md text-sm text-zinc-500 leading-relaxed dark:text-zinc-400">
          {description}
        </p>
      )}
      {(action || secondaryAction) && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {action &&
            (action.href ? (
              <Link
                href={action.href}
                className="inline-flex items-center gap-1 rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white text-xs hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                {action.label}
              </Link>
            ) : (
              <button
                type="button"
                onClick={action.onClick}
                className="inline-flex items-center gap-1 rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white text-xs hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                {action.label}
              </button>
            ))}
          {secondaryAction && (
            <Link
              href={secondaryAction.href}
              className="inline-flex items-center gap-1 font-medium text-xs text-zinc-500 underline-offset-2 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              {secondaryAction.label}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
