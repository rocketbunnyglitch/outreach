"use client";
import { cn } from "@/lib/cn";
import { Loader2, Plus, Tag, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  applyGmailLabelToThreadAction,
  createAndApplyGmailLabelAction,
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
            {/* Inline create — name + Gmail-palette color picker.
                Bottom of the dropdown like the team-labels picker.
                Auto-applies to this thread on success. */}
            {!loading && allLabels !== null && (
              <CreateGmailLabelInline
                threadId={threadId}
                onCreated={(created) => {
                  setApplied((prev) => [...prev, created]);
                  // Force a refetch on next open so the new label
                  // shows up in unappliedLabels too if the operator
                  // wants to apply it to another thread.
                  setAllLabels(null);
                  setPickerOpen(false);
                }}
                onError={setError}
              />
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

/**
 * Inline create form for new Gmail labels. Color picker offers the
 * Gmail-supported palette (validated server-side via
 * isValidGmailLabelColor); non-palette choices aren't even rendered.
 * Empty palette selection means "no color" — valid for Gmail (the
 * label just renders neutral).
 */
function CreateGmailLabelInline({
  threadId,
  onCreated,
  onError,
}: {
  threadId: string;
  onCreated: (label: AppliedGmailLabel) => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState("");
  const [selectedPair, setSelectedPair] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    onError(""); // clear any prior error
    const pair = selectedPair !== null ? GMAIL_LABEL_PALETTE[selectedPair] : null;
    const fd = new FormData();
    fd.set("threadId", threadId);
    fd.set("name", trimmed);
    if (pair) {
      fd.set("backgroundColor", pair.background);
      fd.set("textColor", pair.text);
    }
    const result = await createAndApplyGmailLabelAction(null, fd);
    setCreating(false);
    if (result.ok) {
      onCreated({
        gmailLabelId: result.data.gmailLabelId,
        name: result.data.name,
        backgroundColor: pair?.background ?? null,
        textColor: pair?.text ?? null,
      });
      setName("");
      setSelectedPair(null);
    } else {
      onError(result.error);
    }
  }

  return (
    <div className="border-zinc-200 border-t bg-zinc-50/60 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/40">
      <p className="mb-1.5 font-mono text-[9px] text-zinc-500 uppercase tracking-widest">
        New Gmail label
      </p>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="e.g. Halloween 2026"
        className="w-full rounded border border-zinc-200 bg-white px-2 py-1 text-xs outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-200 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:ring-indigo-900/40"
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => setSelectedPair(null)}
          aria-label="No color"
          className={cn(
            "h-4 w-4 rounded-sm border",
            selectedPair === null
              ? "border-indigo-500 ring-1 ring-indigo-300 dark:ring-indigo-900/40"
              : "border-zinc-300 dark:border-zinc-700",
          )}
          title="No color"
        />
        {GMAIL_LABEL_PALETTE.map((p, i) => (
          <button
            key={p.background}
            type="button"
            onClick={() => setSelectedPair(i)}
            aria-label={`Color: ${p.background}`}
            className={cn(
              "h-4 w-4 rounded-sm border",
              selectedPair === i
                ? "border-indigo-500 ring-1 ring-indigo-300 dark:ring-indigo-900/40"
                : "border-zinc-200 dark:border-zinc-700",
            )}
            style={{ backgroundColor: p.background }}
            title={`${p.background} · ${p.text}`}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={submit}
        disabled={!name.trim() || creating}
        className="mt-2 inline-flex items-center gap-1 rounded bg-indigo-600 px-2 py-1 font-medium text-[11px] text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400"
      >
        {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
        Create + apply
      </button>
    </div>
  );
}

/**
 * Subset of Gmail's color palette exposed to the create UI. We
 * intentionally don't expose all ~25 pairs Gmail supports — the
 * picker would get unwieldy. Sticking to a useful coverage of the
 * common colors (greens, blues, purples, reds, oranges, neutrals).
 * Server-side validation in lib/gmail.isValidGmailLabelColor
 * accepts any of the full Gmail-supported set, so power users
 * can extend this list if they need more later.
 */
const GMAIL_LABEL_PALETTE: ReadonlyArray<{ background: string; text: string }> = [
  { background: "#16a766", text: "#ffffff" }, // green
  { background: "#43d692", text: "#ffffff" }, // mint
  { background: "#3c78d8", text: "#ffffff" }, // blue
  { background: "#4a86e8", text: "#ffffff" }, // azure
  { background: "#8e63ce", text: "#ffffff" }, // purple
  { background: "#cc3a21", text: "#ffffff" }, // red
  { background: "#e66550", text: "#ffffff" }, // coral
  { background: "#ffad47", text: "#ffffff" }, // orange
  { background: "#fbe983", text: "#684e07" }, // yellow
  { background: "#666666", text: "#ffffff" }, // grey
];
