"use client";

/**
 * ThreadListWithBulk — wraps ThreadList with selection state + a
 * persistent top toolbar. Visual model is Gmail's middle pane:
 *
 *   [Persistent toolbar]
 *     - select-all checkbox (master toggle for the current page)
 *     - Refresh button
 *     - When ≥1 selected: Archive | Trash | Star | Unstar |
 *                          Mark read | Mark unread | More menu
 *   [Thread row 0]
 *     - per-row checkbox + star + sender/subject
 *   [Thread row 1]
 *   ...
 *
 * The wrapping component owns Set<threadId> for the selection. Per-row
 * checkboxes call onToggle(id). Master checkbox cycles
 * none → all → none. Toolbar fires bulkUpdateThreads on the selection.
 */

import type { InboxThreadRow } from "@/lib/inbox-data";
import {
  Archive,
  Check,
  ChevronDown,
  Inbox,
  Loader2,
  Mail,
  MailOpen,
  RefreshCw,
  Star,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { bulkUpdateThreads } from "../_actions";
import { ThreadList } from "./ThreadList";

interface Props {
  threads: InboxThreadRow[];
  activeThreadId: string | null;
  folderLabel: string;
  preservedQuery: string;
  /** "trash" view shows Restore instead of Trash + Archive. */
  isTrashView?: boolean;
  /** "archive" view shows "Move to Inbox" (unarchive) instead of Archive. */
  isArchiveView?: boolean;
}

export function ThreadListWithBulk({
  threads,
  activeThreadId,
  folderLabel,
  preservedQuery,
  isTrashView,
  isArchiveView,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTx] = useTransition();
  const router = useRouter();

  const allChecked = threads.length > 0 && selected.size === threads.length;
  const someChecked = selected.size > 0 && selected.size < threads.length;

  function toggleAll() {
    if (selected.size === threads.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(threads.map((t) => t.id)));
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function applyBulk(action: string) {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (action === "trash") {
      if (!confirm(`Move ${ids.length} thread${ids.length === 1 ? "" : "s"} to Trash?`)) {
        return;
      }
    }
    startTx(async () => {
      const fd = new FormData();
      fd.set("action", action);
      fd.set("threadIds", ids.join(","));
      const res = await bulkUpdateThreads(null, fd);
      if (res.ok) {
        setSelected(new Set());
        router.refresh();
      } else {
        alert(res.error);
      }
    });
  }

  function refresh() {
    router.refresh();
  }

  return (
    <>
      <div className="sticky top-0 z-10 flex items-center gap-1.5 border-zinc-200/80 border-b bg-white/95 px-3 py-1.5 backdrop-blur-md dark:border-zinc-800/60 dark:bg-zinc-950/80">
        <label className="flex shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-900">
          <input
            type="checkbox"
            checked={allChecked}
            ref={(el) => {
              if (el) el.indeterminate = someChecked;
            }}
            onChange={toggleAll}
            aria-label={allChecked ? "Deselect all threads" : "Select all threads"}
            className="h-3.5 w-3.5 cursor-pointer"
          />
        </label>
        <button
          type="button"
          onClick={refresh}
          title="Refresh"
          aria-label="Refresh"
          className="shrink-0 rounded p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900"
        >
          <RefreshCw className="h-3.5 w-3.5 text-zinc-500" />
        </button>

        {selected.size > 0 && (
          <>
            <span className="mx-1.5 h-4 w-px bg-zinc-200 dark:bg-zinc-800" />
            <span className="shrink-0 font-mono text-[10px] text-zinc-500 tabular-nums">
              {selected.size} selected
            </span>
            {!isTrashView && !isArchiveView && (
              <ToolbarButton
                onClick={() => applyBulk("archive")}
                disabled={pending}
                icon={<Archive className="h-3.5 w-3.5" />}
                label="Archive"
              />
            )}
            {isArchiveView && (
              <ToolbarButton
                onClick={() => applyBulk("unarchive")}
                disabled={pending}
                icon={<Inbox className="h-3.5 w-3.5" />}
                label="Move to Inbox"
              />
            )}
            {isTrashView ? (
              <ToolbarButton
                onClick={() => applyBulk("restore")}
                disabled={pending}
                icon={<Check className="h-3.5 w-3.5" />}
                label="Restore"
              />
            ) : (
              <ToolbarButton
                onClick={() => applyBulk("trash")}
                disabled={pending}
                icon={<Trash2 className="h-3.5 w-3.5" />}
                label="Trash"
                tone="rose"
              />
            )}
            <ToolbarButton
              onClick={() => applyBulk("star")}
              disabled={pending}
              icon={<Star className="h-3.5 w-3.5" />}
              label="Star"
            />
            <ToolbarButton
              onClick={() => applyBulk("mark_read")}
              disabled={pending}
              icon={<MailOpen className="h-3.5 w-3.5" />}
              label="Read"
            />
            <ToolbarButton
              onClick={() => applyBulk("mark_unread")}
              disabled={pending}
              icon={<Mail className="h-3.5 w-3.5" />}
              label="Unread"
            />
            <MoreMenu
              onAction={(a) => applyBulk(a)}
              disabled={pending}
              isTrashView={!!isTrashView}
            />
          </>
        )}

        <div className="ml-auto flex items-center gap-2 pl-2">
          {pending && (
            <Loader2 className="h-3 w-3 animate-spin text-zinc-500" aria-label="Working" />
          )}
          <span className="shrink-0 font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
            {folderLabel}
          </span>
        </div>
      </div>

      <ThreadList
        threads={threads}
        activeThreadId={activeThreadId}
        folderLabel={folderLabel}
        preservedQuery={preservedQuery}
        selectedIds={selected}
        onToggleSelect={toggleOne}
        isTrashView={isTrashView}
      />
    </>
  );
}

function ToolbarButton({
  onClick,
  disabled,
  icon,
  label,
  tone,
}: {
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  tone?: "rose";
}) {
  const toneClass =
    tone === "rose"
      ? "text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/30"
      : "hover:bg-zinc-100 dark:hover:bg-zinc-900";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs disabled:opacity-50 ${toneClass}`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function MoreMenu({
  onAction,
  disabled,
  isTrashView,
}: {
  onAction: (action: string) => void;
  disabled: boolean;
  isTrashView: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-label="More bulk actions"
        title="More"
        className="inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-1 text-xs hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-900"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div
          // biome-ignore lint/a11y/useSemanticElements: anchored menu pattern
          role="menu"
          tabIndex={-1}
          className="absolute top-full right-0 z-20 mt-1 w-44 rounded-md border border-zinc-200 bg-white py-1 shadow-md dark:border-zinc-800 dark:bg-zinc-950"
        >
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onAction("unstar");
            }}
            className="block w-full px-3 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            Unstar selected
          </button>
          {!isTrashView && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onAction("trash");
              }}
              className="block w-full px-3 py-1.5 text-left text-rose-700 text-xs hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/30"
            >
              Move to Trash
            </button>
          )}
        </div>
      )}
    </div>
  );
}
