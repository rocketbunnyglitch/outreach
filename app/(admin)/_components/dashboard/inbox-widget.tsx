/**
 * Inbox dashboard widget.
 *
 * Two panes:
 *   Left  — top "needs reply" threads (your assignments + your inboxes)
 *   Right — per-inbox send-cap rail with today's count vs the 30/day cap
 *
 * Each thread row is a click-through to /inbox/[threadId]. The
 * send-cap rail is informational + serves as a deliverability
 * warning when an inbox is at or near the cap.
 *
 * Designed to be familiar to Gmail users: subject + snippet +
 * sender + timestamp on a single row, with a side rail that's
 * unique to this product (the send-cap counters Gmail doesn't have).
 */

import { cn } from "@/lib/cn";
import type { InboxWidgetData } from "@/lib/inbox-widget-data";
import { AlertTriangle, ArrowRight, Inbox, Mail } from "lucide-react";
import Link from "next/link";

export function InboxWidget({ data }: { data: InboxWidgetData }) {
  const hasThreads = data.threads.length > 0;
  const hasInboxes = data.myInboxes.length > 0;
  if (!hasThreads && !hasInboxes) {
    return null; // No inbox surface to show — keep dashboard tidy.
  }

  return (
    <section className="card-surface flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-zinc-200/80 border-b px-4 py-3 dark:border-zinc-800/60">
        <div className="flex items-center gap-2">
          <Inbox className="h-4 w-4 text-zinc-500" />
          <h2 className="font-semibold text-base tracking-tight">Inbox</h2>
          {data.totalNeedsReply > 0 && (
            <span className="inline-flex items-center rounded-full bg-rose-100 px-1.5 py-0.5 font-mono text-[10px] text-rose-700 tracking-widest dark:bg-rose-950/40 dark:text-rose-300">
              {data.totalNeedsReply}
            </span>
          )}
        </div>
        <Link
          href="/inbox"
          className="inline-flex items-center gap-1 font-mono text-[11px] text-zinc-500 uppercase tracking-widest hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          open inbox
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3">
        {/* Threads */}
        <div className="border-zinc-200/80 lg:col-span-2 lg:border-r dark:border-zinc-800/60">
          {hasThreads ? (
            <ul className="divide-y divide-zinc-200/80 dark:divide-zinc-800/60">
              {data.threads.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/inbox/${t.id}`}
                    className="flex flex-col gap-0.5 px-4 py-2.5 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate font-medium text-sm">
                        {t.lastSenderName ?? t.venueName ?? "Unassigned"}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                        {t.lastMessageAt ? relativeTime(t.lastMessageAt) : ""}
                      </span>
                    </div>
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 truncate text-xs text-zinc-600 dark:text-zinc-400">
                        {t.subject ?? "(no subject)"}
                      </span>
                      {t.assignedToMe && (
                        <span className="shrink-0 rounded-sm bg-blue-100 px-1.5 py-0.5 font-mono text-[9px] text-blue-700 uppercase tracking-widest dark:bg-blue-950/40 dark:text-blue-300">
                          assigned
                        </span>
                      )}
                    </div>
                    {t.snippet && <p className="truncate text-[11px] text-zinc-500">{t.snippet}</p>}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-4 py-8 text-center text-sm text-zinc-500">
              <Mail className="mx-auto h-5 w-5 text-zinc-400" />
              <p className="mt-2">Nothing needs a reply right now.</p>
            </div>
          )}
        </div>

        {/* Send-cap rail */}
        <div className="px-4 py-3">
          <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
            Today's sends
          </p>
          {hasInboxes ? (
            <ul className="mt-2 flex flex-col gap-3">
              {data.myInboxes.map((ib) => (
                <li key={ib.inboxId} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate font-mono text-[11px]">
                      {ib.emailAddress}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 font-mono text-xs tabular-nums",
                        ib.atCap
                          ? "text-rose-600 dark:text-rose-400"
                          : ib.remaining <= 5
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-zinc-700 dark:text-zinc-300",
                      )}
                    >
                      {ib.used} / {ib.cap}
                    </span>
                  </div>
                  <div className="h-1 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                    <div
                      className={cn(
                        "h-full transition-all",
                        ib.atCap
                          ? "bg-rose-500"
                          : ib.remaining <= 5
                            ? "bg-amber-500"
                            : "bg-emerald-500",
                      )}
                      style={{ width: `${Math.min(100, (ib.used / Math.max(1, ib.cap)) * 100)}%` }}
                    />
                  </div>
                  {ib.atCap && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-rose-600 dark:text-rose-400">
                      <AlertTriangle className="h-3 w-3" />
                      Daily cap reached
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-zinc-500">
              No inboxes assigned to you. Ask an admin to set you as owner of a connected Gmail.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

/** Compact relative time like Gmail: "2m", "4h", "Mon", or "Mar 3". */
function relativeTime(d: Date): string {
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) {
    return d.toLocaleDateString(undefined, { weekday: "short" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
