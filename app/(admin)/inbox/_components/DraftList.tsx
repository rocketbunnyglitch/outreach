"use client";

/**
 * DraftList — middle pane for the Drafts + Scheduled mailbox folders.
 * Renders a Gmail-shaped row per draft with:
 *
 *   - Subject (or "(no subject)" placeholder)
 *   - First-line snippet
 *   - To addresses (truncated)
 *   - Scheduled-for / updated-at timestamp on the right
 *
 * Selection model (matches ThreadListWithBulk):
 *   - Sticky top toolbar with master select-all checkbox + Refresh
 *   - When >=1 selected: "{N} selected" + Discard (rose) bulk action
 *   - Per-row checkbox; selected rows tint indigo
 *
 * Click anywhere else on a row to "Resume" — dispatches a
 * `compose-email` CustomEvent that the global ComposerHost picks up.
 *
 * Discard button per row (rose icon) appears on hover for single-row
 * delete; bulk Discard handles multi-select via the toolbar.
 */

import type { DraftListRow } from "@/lib/inbox-data";
import { AlarmClock, Inbox as InboxIcon, Loader2, Mail, RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { bulkDeleteDrafts, deleteDraft } from "../../_actions/email-drafts";

interface Props {
  drafts: DraftListRow[];
  mode: "drafts" | "scheduled";
  folderLabel: string;
}

export function DraftList({ drafts, mode, folderLabel }: Props) {
  const router = useRouter();
  const [pending, startTx] = useTransition();
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function resumeDraft(id: string) {
    setResumingId(id);
    window.dispatchEvent(new CustomEvent("compose-email", { detail: { draftId: id } }));
    setTimeout(() => setResumingId(null), 400);
  }

  function handleDiscard(id: string) {
    if (!confirm("Discard this draft permanently?")) return;
    startTx(async () => {
      const res = await deleteDraft(id);
      if (res.ok) {
        // Also remove from selection if present.
        setSelected((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        router.refresh();
      }
    });
  }

  function toggleAll() {
    if (selected.size === drafts.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(drafts.map((d) => d.id)));
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

  function handleBulkDiscard() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const label = mode === "scheduled" ? "scheduled email" : "draft";
    const plural = ids.length === 1 ? "" : "s";
    if (!confirm(`Discard ${ids.length} ${label}${plural} permanently?`)) return;
    startTx(async () => {
      const res = await bulkDeleteDrafts(ids);
      if (res.ok) {
        setSelected(new Set());
        router.refresh();
      } else {
        alert(res.error);
      }
    });
  }

  const allChecked = drafts.length > 0 && selected.size === drafts.length;
  const someChecked = selected.size > 0 && selected.size < drafts.length;

  if (drafts.length === 0) {
    return (
      <div className="p-6 text-center">
        <InboxIcon className="mx-auto h-7 w-7 text-zinc-400" />
        <h3 className="mt-3 font-semibold text-lg tracking-tight">{folderLabel}</h3>
        <p className="mt-1 text-xs text-zinc-500">
          {mode === "scheduled"
            ? "No scheduled emails. Compose a message and pick a future time to schedule."
            : "No drafts. Anything you start writing in the composer will autosave here."}
        </p>
      </div>
    );
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
            aria-label={allChecked ? "Deselect all drafts" : "Select all drafts"}
            className="h-3.5 w-3.5 cursor-pointer"
          />
        </label>
        <button
          type="button"
          onClick={() => router.refresh()}
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
            <button
              type="button"
              onClick={handleBulkDiscard}
              disabled={pending}
              title="Discard selected"
              aria-label="Discard selected"
              className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-rose-700 text-xs hover:bg-rose-50 disabled:opacity-50 dark:text-rose-300 dark:hover:bg-rose-950/30"
            >
              {pending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">Discard</span>
            </button>
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
      <ul className="flex flex-col">
        {drafts.map((d) => {
          const isSelected = selected.has(d.id);
          return (
            <li
              key={d.id}
              className={`group relative border-zinc-200/60 border-b transition-colors dark:border-zinc-800/40 ${
                isSelected
                  ? "bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/30 dark:hover:bg-indigo-950/50"
                  : "hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
              }`}
            >
              <div className="flex items-start gap-2 px-4 py-3">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleOne(d.id)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Select draft ${d.subject}`}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer"
                />
                <button
                  type="button"
                  onClick={() => resumeDraft(d.id)}
                  disabled={resumingId === d.id}
                  className="block min-w-0 flex-1 text-left"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="min-w-0 flex-1 truncate font-medium text-sm">
                      {d.toAddresses.length > 0 ? d.toAddresses.join(", ") : "(no recipient yet)"}
                    </p>
                    <time
                      dateTime={(d.scheduledFor ?? d.updatedAt).toISOString()}
                      className="shrink-0 font-mono text-[10px] text-zinc-500 tabular-nums"
                    >
                      {mode === "scheduled" && d.scheduledFor
                        ? formatScheduled(d.scheduledFor)
                        : formatRelative(d.updatedAt)}
                    </time>
                  </div>
                  <p
                    className={`mt-0.5 truncate text-xs ${
                      d.subject === "(no subject)"
                        ? "text-zinc-400 italic"
                        : "text-zinc-700 dark:text-zinc-300"
                    }`}
                  >
                    {d.subject}
                  </p>
                  {d.snippet && (
                    <p className="mt-0.5 truncate text-[11px] text-zinc-500">{d.snippet}</p>
                  )}
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-zinc-500">
                    {mode === "scheduled" && (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-blue-50 px-1.5 py-0.5 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">
                        <AlarmClock className="h-2.5 w-2.5" />
                        Scheduled
                      </span>
                    )}
                    {d.fromEmailAddress && (
                      <span className="inline-flex items-center gap-0.5 truncate">
                        <Mail className="h-2.5 w-2.5" />
                        {d.fromEmailAddress}
                      </span>
                    )}
                    {d.venueName && <span className="truncate">· {d.venueName}</span>}
                  </div>
                </button>
              </div>
              <button
                type="button"
                onClick={() => handleDiscard(d.id)}
                disabled={pending}
                title="Discard draft"
                aria-label="Discard draft"
                className="absolute top-2 right-2 rounded p-1 text-zinc-400 opacity-0 transition-opacity hover:bg-zinc-200 hover:text-rose-700 disabled:opacity-50 group-hover:opacity-100 dark:hover:bg-zinc-800 dark:hover:text-rose-300"
              >
                {pending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3" />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function formatRelative(d: Date): string {
  const diff = Date.now() - d.getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

function formatScheduled(d: Date): string {
  const now = Date.now();
  const diff = d.getTime() - now;
  if (diff < 0) return "(overdue)";
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
