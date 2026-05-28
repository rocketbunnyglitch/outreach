import { cn } from "@/lib/cn";
import type { UpcomingTaskRow } from "@/lib/dashboard-queries";
import { AlertTriangle, Calendar, CheckCircle2, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";

interface Props {
  tasks: UpcomingTaskRow[];
  totalOpen: number;
  overdueCount: number;
}

/**
 * Dashboard widget showing the next 7 days of upcoming tasks plus any
 * already-overdue items. Designed to fit next to the cities table.
 */
export function TasksWidget({ tasks, totalOpen, overdueCount }: Props) {
  return (
    <div className="card-surface overflow-hidden">
      <header className="flex items-baseline justify-between gap-3 border-zinc-200 border-b bg-zinc-100/60 px-4 py-2.5 dark:border-zinc-800/60 dark:bg-zinc-900/30">
        <div className="flex items-baseline gap-2">
          <h2 className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
            Your upcoming tasks
          </h2>
          {overdueCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 font-mono text-[10px] text-rose-500 ring-1 ring-rose-500/20 ring-inset">
              <AlertTriangle className="h-3 w-3" />
              {overdueCount} overdue
            </span>
          )}
        </div>
        <Link
          href="/tasks"
          className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          all {totalOpen} →
        </Link>
      </header>

      {tasks.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
          <CheckCircle2 className="h-6 w-6 text-zinc-400" />
          <p className="text-sm text-zinc-600 dark:text-zinc-400">No upcoming tasks</p>
          <Link
            href="/tasks/new"
            className="mt-2 inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            <Plus className="h-3 w-3" />
            New task
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {tasks.map((task) => (
            <li key={task.id}>
              <Link
                href={`/tasks/${task.id}`}
                className="grid grid-cols-12 items-center gap-2 px-4 py-2.5 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-900"
              >
                <div className="col-span-7 min-w-0">
                  <p className="truncate font-medium text-sm">{task.title}</p>
                  <p className="font-mono text-[11px] text-zinc-500">
                    {task.assigneeName ?? "unassigned"}
                  </p>
                </div>
                <div
                  className={cn(
                    "col-span-4 font-mono text-[11px] tabular-nums",
                    task.overdue ? "font-medium text-rose-500" : "text-zinc-500",
                  )}
                >
                  {task.dueAt ? (
                    <span className="inline-flex items-center gap-1">
                      {task.overdue ? (
                        <AlertTriangle className="h-3 w-3" />
                      ) : (
                        <Calendar className="h-3 w-3" />
                      )}
                      {formatRelative(task.dueAt)}
                    </span>
                  ) : (
                    <span className="italic">no due date</span>
                  )}
                </div>
                <ChevronRight className="col-span-1 h-3 w-3 text-zinc-500" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatRelative(d: Date): string {
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffMin = Math.round(diffMs / 60000);
  const diffHours = Math.round(diffMs / 3600000);
  const diffDays = Math.round(diffMs / 86400000);

  if (diffMin < 0 && diffMin > -60) return `${-diffMin}m ago`;
  if (diffHours < 0 && diffHours > -24) return `${-diffHours}h ago`;
  if (diffDays < 0) return `${-diffDays}d ago`;
  if (diffMin < 60) return `in ${diffMin}m`;
  if (diffHours < 24) return `in ${diffHours}h`;
  if (diffDays < 7) return `in ${diffDays}d`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
