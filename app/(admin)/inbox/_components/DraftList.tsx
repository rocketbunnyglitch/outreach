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
 * Click a row to "Resume" — dispatches a `compose-email` CustomEvent
 * that the global ComposerHost (rendered in the admin layout) picks up
 * to mount the draft in the docked composer with mode='docked'. The
 * existing useDraftHydration handles the actual ComposerInstance
 * shape after the row click triggers an upsertDraft-loaded composer.
 *
 * Discard button per row deletes the draft + revalidates.
 */

import type { DraftListRow } from "@/lib/inbox-data";
import { AlarmClock, Inbox as InboxIcon, Loader2, Mail, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteDraft } from "../../_actions/email-drafts";

interface Props {
  drafts: DraftListRow[];
  mode: "drafts" | "scheduled";
  folderLabel: string;
}

export function DraftList({ drafts, mode, folderLabel }: Props) {
  const router = useRouter();
  const [pending, startTx] = useTransition();
  const [resumingId, setResumingId] = useState<string | null>(null);

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

  function resumeDraft(id: string) {
    // Open the global composer with the existing draft id. The ComposerHost
    // listens for 'compose-email' CustomEvents (back-compat with the old
    // AI-draft handoff flow) and useDraftHydration will load the draft
    // shape since it's already in email_drafts (sent_at IS NULL).
    setResumingId(id);
    window.dispatchEvent(new CustomEvent("compose-email", { detail: { draftId: id } }));
    // Tiny delay just so the spinner is visible during the dispatch round-trip.
    setTimeout(() => setResumingId(null), 400);
  }

  function handleDiscard(id: string) {
    if (!confirm("Discard this draft permanently?")) return;
    startTx(async () => {
      const res = await deleteDraft(id);
      if (res.ok) router.refresh();
    });
  }

  return (
    <ul className="flex flex-col">
      {drafts.map((d) => (
        <li
          key={d.id}
          className="group relative border-zinc-200/60 border-b transition-colors hover:bg-zinc-50 dark:border-zinc-800/40 dark:hover:bg-zinc-900/50"
        >
          <button
            type="button"
            onClick={() => resumeDraft(d.id)}
            disabled={resumingId === d.id}
            className="block w-full px-4 py-3 text-left"
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
            {d.snippet && <p className="mt-0.5 truncate text-[11px] text-zinc-500">{d.snippet}</p>}
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
      ))}
    </ul>
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
