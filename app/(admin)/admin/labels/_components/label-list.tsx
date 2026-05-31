"use client";

import { useToast } from "@/components/ui/toast";
import { Check, Loader2, Pencil, Trash2, X } from "lucide-react";
import { useState, useTransition } from "react";
import { deleteTeamLabelAction, renameTeamLabelAction } from "../_actions";

interface TeamLabelRow {
  id: string;
  name: string;
  color: string | null;
}

const COLOR_DOT: Record<string, string> = {
  emerald: "bg-emerald-500",
  rose: "bg-rose-500",
  blue: "bg-blue-500",
  amber: "bg-amber-500",
  violet: "bg-violet-500",
  sky: "bg-sky-500",
  orange: "bg-orange-500",
  yellow: "bg-yellow-500",
  zinc: "bg-zinc-400",
};

export function LabelList({ labels }: { labels: TeamLabelRow[] }) {
  return (
    <section className="card-surface overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-zinc-200 border-b text-left font-mono text-[10px] text-zinc-500 uppercase tracking-widest dark:border-zinc-800/60">
            <th className="px-4 py-2.5">Label</th>
            <th className="px-4 py-2.5 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {labels.map((l) => (
            <Row key={l.id} label={l} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Row({ label }: { label: TeamLabelRow }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(label.name);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTx] = useTransition();
  const toast = useToast();

  function saveRename() {
    if (!name.trim() || name === label.name) {
      setEditing(false);
      setName(label.name);
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.set("id", label.id);
    fd.set("name", name.trim());
    startTx(async () => {
      const result = await renameTeamLabelAction(null, fd);
      if (result.ok) {
        toast.show({ kind: "success", message: `Renamed to "${name.trim()}".` });
        setEditing(false);
      } else {
        setError(result.error);
        toast.show({
          kind: "error",
          message: result.error ?? "Couldn't rename label.",
          code: result.code,
        });
      }
    });
  }

  function deleteLabel() {
    if (!confirm(`Delete "${label.name}"? Threads will lose this label.`)) return;
    const fd = new FormData();
    fd.set("id", label.id);
    startTx(async () => {
      const result = await deleteTeamLabelAction(null, fd);
      if (result.ok) {
        toast.show({ kind: "success", message: `Label "${label.name}" deleted.` });
      } else {
        setError(result.error);
        toast.show({
          kind: "error",
          message: result.error ?? "Couldn't delete label.",
          code: result.code,
        });
      }
    });
  }

  const dotClass = label.color ? (COLOR_DOT[label.color] ?? "bg-zinc-400") : "bg-zinc-400";

  return (
    <>
      <tr>
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`inline-block h-2.5 w-2.5 rounded-full ${dotClass}`}
            />
            {editing ? (
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveRename();
                  if (e.key === "Escape") {
                    setEditing(false);
                    setName(label.name);
                  }
                }}
                // biome-ignore lint/a11y/noAutofocus: modal field is the primary action
                autoFocus
                className="flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-700 dark:bg-zinc-900"
              />
            ) : (
              <span className="font-medium">{label.name}</span>
            )}
          </div>
        </td>
        <td className="px-4 py-2.5">
          <div className="flex items-center justify-end gap-1.5">
            {editing ? (
              <>
                <button
                  type="button"
                  onClick={saveRename}
                  disabled={isPending}
                  className="rounded p-1 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
                  title="Save"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setName(label.name);
                  }}
                  className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  title="Cancel"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  disabled={isPending}
                  className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                  title="Rename"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={deleteLabel}
                  disabled={isPending}
                  className="rounded p-1 text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/30"
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}
            {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />}
          </div>
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={2} className="px-4 pb-3">
            <div className="rounded-md bg-rose-50 px-3 py-2 text-rose-700 text-xs dark:bg-rose-950/40 dark:text-rose-300">
              {error}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
