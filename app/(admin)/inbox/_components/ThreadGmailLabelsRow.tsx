"use client";
import { Loader2, Plus, Tag, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  applyGmailLabelToThreadAction,
  listGmailLabelsForThreadAction,
  removeGmailLabelFromThreadAction,
} from "../_actions";

interface GmailLabel {
  id: string;
  gmailLabelId: string;
  name: string;
  backgroundColor: string | null;
  textColor: string | null;
}

interface AppliedGmailLabel {
  /** The Gmail-side id (matches gmail_labels.gmail_label_id). */
  gmailLabelId: string;
  name: string;
  backgroundColor: string | null;
  textColor: string | null;
}

export function ThreadGmailLabelsRow({
  threadId,
  appliedGmailLabels,
}: {
  threadId: string;
  appliedGmailLabels: AppliedGmailLabel[];
}) {
  const [applied, setApplied] = useState<AppliedGmailLabel[]>(appliedGmailLabels);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [allLabels, setAllLabels] = useState<GmailLabel[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTx] = useTransition();
  const pickerRef = useRef<HTMLDivElement>(null);

  // Resync if the parent re-renders with new server data (poll
  // worker brought in a new label). Deliberately keying on
  // the joined gmailLabelIds rather than the array identity so we
  // don't loop on every parent rerender.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
  useEffect(
    () => setApplied(appliedGmailLabels),
    [appliedGmailLabels.map((a) => a.gmailLabelId).join(",")],
  );

  // Lazy-load the full picker list on first open. Cached after that.
  useEffect(() => {
    if (!pickerOpen || allLabels !== null) return;
    setLoading(true);
    listGmailLabelsForThreadAction(threadId)
      .then((res) => {
        if (res.ok) setAllLabels(res.data);
        else setError(res.error);
      })
      .finally(() => setLoading(false));
  }, [pickerOpen, allLabels, threadId]);

  // Outside-click close.
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

  function applyLabel(label: GmailLabel) {
    if (applied.some((a) => a.gmailLabelId === label.gmailLabelId)) {
      setPickerOpen(false);
      return;
    }
    setError(null);
    setPendingId(label.gmailLabelId);
    // Optimistic.
    setApplied((prev) => [
      ...prev,
      {
        gmailLabelId: label.gmailLabelId,
        name: label.name,
        backgroundColor: label.backgroundColor,
        textColor: label.textColor,
      },
    ]);
    startTx(async () => {
      const fd = new FormData();
      fd.set("threadId", threadId);
      // Pass the internal id; resolveContext on the server side
      // accepts either form.
      fd.set("gmailLabelId", label.id);
      const result = await applyGmailLabelToThreadAction(null, fd);
      setPendingId(null);
      if (!result.ok) {
        setApplied((prev) => prev.filter((a) => a.gmailLabelId !== label.gmailLabelId));
        setError(result.error);
      }
    });
    setPickerOpen(false);
  }

  function removeLabel(label: AppliedGmailLabel) {
    const previous = applied;
    setError(null);
    setPendingId(label.gmailLabelId);
    setApplied((prev) => prev.filter((a) => a.gmailLabelId !== label.gmailLabelId));
    startTx(async () => {
      const fd = new FormData();
      fd.set("threadId", threadId);
      fd.set("gmailLabelId", label.gmailLabelId);
      const result = await removeGmailLabelFromThreadAction(null, fd);
      setPendingId(null);
      if (!result.ok) {
        setApplied(previous);
        setError(result.error);
      }
    });
  }

  const unappliedLabels = (allLabels ?? []).filter(
    (l) => !applied.some((a) => a.gmailLabelId === l.gmailLabelId),
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
        <Tag className="h-3 w-3" />
        Gmail
      </span>
      {applied.map((label) => (
        <span
          key={label.gmailLabelId}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-[11px]"
          style={{
            backgroundColor: label.backgroundColor ?? "#f4f4f5",
            color: label.textColor ?? "#3f3f46",
          }}
        >
          {label.name}
          <button
            type="button"
            onClick={() => removeLabel(label)}
            disabled={pendingId === label.gmailLabelId}
            className="rounded-full p-0.5 text-current opacity-60 hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
            aria-label={`Remove ${label.name}`}
          >
            {pendingId === label.gmailLabelId ? (
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
          onClick={() => setPickerOpen((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md border border-zinc-200 border-dashed px-2 py-0.5 font-medium text-[11px] text-zinc-600 hover:bg-zinc-50 hover:text-zinc-800 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
        >
          <Plus className="h-2.5 w-2.5" />
          Gmail label
        </button>
        {pickerOpen && (
          <div className="absolute top-full left-0 z-20 mt-1 w-64 overflow-hidden rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
            {loading && (
              <p className="px-3 py-2 text-xs text-zinc-500">
                <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
                Loading Gmail labels…
              </p>
            )}
            {!loading && allLabels && allLabels.length === 0 && (
              <p className="px-3 py-2 text-xs text-zinc-500">
                No Gmail labels on this account. Create one in Gmail.
              </p>
            )}
            {!loading && unappliedLabels.length > 0 && (
              <ul className="max-h-64 overflow-y-auto py-1">
                {unappliedLabels.map((l) => (
                  <li key={l.id}>
                    <button
                      type="button"
                      onClick={() => applyLabel(l)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-900"
                    >
                      <span
                        aria-hidden="true"
                        className="inline-block h-2 w-2 rounded-sm border border-zinc-300 dark:border-zinc-700"
                        style={{
                          backgroundColor: l.backgroundColor ?? "transparent",
                        }}
                      />
                      <span className="truncate">{l.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!loading && allLabels && allLabels.length > 0 && unappliedLabels.length === 0 && (
              <p className="px-3 py-2 text-xs text-zinc-500">
                All Gmail labels are already applied.
              </p>
            )}
          </div>
        )}
      </div>
      {error && (
        <span className="text-rose-700 text-xs dark:text-rose-400">
          {error.includes("rejected") ? error : `Gmail: ${error}`}
        </span>
      )}
    </div>
  );
}
