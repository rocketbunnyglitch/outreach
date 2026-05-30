"use client";

/**
 * InboxKeyboardNav — mounts the inbox shortcut hook with j/k/?
 * bindings. Wired into the inbox layout so shortcuts work from
 * both the list view (/inbox) and the detail view (/inbox/[id]).
 *
 * Reply / archive / assign bindings live in components that have
 * direct refs (e.g. ReplyComposer for `r`); this component
 * handles list-level navigation + help only.
 */

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { SHORTCUT_HELP, useInboxShortcuts } from "./use-inbox-shortcuts";

interface Props {
  /** Ordered thread ids in the current list view. Used for j/k nav. */
  threadIds: string[];
  /** Currently-open thread id (when on /inbox/<id>). null on list view. */
  activeThreadId: string | null;
  /** Query string to preserve when navigating between threads. */
  preservedQuery?: string;
}

export function InboxKeyboardNav({ threadIds, activeThreadId, preservedQuery }: Props) {
  const router = useRouter();
  const [showHelp, setShowHelp] = useState(false);

  const navigate = useCallback(
    (delta: 1 | -1) => {
      if (threadIds.length === 0) return;
      const idx = activeThreadId ? threadIds.indexOf(activeThreadId) : -1;
      let next: number;
      if (idx === -1) {
        // Not on a specific thread yet — pick the first/last in the list.
        next = delta === 1 ? 0 : threadIds.length - 1;
      } else {
        next = Math.min(Math.max(idx + delta, 0), threadIds.length - 1);
        if (next === idx) return; // already at the edge
      }
      const target = threadIds[next];
      if (!target) return;
      const qs = preservedQuery ? `?${preservedQuery}` : "";
      router.push(`/inbox/${target}${qs}`);
    },
    [threadIds, activeThreadId, preservedQuery, router],
  );

  useInboxShortcuts({
    next: () => navigate(1),
    prev: () => navigate(-1),
    showHelp: () => setShowHelp(true),
  });

  if (!showHelp || typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) setShowHelp(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") setShowHelp(false);
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
              Keyboard
            </p>
            <h2 className="mt-1 font-semibold text-lg tracking-tight">Inbox shortcuts</h2>
          </div>
          <button
            type="button"
            onClick={() => setShowHelp(false)}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <ul className="flex flex-col gap-1.5">
          {SHORTCUT_HELP.map((s) => (
            <li key={s.keys} className="flex items-center justify-between gap-3">
              <span className="text-sm text-zinc-700 dark:text-zinc-300">{s.label}</span>
              <kbd className="rounded border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 font-mono text-[11px] text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                {s.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
