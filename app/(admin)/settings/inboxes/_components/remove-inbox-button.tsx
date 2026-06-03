"use client";

/**
 * RemoveInboxButton — PERMANENTLY removes a connected inbox (deletes the
 * connected_accounts row), as opposed to Disconnect (keeps the row + history,
 * just stops syncing). Two-step inline confirm — no accidental one-click
 * deletes, and no jarring native confirm() dialog. Calls
 * removeInboxPermanently, which detaches the account's conversations and
 * deletes the row; on success the row revalidates away.
 */

import { Loader2, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { removeInboxPermanently } from "../_actions";

export function RemoveInboxButton({
  inboxId,
  inboxEmail,
}: {
  inboxId: string;
  inboxEmail: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTx] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function remove() {
    setError(null);
    startTx(async () => {
      const fd = new FormData();
      fd.set("id", inboxId);
      const res = await removeInboxPermanently(null, fd);
      if (res && !res.ok) {
        setError(res.error ?? "Remove failed.");
        setConfirming(false);
      }
      // On success the page revalidates and this row disappears.
    });
  }

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="text-[11px] text-zinc-500">Remove permanently?</span>
        <button
          type="button"
          disabled={pending}
          onClick={remove}
          className="inline-flex items-center gap-1 rounded-md border border-rose-600 bg-rose-600 px-2.5 py-1.5 font-medium text-white text-xs hover:bg-rose-700 disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
          Yes, remove
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setConfirming(false)}
          className="rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={() => setConfirming(true)}
        title={`Permanently remove ${inboxEmail} — deletes the account and removes its conversations from the inbox. Re-add it later to re-sync.`}
        className="inline-flex items-center gap-1 rounded-md border border-rose-300 bg-white px-3 py-1.5 text-rose-700 text-xs hover:bg-rose-50 dark:border-rose-900/50 dark:bg-zinc-900 dark:text-rose-400 dark:hover:bg-rose-950/30"
      >
        <Trash2 className="h-3 w-3" />
        Remove
      </button>
      {error && <span className="text-[10px] text-rose-600 dark:text-rose-400">{error}</span>}
    </span>
  );
}
