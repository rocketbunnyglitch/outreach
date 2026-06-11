import type { CityThreadFeed } from "@/lib/city-thread-feed";
import { cn } from "@/lib/cn";
import { ArrowDownLeft, ArrowUpRight, Inbox } from "lucide-react";
import Link from "next/link";

/**
 * Read-only city inbox at the bottom of the city sheet (operator
 * request 2026-06-11): every email sent from or received for this
 * city's venues under the current campaign, newest first, so anyone
 * working the city has instant visibility without hunting through
 * per-inbox views. Rows deep-link into /inbox/[threadId] to reply.
 *
 * Server component — all timestamps preformatted in the loader
 * (lib/city-thread-feed.ts), so nothing here touches the clock.
 */

const STATE_LABEL: Record<string, { label: string; tone: string }> = {
  needs_reply: {
    label: "needs reply",
    tone: "bg-amber-500/15 text-amber-700 ring-amber-500/25 dark:text-amber-300",
  },
  waiting_on_them: {
    label: "waiting",
    tone: "bg-zinc-500/10 text-zinc-600 ring-zinc-500/20 dark:text-zinc-300",
  },
  done: {
    label: "done",
    tone: "bg-emerald-500/15 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300",
  },
};

export function CityEmailFeed({ feed, cityName }: { feed: CityThreadFeed; cityName: string }) {
  return (
    <section className="card-surface overflow-hidden">
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-zinc-200/60 border-b px-5 py-3 dark:border-zinc-800/40">
        <div className="flex min-w-0 items-center gap-2">
          <Inbox className="h-4 w-4 shrink-0 text-zinc-400" />
          <h2 className="shrink-0 font-semibold text-sm tracking-tight">City inbox</h2>
          <span className="min-w-0 truncate font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
            · {cityName}
            {feed.campaignLabel ? ` · ${feed.campaignLabel}` : ""}
          </span>
        </div>
        <p className="shrink-0 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
          {feed.totalCount} {feed.totalCount === 1 ? "thread" : "threads"}
          {feed.totalCount > feed.rows.length ? ` · newest ${feed.rows.length} shown` : ""}
        </p>
      </header>

      {feed.rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-zinc-500">
          No emails for {cityName} under this campaign yet. Outreach sent from the table above (and
          every venue reply) will show up here.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-200/60 dark:divide-zinc-800/40">
          {feed.rows.map((row) => {
            const inbound = row.latestDirection === "inbound";
            const state = STATE_LABEL[row.state];
            return (
              <li key={row.threadId}>
                <Link
                  href={`/inbox/${row.threadId}`}
                  className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-zinc-500/[0.04] dark:hover:bg-zinc-400/[0.06]"
                >
                  {/* Direction of the latest message */}
                  {inbound ? (
                    <ArrowDownLeft
                      className="h-3.5 w-3.5 shrink-0 text-emerald-500"
                      aria-label="Latest message is from the venue"
                    />
                  ) : (
                    <ArrowUpRight
                      className="h-3.5 w-3.5 shrink-0 text-zinc-400"
                      aria-label="Latest message is from us"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="flex min-w-0 items-baseline gap-1.5">
                      <span className="shrink-0 font-medium text-xs text-zinc-900 dark:text-zinc-100">
                        {row.venueName ?? row.latestFromName ?? "Unknown venue"}
                      </span>
                      <span className="min-w-0 truncate text-xs text-zinc-600 dark:text-zinc-400">
                        {row.subject}
                      </span>
                    </p>
                    {row.latestSnippet && (
                      <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                        {row.latestSnippet}
                      </p>
                    )}
                  </div>
                  {state && (
                    <span
                      className={cn(
                        "hidden shrink-0 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] ring-1 ring-inset sm:inline-flex",
                        state.tone,
                      )}
                    >
                      {state.label}
                    </span>
                  )}
                  <span className="shrink-0 font-mono text-[10px] text-zinc-500 tabular-nums">
                    {row.timeLabel}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
