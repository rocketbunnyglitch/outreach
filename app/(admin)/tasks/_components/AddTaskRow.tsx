"use client";

/**
 * AddTaskRow — inline "+ Add a task…" footer for the /tasks list.
 *
 * Matches the grid-cols-12 layout of the existing rows. Title alone is
 * enough to create the task (everything else has sensible defaults
 * server-side). Press Enter or click 'add' to submit.
 *
 * For richer fields (description, related entity, SLA threshold, custom
 * source) the user still has /tasks/new — kept as the deeper-detail
 * path. This is the fast-path for the daily "remember to do X" case.
 *
 * Session 11 improvements (this commit)
 * -------------------------------------
 *   - Current user surfaced as "(you)" + sorted to the top of the
 *     assignee dropdown, so the admin can find themselves at a
 *     glance ("assign to anyone, even me").
 *   - Quick due-date pills: Tomorrow / 3 days / 1 week / 2 weeks —
 *     one click sets the date input. The pill row collapses to a
 *     single line so it doesn't bloat the footer height.
 */

import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { createTask } from "../_actions";

interface Props {
  staffList: Array<{ id: string; displayName: string }>;
  /**
   * Staff ID of the signed-in operator. Used to mark their row in the
   * assignee dropdown with a "(you)" suffix and sort them first.
   * Optional so this component can still be used in seedless tests.
   */
  currentUserId?: string;
}

/**
 * Format a Date into a `yyyy-MM-dd` string in LOCAL time. The browser's
 * <input type="date"> wants this exact shape — using `.toISOString()`
 * would convert to UTC and shift the date around midnight.
 */
