"use client";

/**
 * Admin-only "clear the auto-generated backlog" button. Cancels every
 * pending `auto` + `smart_note` task in one server round-trip (the AI
 * inbox promise-extractor created ~1k of these before the campaign
 * started). Manually-created tasks are never touched. Cancel (not
 * delete) keeps the audit trail.
 */

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { bulkClearTasks } from "../_actions";

export function BulkClearTasksButton({ clearableCount }: { clearableCount: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [cleared, setCleared] = useState<number | null>(null);

  // Nothing to clear and nothing cleared yet -> render nothing.
  if (clearableCount === 0 && cleared === null) return null;

  return (
    <button
      type="button"
      disabled={pending || clearableCount === 0}
      onClick={() => {
        if (
          !window.confirm(
            `Cancel ${clearableCount} pending auto-generated tasks (from email parsing and cascades)? Manually-created tasks are untouched. This keeps the audit trail.`,
          )
        ) {
          return;
        }
        start(async () => {
          const res = await bulkClearTasks({});
          if (res.ok) {
            setCleared(res.data.cleared);
            router.refresh();
          } else {
            window.alert(res.error);
          }
        });
      }}
      className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-2 font-medium text-sm text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
      title="Cancel all pending auto-generated tasks (not manual ones)"
    >
      <Trash2 className="h-4 w-4" />
      {pending
        ? "Clearing..."
        : cleared !== null
          ? `Cleared ${cleared}`
          : `Clear ${clearableCount} auto tasks`}
    </button>
  );
}
