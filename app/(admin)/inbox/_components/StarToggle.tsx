"use client";

/**
 * StarToggle — Gmail-style star button for a thread row.
 *
 * Click to toggle. Optimistic update for snappiness; server action
 * (setThreadStar) persists + revalidatePath syncs the rest of the UI.
 *
 * Used in:
 *   - ThreadList row (small, inline)
 *   - ThreadPane header (larger, alongside other thread actions)
 *
 * Auth re-checked server-side; team-scope guard prevents cross-team
 * star toggles. Star toggle is intentionally non-destructive so we
 * don't put it behind a confirm prompt.
 */

import { Star } from "lucide-react";
import { useCallback, useEffect, useState, useTransition } from "react";
import { setThreadStar } from "../_actions";

interface Props {
  threadId: string;
  initialStarred: boolean;
  /** "sm" for list rows (h-3.5 w-3.5) | "md" for header (h-4 w-4). */
  size?: "sm" | "md";
  /** Aria label override. */
  label?: string;
}

export function StarToggle({ threadId, initialStarred, size = "sm", label }: Props) {
  const [starred, setStarred] = useState(initialStarred);
  const [pending, startTx] = useTransition();
  const sizeClass = size === "md" ? "h-4 w-4" : "h-3.5 w-3.5";

  const toggle = useCallback(() => {
    if (pending) return;
    const next = !starred;
    setStarred(next); // optimistic
    startTx(async () => {
      const fd = new FormData();
      fd.set("threadId", threadId);
      fd.set("starred", String(next));
      const res = await setThreadStar(null, fd);
      if (!res.ok) {
        // Revert on failure.
        setStarred(!next);
      }
    });
  }, [pending, starred, threadId]);

  function handleClick(e: React.MouseEvent) {
    // Star clicks shouldn't navigate the wrapping row link.
    e.preventDefault();
    e.stopPropagation();
    toggle();
  }

  // Keyboard-binding bridge: InboxKeyboardNav dispatches
  // `inbox-toggle-star` when the operator presses `s`. We mount
  // listeners on every visible StarToggle so the active thread's
  // toggle handles its own event. The threadId in detail.threadId
  // gates per-instance so the list view's many StarToggles don't
  // all fire when only one thread is active.
  //
  // Only the "md" sized toggle (the header one in ThreadPane)
  // responds, not the per-row "sm" toggles in the list. Otherwise
  // pressing `s` while viewing a thread would also toggle the same
  // thread's row star in the list pane (which the list-row toggle
  // is mounted from). Both fire; both are idempotent; but it would
  // double the server roundtrip. Restricting to "md" guarantees
  // single-fire from the thread-pane header.
  useEffect(() => {
    if (size !== "md") return;
    function onToggleStar(e: Event) {
      const detail = (e as CustomEvent<{ threadId: string }>).detail;
      if (detail?.threadId !== threadId) return;
      toggle();
    }
    document.addEventListener("inbox-toggle-star", onToggleStar);
    return () => document.removeEventListener("inbox-toggle-star", onToggleStar);
  }, [size, threadId, toggle]);

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={label ?? (starred ? "Unstar thread" : "Star thread")}
      title={starred ? "Starred — click to unstar" : "Star this thread"}
      className="shrink-0 rounded p-0.5 text-zinc-300 transition-colors hover:text-amber-500 dark:text-zinc-600"
    >
      <Star
        className={`${sizeClass} ${starred ? "fill-amber-400 text-amber-500" : "text-current"}`}
      />
    </button>
  );
}
