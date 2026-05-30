"use client";

import { cn } from "@/lib/cn";
import { Loader2, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { removeSuppression } from "../_actions";

interface Row {
  id: string;
  email: string;
  reason: string;
  notes: string | null;
  createdAt: Date;
  createdByName: string | null;
}

const REASON_LABEL: Record<string, string> = {
  manual: "Manual",
  unsubscribe: "Unsubscribed",
  bounced: "Bounced",
  complained: "Complained",
};

const REASON_TONE: Record<string, string> = {
  manual: "text-zinc-700 dark:text-zinc-300",
  unsubscribe: "text-blue-700 dark:text-blue-300",
  bounced: "text-rose-700 dark:text-rose-300",
  complained: "text-rose-700 dark:text-rose-300",
};

export function SuppressionTable({ rows }: { rows: Row[] }) {
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="card-surface overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-zinc-200 border-b text-left font-mono text-[10px] text-zinc-500 uppercase tracking-widest dark:border-zinc-800/60">
            <th className="px-4 py-2.5">Email</th>
            <th className="px-4 py-2.5">Reason</th>
            <th className="px-4 py-2.5">Notes</th>
            <th className="px-4 py-2.5">Added</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <SuppressionRow key={r.id} row={r} onError={setError} />
          ))}
        </tbody>
      </table>
      {error && (
        <div className="border-rose-200 border-t bg-rose-50 px-4 py-2 text-rose-700 text-xs dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      )}
    </section>
  );
}

function SuppressionRow({ row, onError }: { row: Row; onError: (msg: string | null) => void }) {
  const [isPending, startTx] = useTransition();

  function remove() {
    if (
      !confirm(
        `Remove ${row.email} from the suppression list? Sends to this address will be allowed again.`,
      )
    )
      return;
    const fd = new FormData();
    fd.set("id", row.id);
    startTx(async () => {
      const result = await removeSuppression(null, fd);
      if (!result.ok) onError(result.error);
    });
  }

  return (
    <tr>
      <td className="px-4 py-2.5 font-mono text-xs">{row.email}</td>
      <td className="px-4 py-2.5">
        <span
          className={cn(
            "font-mono text-[10px] uppercase tracking-widest",
            REASON_TONE[row.reason] ?? "text-zinc-500",
          )}
        >
          {REASON_LABEL[row.reason] ?? row.reason}
        </span>
      </td>
      <td className="px-4 py-2.5 text-xs text-zinc-600 dark:text-zinc-400">
        {row.notes ?? <span className="text-zinc-400">—</span>}
      </td>
      <td className="px-4 py-2.5 text-xs text-zinc-500">
        {row.createdAt instanceof Date ? row.createdAt.toLocaleDateString() : ""}
        {row.createdByName ? ` · ${row.createdByName}` : ""}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={remove}
            disabled={isPending}
            className="rounded p-1 text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/30"
            title="Remove from suppression"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />}
        </div>
      </td>
    </tr>
  );
}
