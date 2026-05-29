"use client";

/**
 * EscalationPopover — small modal that opens from the cold-outreach
 * row's "Escalate" button. Operator picks a staff member (defaulted
 * to the admin/lead) + types notes about what the venue wants to
 * discuss, then submits.
 *
 * The popover deliberately stays small + focused: one select + one
 * textarea + a submit button. No date picker (the notes field is
 * free-text — operators write "wants a call at 7pm Tue" and the
 * assignee sees that verbatim). Future iteration could parse the
 * datetime to populate due_at on the auto-task.
 */

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { escalateColdEntry } from "../_actions/escalation-actions";

interface EscalationTarget {
  id: string;
  displayName: string;
  role: string;
  primaryEmail: string;
}

interface Props {
  entryId: string;
  venueName: string;
  /** Pre-filled into notes — usually the existing remarks so the
   *  operator doesn't have to retype context. */
  initialNotes: string;
  targets: EscalationTarget[];
  onClose: () => void;
  onEscalated: () => void;
}

export function EscalationPopover({
  entryId,
  venueName,
  initialNotes,
  targets,
  onClose,
  onEscalated,
}: Props) {
  // Default to the first non-readonly staffer in the sorted list —
  // loadEscalationTargets sorts admin/lead first, so this lands on
  // Brandon when he's on the team.
  const defaultId = targets[0]?.id ?? "";
  const [staffId, setStaffId] = useState(defaultId);
  const [notes, setNotes] = useState(initialNotes);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTx] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click — same idiom as CallOutcomePopover. We
  // intentionally use pointerdown rather than click so the close
  // fires before any other UI consumes the event.
  useEffect(() => {
    function onPointer(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [onClose]);

  function handleSubmit() {
    setError(null);
    if (!staffId) {
      setError("Pick a staff member.");
      return;
    }
    if (notes.trim().length === 0) {
      setError("Add a short note about what the venue wants to discuss.");
      return;
    }
    startTx(async () => {
      const r = await escalateColdEntry({ entryId, staffId, notes: notes.trim() });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onEscalated();
      onClose();
    });
  }

  // Wrap the modal in createPortal so it renders at document.body
  // level instead of inside the caller's DOM context. Important because
  // ColdRow's table layout returns a <tr> — rendering the modal as a
  // sibling there would put non-tr content inside <tbody>, which the
  // browser rejects as invalid HTML. Portal sidesteps the entire
  // layout-context problem.
  //
  // SSR guard: createPortal requires `document`, which doesn't exist
  // during server render. The "use client" directive at the top means
  // the component only mounts client-side, but the useEffect ensures
  // we don't hit a portal call during the React hydration mismatch
  // check.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/30 p-4 backdrop-blur-sm">
      <div
        ref={ref}
        className={cn("card-surface w-full max-w-md p-5", "animate-[fade-in_200ms_ease-out]")}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="inline-flex items-center gap-2 font-semibold text-base tracking-tight">
              <AlertTriangle className="h-4 w-4 text-rose-500" />
              Escalate to senior staff
            </h3>
            <p className="mt-0.5 truncate text-xs text-zinc-500">{venueName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          <div>
            <label
              htmlFor="escalation-target"
              className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]"
            >
              Escalate to
            </label>
            <select
              id="escalation-target"
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
              className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
              {targets.length === 0 && <option value="">No eligible staff</option>}
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.displayName} ({t.role})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="escalation-notes"
              className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]"
            >
              What does the venue want to discuss?
            </label>
            <textarea
              id="escalation-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                'e.g. "wants a call at 7pm Tuesday — asking about insurance + cancellation policy"'
              }
              rows={5}
              className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
            />
            <p className="mt-1 text-[10px] text-zinc-500">
              The assignee sees this verbatim as the auto-task description.
            </p>
          </div>

          {error && (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-red-700 text-xs dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button type="button" size="sm" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={handleSubmit} disabled={pending}>
              {pending ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" /> Escalating…
                </>
              ) : (
                "Escalate"
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