function localDateString(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Return the local date `daysFromNow` days in the future, as the
 * yyyy-MM-dd string the date input wants. Using setDate(...+offset)
 * correctly handles month/year boundaries.
 */
function dateOffsetString(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return localDateString(d);
}

/**
 * Order staff so the signed-in user comes first (with "(you)" suffix),
 * then everyone else alphabetically. Done client-side so the parent
 * page doesn't have to know which sort to apply.
 */
function orderStaffWithSelfFirst(
  staffList: Array<{ id: string; displayName: string }>,
  currentUserId?: string,
): Array<{ id: string; displayName: string; isSelf: boolean }> {
  return [...staffList]
    .map((s) => ({ ...s, isSelf: s.id === currentUserId }))
    .sort((a, b) => {
      if (a.isSelf && !b.isSelf) return -1;
      if (b.isSelf && !a.isSelf) return 1;
      return a.displayName.localeCompare(b.displayName);
    });
}

export function AddTaskRow({ staffList, currentUserId }: Props) {
  const [title, setTitle] = useState("");
  const [assignedStaffId, setAssignedStaffId] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>("");
  const [pending, startTx] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();

  const sortedStaff = useMemo(
    () => orderStaffWithSelfFirst(staffList, currentUserId),
    [staffList, currentUserId],
  );

  function setQuickDue(daysFromNow: number) {
    setDueDate(dateOffsetString(daysFromNow));
  }

  function commit() {
    setError(null);
    if (!title.trim()) {
      setError("Enter a task first.");
      return;
    }
    const taskTitleForToast = title.trim();
    startTx(async () => {
      const fd = new FormData();
      fd.set("title", taskTitleForToast);
      if (assignedStaffId) fd.set("assignedStaffId", assignedStaffId);
      // dueDate from <input type=date> is yyyy-MM-dd. Convert to ISO at noon
      // local time so the task doesn't read as 'overdue' the moment the date
      // arrives at midnight.
      if (dueDate) {
        fd.set("dueAt", new Date(`${dueDate}T12:00:00`).toISOString());
      }
      const result = await createTask(null, fd);
      if (!result.ok) {
        setError(result.error ?? "Couldn't create task.");
        toast.show({
          kind: "error",
          message: result.error ?? "Couldn't create task.",
          code: result.code,
        });
        return;
      }
      setTitle("");
      setAssignedStaffId("");
      setDueDate("");
      toast.show({
        kind: "success",
        message:
          taskTitleForToast.length > 40
            ? `Task created: ${taskTitleForToast.slice(0, 40)}…`
            : `Task created: ${taskTitleForToast}`,
      });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col border-zinc-200 border-t dark:border-zinc-800">
      <div
        className={cn(
          "group/add grid grid-cols-12 items-center gap-3 bg-zinc-50/50 px-4 py-2.5",
          "dark:bg-zinc-900/30",
        )}
      >
        {/* Title — 5 columns */}
        <div className="col-span-5 flex min-w-0 items-center gap-2">
          <Plus className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              }
            }}
            placeholder="+ Add a task…"
            className={cn(
              "w-full rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-sm transition-colors",
              "hover:border-zinc-300 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20",
              "dark:focus:border-blue-400 dark:focus:bg-zinc-900 dark:hover:border-zinc-700",
              "placeholder:text-zinc-400",
            )}
            aria-label="New task title"
            disabled={pending}
          />
        </div>

        {/* Assignee — 2 columns */}
        <div className="col-span-2">
          <select
            value={assignedStaffId}
            onChange={(e) => setAssignedStaffId(e.target.value)}
            disabled={pending}
            aria-label="Assignee"
            className={cn(
              "w-full appearance-none rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-xs transition-colors",
              "hover:border-zinc-300 focus:border-blue-500 focus:outline-none",
              "dark:focus:border-blue-400 dark:hover:border-zinc-700",
            )}
          >
            <option value="">Unassigned</option>
            {sortedStaff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.displayName}
                {s.isSelf && " (you)"}
              </option>
            ))}
          </select>
        </div>

        {/* Due — 2 columns */}
        <div className="col-span-2">
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            disabled={pending}
            aria-label="Due date"
            className={cn(
              "w-full rounded-sm border border-transparent bg-transparent px-1 py-0.5 font-mono text-xs tabular-nums transition-colors",
              "hover:border-zinc-300 focus:border-blue-500 focus:outline-none",
              "dark:focus:border-blue-400 dark:hover:border-zinc-700",
            )}
          />
        </div>

        {/* Status placeholder — 2 columns */}
        <div className="col-span-2 font-mono text-[10px] text-zinc-400 uppercase tracking-widest">
          pending
        </div>

        {/* Action — 1 column right-aligned */}
        <div className="col-span-1 flex flex-col items-end gap-1">
          {pending ? (
            <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
          ) : (
            <button
              type="button"
              onClick={commit}
              disabled={!title.trim()}
              className={cn(
                "rounded-md px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest transition-colors",
                "text-zinc-400 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50",
                "dark:hover:text-zinc-100",
              )}
              title="Press Enter to add"
            >
              add
            </button>
          )}
          {error && (
            <p
              className="font-mono text-[10px] text-rose-600 dark:text-rose-400"
              role="alert"
              title={error}
            >
              error
            </p>
          )}
        </div>
      </div>

      {/* Quick due-date pills — operator session 11 ask. Renders on a
          second row beneath the input so it doesn't squeeze the date
          column. Only shown when the title input has focus-worthy
          content (we keep them always visible because they're cheap
          and the most common operator interaction). */}
      <div
        className={cn("flex items-center gap-1.5 bg-zinc-50/30 px-4 py-1.5", "dark:bg-zinc-900/20")}
      >
        <span className="font-mono text-[9px] text-zinc-400 uppercase tracking-[0.14em]">Due</span>
        <DuePill label="Tomorrow" offsetDays={1} current={dueDate} onSet={setQuickDue} />
        <DuePill label="3 days" offsetDays={3} current={dueDate} onSet={setQuickDue} />
        <DuePill label="1 week" offsetDays={7} current={dueDate} onSet={setQuickDue} />
        <DuePill label="2 weeks" offsetDays={14} current={dueDate} onSet={setQuickDue} />
        {dueDate && (
          <button
            type="button"
            onClick={() => setDueDate("")}
            className="ml-auto rounded-md px-2 py-0.5 font-mono text-[9px] text-zinc-400 uppercase tracking-widest hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            clear
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Single due-date pill. Highlights when the current dueDate matches
 * what this pill would set, so the operator sees which one they
 * picked even after the click.
 */
function DuePill({
  label,
  offsetDays,
  current,
  onSet,
}: {
  label: string;
  offsetDays: number;
  current: string;
  onSet: (offset: number) => void;
}) {
  const matches = current === dateOffsetString(offsetDays);
  return (
    <button
      type="button"
      onClick={() => onSet(offsetDays)}
      className={cn(
        "rounded-md border px-2 py-0.5 text-[10px] transition-colors",
        matches
          ? "border-blue-400 bg-blue-100 font-medium text-blue-900 dark:border-blue-700 dark:bg-blue-950/60 dark:text-blue-100"
          : "border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800",
      )}
      aria-pressed={matches}
    >
      {label}
    </button>
  );
}
