import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { staffMembers, tasks } from "@/db/schema";
import { cn } from "@/lib/cn";
import { db } from "@/lib/db";
import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { AlertTriangle, Calendar, CheckCircle2, Plus, User } from "lucide-react";
import Link from "next/link";

export const metadata = { title: "Tasks · Crawl Engine" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

interface TasksPageProps {
  searchParams: Promise<{
    status?: string;
    assignee?: string;
    due?: string;
    page?: string;
  }>;
}

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10));
  const offset = (page - 1) * PAGE_SIZE;

  // Filter logic
  const statusFilter =
    params.status && ["pending", "in_progress", "completed", "cancelled"].includes(params.status)
      ? eq(tasks.status, params.status as "pending" | "in_progress" | "completed" | "cancelled")
      : undefined;
  const assigneeFilter = params.assignee
    ? params.assignee === "_unassigned"
      ? isNull(tasks.assignedStaffId)
      : eq(tasks.assignedStaffId, params.assignee)
    : undefined;
  let dueFilter: ReturnType<typeof and> | undefined;
  if (params.due === "overdue") {
    dueFilter = and(sql`${tasks.dueAt} < now()`, eq(tasks.status, "pending"));
  } else if (params.due === "today") {
    dueFilter = sql`${tasks.dueAt}::date = current_date`;
  } else if (params.due === "week") {
    dueFilter = and(sql`${tasks.dueAt} >= now()`, sql`${tasks.dueAt} < now() + interval '7 days'`);
  }

  // By default, hide completed/cancelled tasks unless filtered for explicitly
  const defaultStatusFilter = !params.status
    ? or(eq(tasks.status, "pending"), eq(tasks.status, "in_progress"))
    : undefined;

  const where = and(statusFilter, assigneeFilter, dueFilter, defaultStatusFilter);

  // Parallel fetch: rows + count + staff list for filter dropdown
  const [rows, [countRow], staffList] = await Promise.all([
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        source: tasks.source,
        targetType: tasks.targetType,
        targetId: tasks.targetId,
        dueAt: tasks.dueAt,
        completedAt: tasks.completedAt,
        slaThresholdMinutes: tasks.slaThresholdMinutes,
        createdAt: tasks.createdAt,
        assigneeName: staffMembers.displayName,
        assigneeEmail: staffMembers.primaryEmail,
      })
      .from(tasks)
      .leftJoin(staffMembers, eq(staffMembers.id, tasks.assignedStaffId))
      .where(where)
      .orderBy(
        // Pending first, then by due date (nulls last), then newest first
        sql`CASE ${tasks.status} WHEN 'pending' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END`,
        sql`${tasks.dueAt} ASC NULLS LAST`,
        desc(tasks.createdAt),
      )
      .limit(PAGE_SIZE)
      .offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(tasks).where(where),
    db
      .select({
        id: staffMembers.id,
        displayName: staffMembers.displayName,
      })
      .from(staffMembers)
      .where(isNull(staffMembers.archivedAt))
      .orderBy(asc(staffMembers.displayName)),
  ]);

  const total = countRow?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex animate-[fade-in_300ms_ease-out] flex-col gap-8">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-zinc-500 uppercase tracking-widest">Operations</p>
          <h1 className="mt-1 font-semibold text-4xl tracking-tight">Tasks</h1>
        </div>
        <Link
          href="/tasks/new"
          className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 font-medium text-sm text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          <Plus className="h-4 w-4" />
          New task
        </Link>
      </header>

      {/* Filter bar */}
      <form method="get" className="card-surface-quiet flex flex-wrap items-end gap-3 p-4">
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
            Status
          </span>
          <Select name="status" defaultValue={params.status ?? "_open"}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_open">Open (default)</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="in_progress">In progress</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
            Assignee
          </span>
          <Select name="assignee" defaultValue={params.assignee ?? "_any"}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_any">Anyone</SelectItem>
              <SelectItem value="_unassigned">Unassigned</SelectItem>
              {staffList.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">Due</span>
          <Select name="due" defaultValue={params.due ?? "_any"}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_any">Any time</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="week">This week</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button type="submit" variant="outline" size="sm">
          Apply filters
        </Button>
        {(params.status || params.assignee || params.due) && (
          <Link href="/tasks" className="text-xs text-zinc-500 underline-offset-2 hover:underline">
            Clear all
          </Link>
        )}
      </form>

      {/* Tasks table */}
      {rows.length === 0 ? (
        <div className="card-surface border-dashed p-12 text-center">
          <CheckCircle2 className="mx-auto h-8 w-8 text-zinc-400" />
          <h3 className="mt-4 font-semibold text-2xl tracking-tight">All clear</h3>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            {params.status || params.assignee || params.due
              ? "No tasks match these filters."
              : "No open tasks. Create one to get started."}
          </p>
          <Link
            href="/tasks/new"
            className="mt-6 inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 font-medium text-sm text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            <Plus className="h-4 w-4" />
            New task
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
          <div className="grid grid-cols-12 gap-3 border-zinc-200 border-b bg-zinc-100 px-4 py-2.5 font-mono text-[10px] text-zinc-500 uppercase tracking-widest dark:border-zinc-800 dark:bg-zinc-900">
            <div className="col-span-5">Task</div>
            <div className="col-span-2">Assignee</div>
            <div className="col-span-2">Due</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-1 text-right">Source</div>
          </div>

          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {rows.map((task, idx) => {
              const overdue = task.dueAt && task.status === "pending" && task.dueAt < new Date();
              return (
                <Link
                  key={task.id}
                  href={`/tasks/${task.id}`}
                  className={cn(
                    "grid grid-cols-12 items-center gap-3 px-4 py-3 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-900",
                    idx % 2 === 1
                      ? "bg-zinc-50/50 dark:bg-zinc-950"
                      : "bg-white dark:bg-zinc-950/40",
                  )}
                >
                  <div className="col-span-5 min-w-0">
                    <p className="truncate font-medium text-sm">{task.title}</p>
                    {task.targetType !== "misc" && (
                      <p className="mt-0.5 font-mono text-[11px] text-zinc-500">
                        → {task.targetType.replace("_", " ")}
                      </p>
                    )}
                  </div>
                  <div className="col-span-2 truncate text-sm text-zinc-600 dark:text-zinc-400">
                    {task.assigneeName ? (
                      <span className="inline-flex items-center gap-1.5">
                        <User className="h-3 w-3 text-zinc-500" />
                        {task.assigneeName}
                      </span>
                    ) : (
                      <span className="text-zinc-400 italic">unassigned</span>
                    )}
                  </div>
                  <div
                    className={cn(
                      "col-span-2 font-mono text-xs tabular-nums",
                      overdue ? "font-medium text-rose-500" : "text-zinc-500",
                    )}
                  >
                    {task.dueAt ? (
                      <span className="inline-flex items-center gap-1.5">
                        {overdue ? (
                          <AlertTriangle className="h-3 w-3" />
                        ) : (
                          <Calendar className="h-3 w-3" />
                        )}
                        {formatDueDate(task.dueAt)}
                      </span>
                    ) : (
                      <span className="italic">no due date</span>
                    )}
                  </div>
                  <div className="col-span-2">
                    <StatusBadge status={task.status} />
                  </div>
                  <div className="col-span-1 text-right">
                    <Badge tone={task.source === "auto" ? "muted" : "default"}>{task.source}</Badge>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between border-zinc-200 border-t pt-4 dark:border-zinc-800">
          <p className="font-mono text-xs text-zinc-500 tabular-nums">
            page {page} of {totalPages} · {total} total
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={`/tasks?${buildQuery(params, page - 1)}`}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                ← Previous
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={`/tasks?${buildQuery(params, page + 1)}`}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                Next →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: "bg-blue-500/10 text-blue-500 ring-blue-500/20",
    in_progress: "bg-amber-500/10 text-amber-500 ring-amber-500/20",
    completed: "bg-emerald-500/10 text-emerald-500 ring-emerald-500/20",
    cancelled: "bg-zinc-500/10 text-zinc-400 ring-zinc-500/20",
  };
  const color = colors[status] ?? colors.pending;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ring-1 ring-inset",
        color,
      )}
    >
      {status.replace("_", " ")}
    </span>
  );
}

function formatDueDate(dueAt: Date): string {
  const now = new Date();
  const diffMs = dueAt.getTime() - now.getTime();
  const diffMin = Math.round(diffMs / 60000);
  const diffHours = Math.round(diffMs / 3600000);
  const diffDays = Math.round(diffMs / 86400000);

  if (diffMin < 0 && diffMin > -60) return `${-diffMin}m ago`;
  if (diffHours < 0 && diffHours > -24) return `${-diffHours}h ago`;
  if (diffDays < 0) return `${-diffDays}d ago`;
  if (diffMin < 60) return `in ${diffMin}m`;
  if (diffHours < 24) return `in ${diffHours}h`;
  if (diffDays < 7) return `in ${diffDays}d`;
  return dueAt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function buildQuery(
  params: { status?: string; assignee?: string; due?: string },
  page: number,
): string {
  const usp = new URLSearchParams();
  if (params.status) usp.set("status", params.status);
  if (params.assignee) usp.set("assignee", params.assignee);
  if (params.due) usp.set("due", params.due);
  usp.set("page", String(page));
  return usp.toString();
}
