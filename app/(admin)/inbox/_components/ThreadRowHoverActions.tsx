"use client";

/**
 * ThreadRowHoverActions — Gmail-style row hover affordances. The
 * parent row applies group/row, this component renders icons that
 * appear via group-hover and cover the timestamp.
 *
 * Actions match Gmail's row hover set:
 *   - Archive  (state → archived)
 *   - Trash    (deleted_at set)
 *   - Mark Unread (unread_count → 1)
 *   - Snooze   (opens SnoozePopover anchored under the row icon)
 *
 * Each button stops event propagation so the wrapping row Link
 * doesn't navigate. Each action calls bulkUpdateThreads with the
 * single-thread id — that path is already team-scoped + auth-gated
 * and is the same code the persistent toolbar uses.
 *
 * Used by ThreadList; only rendered when the row isn't selected.
 */

import { AlarmClock, Archive, Loader2, MailOpen, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { bulkUpdateThreads } from "../_actions";
import { SnoozePopover } from "./SnoozePopover";

interface Props {
  threadId: string;
  /** When true, show Restore instead of Archive + Trash (Trash view). */
  isTrashView?: boolean;
  snoozeUntil: string | null;
}

export function ThreadRowHoverActions({ threadId, isTrashView, snoozeUntil }: Props) {
  const [pending, startTx] = useTransition();
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const router = useRouter();

  function fire(action: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (pending) return;
    if (action === "trash") {
      if (!confirm("Move this thread to Trash?")) return;
    }
    startTx(async () => {
      const fd = new FormData();
      fd.set("action", action);
      fd.set("threadIds", threadId);
      const res = await bulkUpdateThreads(null, fd);
      if (res.ok) router.refresh();
    });
  }

  return (
    <div
      className="hidden shrink-0 items-center gap-0.5 group-hover/row:flex"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // Don't propagate keypresses to the row Link either.
        e.stopPropagation();
      }}
    >
      {isTrashView ? (
        <HoverIcon
          onClick={(e) => fire("restore", e)}
          icon={<Archive className="h-3.5 w-3.5" />}
          label="Restore"
        />
      ) : (
        <>
          <HoverIcon
            onClick={(e) => fire("archive", e)}
            icon={<Archive className="h-3.5 w-3.5" />}
            label="Archive"
          />
          <HoverIcon
            onClick={(e) => fire("trash", e)}
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label="Trash"
            tone="rose"
          />
        </>
      )}
      <HoverIcon
        onClick={(e) => fire("mark_unread", e)}
        icon={<MailOpen className="h-3.5 w-3.5" />}
        label="Mark unread"
      />
      <div className="relative">
        <HoverIcon
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setSnoozeOpen((v) => !v);
          }}
          icon={<AlarmClock className="h-3.5 w-3.5" />}
          label="Snooze"
        />
        {snoozeOpen && (
          <SnoozePopover
            threadId={threadId}
            currentSnoozeUntil={snoozeUntil}
            onClose={() => setSnoozeOpen(false)}
            onSnoozed={() => router.refresh()}
          />
        )}
      </div>
      {pending && <Loader2 className="h-3 w-3 animate-spin text-zinc-400" aria-label="Working" />}
    </div>
  );
}

function HoverIcon({
  onClick,
  icon,
  label,
  tone,
}: {
  onClick: (e: React.MouseEvent) => void;
  icon: React.ReactNode;
  label: string;
  tone?: "rose";
}) {
  const cls =
    tone === "rose"
      ? "text-rose-600 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/30"
      : "text-zinc-500 hover:bg-zinc-200 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`rounded p-1 transition-colors ${cls}`}
    >
      {icon}
    </button>
  );
}
