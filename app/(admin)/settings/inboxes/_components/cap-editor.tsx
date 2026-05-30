"use client";

/**
 * CapEditor — inline editor for the daily cold-send cap on a single
 * connected inbox.
 *
 * Display: "18 / 30 today" — current usage / configured cap. Click
 * the cap number to edit (input replaces the number). Enter or blur
 * commits; Escape reverts.
 *
 * Permission UX: the page only renders this component when the
 * current user is either the inbox owner or an admin. The server
 * action re-checks; we don't trust the client.
 */

import { cn } from "@/lib/cn";
import { Check, Loader2, X } from "lucide-react";
import { useState, useTransition } from "react";
import { setInboxCap } from "../_actions";

interface Props {
  inboxId: string;
  initialCap: number;
  /** Today's used count, if known. Optional — when omitted the
   *  display is just the cap with no "/ used" prefix. */
  usedToday?: number;
}

export function CapEditor({ inboxId, initialCap, usedToday }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(initialCap));
  const [cap, setCap] = useState(initialCap);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTx] = useTransition();

  function commit() {
    setError(null);
    const next = Number.parseInt(draft, 10);
    if (!Number.isFinite(next) || next < 0) {
      setError("Cap must be ≥ 0.");
      return;
    }
    if (next === cap) {
      setEditing(false);
      return;
    }
    const fd = new FormData();
    fd.set("id", inboxId);
    fd.set("cap", String(next));
    startTx(async () => {
      const result = await setInboxCap(null, fd);
      if (result.ok) {
        setCap(result.data.cap);
        setEditing(false);
      } else {
        setError(result.error);
      }
    });
  }

  function cancel() {
    setDraft(String(cap));
    setError(null);
    setEditing(false);
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(String(cap));
          setEditing(true);
        }}
        title="Click to edit the daily cold-send cap"
        className="font-mono text-[11px] text-zinc-600 tabular-nums underline-offset-2 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        {usedToday != null ? `${usedToday} / ${cap}` : `cap ${cap}`}
      </button>
    );
  }

  return (
    <div className="inline-flex items-center gap-1">
      <input
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        // biome-ignore lint/a11y/noAutofocus: deliberate — operator clicked to edit
        autoFocus
        min={0}
        max={200}
        disabled={isPending}
        className={cn(
          "w-14 rounded-sm border border-zinc-300 bg-white px-1 py-0.5 text-right font-mono text-[11px] tabular-nums focus:border-zinc-400 focus:outline-none",
          "dark:border-zinc-700 dark:bg-zinc-900",
        )}
      />
      <button
        type="button"
        onClick={commit}
        disabled={isPending}
        title="Save"
        className="rounded p-0.5 text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
      >
        {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
      </button>
      <button
        type="button"
        onClick={cancel}
        disabled={isPending}
        title="Cancel"
        className="rounded p-0.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        <X className="h-3 w-3" />
      </button>
      {error && <span className="text-[10px] text-rose-600 dark:text-rose-400">{error}</span>}
    </div>
  );
}
