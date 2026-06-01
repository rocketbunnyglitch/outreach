"use client";

/**
 * EscalationStatusPopover — opens when the operator clicks the
 * amber "Escalated to X" pill. Shows the escalation context
 * (assignee + when + notes) and offers an "Un-escalate" button
 * to clear it.
 *
 * Closes the spec gap noted in cold-outreach-table.tsx ("popover
 * currently fire-and-forget"). The escalation pill was previously
 * a passive label; now it's a clickable view-and-resolve affordance.
 *
 * Auth: clearColdEntryEscalation re-checks requireStaff server-side.
 */

import { cn } from "@/lib/cn";
import { AlertTriangle, Loader2, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { clearColdEntryEscalation } from "../_actions/escalation-actions";

interface Props {
  entryId: string;
  escalatedToName: string;
  escalatedAt: string | null;
  escalationNotes: string | null;
  /** Anchor element — we position the popover below it. */
  anchorRect: DOMRect | null;
  onClose: () => void;
  onCleared: () => void;
}

export function EscalationStatusPopover({
  entryId,
  escalatedToName,
  escalatedAt,
  escalationNotes,
  anchorRect,
  onClose,
  onCleared,
}: Props) {
  const [pending, startTx] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointer(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [onClose]);

  // Esc closes.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleClear() {
    setError(null);
    startTx(async () => {
      const res = await clearColdEntryEscalation(entryId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onCleared();
      onClose();
    });
  }

  if (typeof document === "undefined") return null;

  // Position below the anchor pill. Fall back to a fixed center
  // when the anchor isn't available (initial render race).
  const top = anchorRect ? anchorRect.bottom + 4 : 100;
  const left = anchorRect ? anchorRect.left : 100;

  return createPortal(
    <div
      ref={ref}
      // biome-ignore lint/a11y/useSemanticElements: anchored popover, not modal dialog
      role="dialog"
      aria-label="Escalation status"
      style={{ top, left }}
      className={cn(
        "fixed z-[200] w-72 rounded-lg border border-zinc-200 bg-white p-3 shadow-xl",
        "dark:border-zinc-800 dark:bg-zinc-950",
      )}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-start gap-1.5 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
          <div className="min-w-0">
            <p className="font-medium">Escalated to {escalatedToName}</p>
            {escalatedAt && (
              <p className="text-[10px] text-zinc-500">{formatRelative(escalatedAt)}</p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      {escalationNotes && (
        <p className="mb-2 max-h-32 overflow-y-auto whitespace-pre-wrap rounded border border-zinc-100 bg-zinc-50 p-2 text-[11px] text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          {escalationNotes}
        </p>
      )}
      {error && <p className="mb-2 text-[10px] text-rose-600">{error}</p>}
      <button
        type="button"
        onClick={handleClear}
        disabled={pending}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1.5 font-medium text-emerald-800 text-xs hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-900/40 dark:bg-emerald-950 dark:text-emerald-200 dark:hover:bg-emerald-900/30"
      >
        {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
        Un-escalate
      </button>
    </div>,
    document.body,
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - then.getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return then.toLocaleDateString("en-US");
}
