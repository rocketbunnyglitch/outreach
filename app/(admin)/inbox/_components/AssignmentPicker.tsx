"use client";

/**
 * AssignmentPicker — change the thread's assignee with one click.
 *
 * Loads team members lazily on first interaction (the `a` keyboard
 * shortcut fires the same open path), so threads that operators never
 * try to reassign don't pay a query cost.
 *
 * Behavior:
 *   - "Assigned to <name>" / "Unassigned" pill, click to open
 *   - Dropdown shows team members + "Unassign" option
 *   - Pick fires setThreadAssignment via useTransition; menu closes
 *     on success; router.refresh() pulls fresh ThreadPane.
 *   - The 'a' keyboard shortcut dispatched by InboxKeyboardNav opens
 *     the menu via document.addEventListener('inbox-assign').
 */

import { Check, ChevronDown, Loader2, UserCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { listTeamMembersForAssignment, setThreadAssignment } from "../_actions";

interface Props {
  threadId: string;
  currentAssignedStaffId: string | null;
  currentAssigneeName: string | null;
}

interface TeamMember {
  id: string;
  displayName: string | null;
  primaryEmail: string;
}

export function AssignmentPicker({ threadId, currentAssignedStaffId, currentAssigneeName }: Props) {
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [pending, startTx] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Click-outside close
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Listen for the 'a' keyboard shortcut bridge.
  useEffect(() => {
    function onAssign(e: Event) {
      const ce = e as CustomEvent<{ threadId?: string }>;
      if (ce.detail?.threadId && ce.detail.threadId !== threadId) return;
      setOpen(true);
    }
    document.addEventListener("inbox-assign", onAssign);
    return () => document.removeEventListener("inbox-assign", onAssign);
  }, [threadId]);

  // Lazy-load team members on first open.
  useEffect(() => {
    if (!open || members !== null) return;
    listTeamMembersForAssignment()
      .then((rows) => setMembers(rows))
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Couldn't load team");
        setMembers([]);
      });
  }, [open, members]);

  function pick(memberId: string | null) {
    setError(null);
    startTx(async () => {
      const fd = new FormData();
      fd.set("threadId", threadId);
      fd.set("assignedStaffId", memberId ?? "");
      const res = await setThreadAssignment(null, fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  const label = currentAssigneeName ?? "Unassigned";

  return (
    <div ref={wrapperRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2 py-1 font-mono text-[10px] text-zinc-700 uppercase tracking-widest hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        <UserCircle2 className="h-3 w-3 text-zinc-500" />
        {label}
        <ChevronDown className="h-3 w-3 text-zinc-500" />
      </button>
      {open && (
        <div className="absolute left-0 z-10 mt-1 w-56 rounded-md border border-zinc-200 bg-white shadow-md dark:border-zinc-700 dark:bg-zinc-900">
          {members === null ? (
            <div className="flex items-center justify-center px-3 py-4 text-xs text-zinc-500">
              <Loader2 className="h-3 w-3 animate-spin" />
            </div>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1">
              <li>
                <button
                  type="button"
                  onClick={() => pick(null)}
                  disabled={pending}
                  className="flex w-full items-center justify-between px-3 py-1.5 text-xs hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
                >
                  <span className="italic text-zinc-500">Unassign</span>
                  {currentAssignedStaffId === null && (
                    <Check className="h-3 w-3 text-emerald-500" />
                  )}
                </button>
              </li>
              {members.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => pick(m.id)}
                    disabled={pending}
                    className="flex w-full items-center justify-between px-3 py-1.5 text-xs hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
                  >
                    <span className="truncate text-left">{m.displayName ?? m.primaryEmail}</span>
                    {currentAssignedStaffId === m.id && (
                      <Check className="h-3 w-3 text-emerald-500" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error && (
            <p className="border-zinc-200 border-t px-3 py-2 text-[10px] text-rose-600 dark:border-zinc-700 dark:text-rose-300">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
