"use client";

import { useToast } from "@/components/ui/toast";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteTask } from "../_actions";

/** Admin-only hard delete. Two-step confirm to avoid accidents. */
export function DeleteTaskButton({ taskId }: { taskId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTx] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onDelete() {
    setError(null);
    startTx(async () => {
      const res = await deleteTask(taskId);
      if (res.ok) {
        toast.show({ kind: "success", message: "Task deleted." });
        router.push("/tasks");
        router.refresh();
      } else {
        setError(res.error);
        setConfirming(false);
        toast.show({ kind: "error", message: res.error ?? "Couldn't delete task." });
      }
    });
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        title="Delete this task permanently (admin only)"
        className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 py-1.5 text-sm text-zinc-600 transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-rose-900 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
      >
        <Trash2 className="h-3.5 w-3.5" /> Delete
        {error ? <span className="text-rose-500 text-xs">· {error}</span> : null}
      </button>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <span className="text-xs text-zinc-500">Delete permanently?</span>
      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        className="rounded-md bg-rose-600 px-2.5 py-1.5 text-sm text-white hover:bg-rose-700 disabled:opacity-50"
      >
        {pending ? "Deleting…" : "Confirm"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-sm dark:border-zinc-800"
      >
        Cancel
      </button>
    </span>
  );
}
