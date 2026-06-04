"use client";

/**
 * DraftsList - the interactive rows for worklist Section 1 (Phase 2.2).
 *
 * "Review & send" dispatches the global `compose-email` event with the draft id;
 * the composer (mounted in the admin layout) loads it pre-filled, same path the
 * inbox draft list uses. Shows 10 rows with an expand toggle for the rest.
 *
 * Secondary "Schedule for tomorrow" is intentionally NOT wired yet: scheduled_for
 * drives the auto-send runner, so a one-click schedule would auto-send an
 * unreviewed engine draft. It lands once a worklist-snooze semantic (defer
 * without arming a send) is decided.
 */

import type { WorklistDraftRow } from "@/lib/worklist-data";
import { useState } from "react";

const PAGE_SIZE = 10;

export function DraftsList({ drafts }: { drafts: WorklistDraftRow[] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? drafts : drafts.slice(0, PAGE_SIZE);

  const openDraft = (id: string) => {
    window.dispatchEvent(new CustomEvent("compose-email", { detail: { draftId: id } }));
  };

  return (
    <div className="flex flex-col gap-2">
      {shown.map((d) => (
        <div
          key={d.id}
          className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 px-3 py-2.5 dark:border-zinc-800"
        >
          <div className="flex min-w-0 items-center gap-3">
            {d.templateCode ? (
              <span className="shrink-0 rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {d.templateCode}
              </span>
            ) : null}
            <div className="min-w-0">
              <p className="truncate font-medium text-sm">
                {d.venueName ?? d.toAddress ?? "(no venue)"}
                {d.cityName ? <span className="text-zinc-500"> · {d.cityName}</span> : null}
              </p>
              <p className="truncate text-xs text-zinc-500">
                {d.overdue ? <span className="font-medium text-amber-600">Overdue · </span> : null}
                {d.templateName ?? d.subject ?? "Draft"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => openDraft(d.id)}
            className="shrink-0 rounded-lg bg-zinc-900 px-3 py-1.5 text-white text-xs dark:bg-zinc-100 dark:text-zinc-900"
          >
            Review &amp; send
          </button>
        </div>
      ))}

      {drafts.length > PAGE_SIZE ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="self-start text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          {expanded ? "Show less" : `Show all (${drafts.length})`}
        </button>
      ) : null}
    </div>
  );
}
