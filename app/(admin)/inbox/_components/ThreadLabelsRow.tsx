"use client";

/**
 * ThreadLabelsRow — applied-labels chip row + "+ Label" dropdown
 * picker. Sits under the classification + state actions in ThreadPane.
 *
 * Each applied label is a clickable chip with an X — click to remove.
 * Removing mirrors to Gmail (removes the corresponding Gmail label
 * from the thread). The "+ Label" trigger opens a dropdown with all
 * the team's labels; clicking an unapplied one applies it (and
 * mirrors to Gmail by lazy-creating the link if needed).
 *
 * Optimistic updates: applying / removing flips the local state
 * immediately; if the server action returns an error we revert and
 * surface a small inline error.
 */

import { createTeamLabelAction } from "@/app/(admin)/admin/labels/_actions";
import { cn } from "@/lib/cn";
import { Loader2, Plus, Tag, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { applyLabelToThreadAction, removeLabelFromThreadAction } from "../_actions";

interface AppliedLabel {
  id: string;
  name: string;
  color: string | null;
  appliedVia: "manual" | "gmail" | "inherit";
}

interface TeamLabel {
  id: string;
  name: string;
  color: string | null;
}

const COLOR_CHIP: Record<string, string> = {
  emerald:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200",
  rose: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200",
  blue: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-200",
  amber:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200",
  violet:
    "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900/60 dark:bg-violet-950/40 dark:text-violet-200",
  sky: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200",
  orange:
    "border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-900/60 dark:bg-orange-950/40 dark:text-orange-200",
  yellow:
    "border-yellow-200 bg-yellow-50 text-yellow-800 dark:border-yellow-900/60 dark:bg-yellow-950/40 dark:text-yellow-200",
  zinc: "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300",
};

function chipClass(color: string | null): string {
  const zinc = COLOR_CHIP.zinc as string;
  if (!color) return zinc;
  return COLOR_CHIP[color] ?? zinc;
}

export function ThreadLabelsRow({
  threadId,
  applied,
  allTeamLabels,
}: {
  threadId: string;
  applied: AppliedLabel[];
  allTeamLabels: TeamLabel[];
}) {
  const [localApplied, setLocalApplied] = useState<AppliedLabel[]>(applied);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  // Live-managed list of labels; starts with the prop and grows when
  // the operator creates a new one inline.
  const [labels, setLabels] = useState<TeamLabel[]>(allTeamLabels);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [, startTx] = useTransition();
  const pickerRef = useRef<HTMLDivElement>(null);

  // Re-sync if the parent re-renders with new server data (e.g. after
  // a poll-worker run brought in a Gmail-applied label).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setLocalApplied(applied), [applied.map((a) => a.id).join(",")]);
  // Same sync for the labels list if a parent push brings new ones in.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setLabels(allTeamLabels), [allTeamLabels.map((l) => l.id).join(",")]);

  // Close picker on outside click.
  useEffect(() => {
    if (!pickerOpen) return;
    function onDown(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [pickerOpen]);

  function applyLabel(label: TeamLabel) {
    if (localApplied.some((l) => l.id === label.id)) {
      setPickerOpen(false);
      return;
    }
    setError(null);
    setPendingId(label.id);
    // Optimistic.
    setLocalApplied((prev) => [
      ...prev,
      { id: label.id, name: label.name, color: label.color, appliedVia: "manual" },
    ]);
    startTx(async () => {
      const fd = new FormData();
      fd.set("threadId", threadId);
      fd.set("teamLabelId", label.id);
      const result = await applyLabelToThreadAction(null, fd);
      setPendingId(null);
      if (!result.ok) {
        setLocalApplied((prev) => prev.filter((l) => l.id !== label.id));
        setError(result.error);
      }
    });
    setPickerOpen(false);
  }

  function removeLabel(labelId: string) {
    const previous = localApplied;
    setError(null);
    setPendingId(labelId);
    setLocalApplied((prev) => prev.filter((l) => l.id !== labelId));
    startTx(async () => {
      const fd = new FormData();
      fd.set("threadId", threadId);
      fd.set("teamLabelId", labelId);
      const result = await removeLabelFromThreadAction(null, fd);
      setPendingId(null);
      if (!result.ok) {
        setLocalApplied(previous);
        setError(result.error);
      }
    });
  }

  const unappliedLabels = labels.filter((l) => !localApplied.some((a) => a.id === l.id));

  async function createAndApply() {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("name", name);
      // Default color when created inline — operators can recolor
      // from the admin labels page later.
      fd.set("color", "blue");
      const res = await createTeamLabelAction(null, fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const newId = res.data.id;
      // Push into local state so the new label appears immediately
      // (server revalidatePath will eventually refresh too).
      const newLabel: TeamLabel = { id: newId, name, color: "blue" };
      setLabels((prev) => [...prev, newLabel]);
      setNewName("");
      // Auto-apply the just-created label to the current thread —
      // matches Gmail's behavior where typing into the "Create new"
      // input immediately tags the open conversation.
      applyLabel(newLabel);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <Tag className="h-3 w-3 text-zinc-400" aria-hidden="true" />
      {localApplied.length === 0 && <span className="text-xs text-zinc-500">No labels</span>}
      {localApplied.map((l) => (
        <span
          key={l.id}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium text-[11px]",
            chipClass(l.color),
          )}
          title={
            l.appliedVia === "gmail"
              ? "Synced from Gmail"
              : l.appliedVia === "inherit"
                ? "Inherited from thread"
                : "Applied manually"
          }
        >
          {l.name}
          <button
            type="button"
            onClick={() => removeLabel(l.id)}
            disabled={pendingId === l.id}
            className="rounded-full p-0.5 text-current opacity-60 hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
            aria-label={`Remove ${l.name}`}
          >
            {pendingId === l.id ? (
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
            ) : (
              <X className="h-2.5 w-2.5" />
            )}
          </button>
        </span>
      ))}
      <div className="relative" ref={pickerRef}>
        <button
          type="button"
          onClick={() => setPickerOpen((o) => !o)}
          className="inline-flex items-center gap-1 rounded-full border border-zinc-200 border-dashed px-2 py-0.5 font-medium text-[11px] text-zinc-600 hover:bg-zinc-50 hover:text-zinc-800 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
        >
          <Plus className="h-2.5 w-2.5" />
          Label
        </button>
        {pickerOpen && (
          <div className="absolute top-full left-0 z-20 mt-1 w-64 overflow-hidden rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
            {unappliedLabels.length > 0 && (
              <ul className="max-h-56 overflow-y-auto py-1">
                {unappliedLabels.map((l) => (
                  <li key={l.id}>
                    <button
                      type="button"
                      onClick={() => applyLabel(l)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-900"
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "inline-block h-2 w-2 rounded-full",
                          l.color === "emerald" && "bg-emerald-500",
                          l.color === "rose" && "bg-rose-500",
                          l.color === "blue" && "bg-blue-500",
                          l.color === "amber" && "bg-amber-500",
                          l.color === "violet" && "bg-violet-500",
                          l.color === "sky" && "bg-sky-500",
                          l.color === "orange" && "bg-orange-500",
                          l.color === "yellow" && "bg-yellow-500",
                          (!l.color || l.color === "zinc") && "bg-zinc-400",
                        )}
                      />
                      <span className="truncate">{l.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {labels.length > 0 && unappliedLabels.length === 0 && (
              <p className="px-3 py-2 text-xs text-zinc-500">All labels are already applied.</p>
            )}
            {/* Inline create — Gmail's pattern. Type a name, press Enter
                (or click +) to create-and-apply in one step. Any team
                operator can create labels — no admin gate. */}
            <div className="border-zinc-200 border-t bg-zinc-50/60 p-2 dark:border-zinc-800 dark:bg-zinc-900/40">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  createAndApply();
                }}
                className="flex items-center gap-1"
              >
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Create new label…"
                  className="flex-1 rounded border border-zinc-200 bg-white px-2 py-1 text-xs outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-500"
                  disabled={creating}
                />
                <button
                  type="submit"
                  disabled={!newName.trim() || creating}
                  className="rounded p-1 text-zinc-600 disabled:opacity-40 hover:bg-zinc-200 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-700"
                  aria-label="Create label"
                >
                  {creating ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Plus className="h-3 w-3" />
                  )}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
      {error && <span className="text-rose-700 text-xs dark:text-rose-400">{error}</span>}
    </div>
  );
}
