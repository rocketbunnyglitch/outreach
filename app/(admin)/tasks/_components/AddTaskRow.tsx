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
 */

import { cn } from "@/lib/cn";
import { Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createTask } from "../_actions";

interface Props {
  staffList: Array<{ id: string; displayName: string }>;
}

export function AddTaskRow({ staffList }: Props) {
  const [title, setTitle] = useState("");
  const [assignedStaffId, setAssignedStaffId] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>("");
  const [pending, startTx] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function commit() {
    setError(null);
    if (!title.trim()) {
      setError("Enter a task first.");
      return;
    }
    startTx(async () => {
      const fd = new FormData();
      fd.set("title", title.trim());
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
        return;
      }
      setTitle("");
      setAssignedStaffId("");
      setDueDate("");
      router.refresh();
    });
  }

  return (
    <div
      className={cn(
        "group/add grid grid-cols-12 items-center gap-3 border-zinc-200 border-t bg-zinc-50/50 px-4 py-2.5",
        "dark:border-zinc-800 dark:bg-zinc-900/30",
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
          {staffList.map((s) => (
            <option key={s.id} value={s.id}>
              {s.displayName}
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
  );
}
