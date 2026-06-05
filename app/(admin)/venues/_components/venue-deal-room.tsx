"use client";

/**
 * VenueDealRoom — the venue detail "deal room" layout.
 *
 * Three columns, highest-ROI in the middle:
 *   - LEFT  : venue info + relationship/status (always visible)
 *   - MIDDLE: a tabbed module surface; the email thread is the default tab
 *             since that's what staffers reach for first. Other modules
 *             (notes, calls, confirmation, crawls, wristbands, details) swap
 *             in without leaving the page.
 *   - RIGHT : quick actions (always visible)
 *
 * Each section is rendered server-side and passed in as a node, so all
 * existing data loading + server actions are untouched -- this component only
 * arranges them and owns the tab state. Stacks to one column on small screens.
 */

import { cn } from "@/lib/cn";
import { type ReactNode, useState } from "react";

export interface DealRoomTab {
  id: string;
  label: string;
  /** Optional count badge (threads, notes, calls, ...). */
  count?: number;
  content: ReactNode;
}

interface Props {
  left: ReactNode;
  right: ReactNode;
  tabs: DealRoomTab[];
}

export function VenueDealRoom({ left, right, tabs }: Props) {
  const [active, setActive] = useState(tabs[0]?.id ?? "");
  const activeTab = tabs.find((t) => t.id === active) ?? tabs[0];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Left — venue info + status */}
      <aside className="flex flex-col gap-6 lg:col-span-3">{left}</aside>

      {/* Middle — tabbed modules */}
      <div className="flex min-w-0 flex-col gap-3 lg:col-span-6">
        <nav
          className="flex flex-wrap gap-0.5 border-zinc-200/70 border-b dark:border-zinc-800/50"
          aria-label="Venue sections"
        >
          {tabs.map((t) => {
            const isActive = t.id === activeTab?.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActive(t.id)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 font-medium text-xs transition-colors",
                  isActive
                    ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
                    : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:text-zinc-200",
                )}
              >
                {t.label}
                {t.count != null && t.count > 0 && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 font-mono text-[9px] tabular-nums",
                      isActive
                        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : "bg-zinc-200/70 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
                    )}
                  >
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="min-w-0">{activeTab?.content}</div>
      </div>

      {/* Right — quick actions */}
      <aside className="flex flex-col gap-6 lg:col-span-3">{right}</aside>
    </div>
  );
}
