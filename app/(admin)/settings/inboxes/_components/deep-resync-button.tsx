"use client";

import { History, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { deepResyncInbox } from "../_actions";

/**
 * Per-inbox "Deep resync" control on /settings/inboxes.
 *
 * Distinct from the existing Resync button, which uses the
 * incremental history cursor for fast catch-up. Deep resync nulls
 * the cursor and replays the first-poll branch with a custom
 * lookback window -- useful for backfilling more history than the
 * engine has ever seen on this account.
 *
 * UI: button + small dropdown of preset day-windows (7/30/90/180/365).
 * Picking an option fires a window.confirm with a clear explanation
 * of what's about to happen (re-fetch up to N days from Gmail; ingest
 * dedupes on (gmail_message_id, account) so it's safe but takes
 * minutes for larger windows). On confirm, the server action runs.
 *
 * Result rendering: collapses the dropdown and shows a one-line
 * outcome string ("Pulled N messages from the last N days; M new
 * threads created"). Refresh the page to see the new state in the
 * surrounding row.
 *
 * Auth: the server action gates on requireStaff + owner-only; this
 * component trusts the parent page to only render for the user's
 * own inboxes.
 */
export function DeepResyncButton({
  inboxId,
  inboxEmail,
}: {
  inboxId: string;
  inboxEmail: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<
    | { kind: "ok"; messagesIngested: number; threadsCreated: number; daysBack: number }
    | { kind: "err"; error: string }
    | null
  >(null);

  const PRESETS = [
    { days: 7, label: "7 days" },
    { days: 30, label: "30 days" },
    { days: 90, label: "90 days" },
    { days: 180, label: "180 days" },
    { days: 365, label: "1 year" },
  ];

  function handlePick(days: number) {
    const msg = `Deep-resync ${inboxEmail} for the last ${days} day${days === 1 ? "" : "s"}?\n\nThis clears the incremental cursor and re-fetches messages from Gmail. Existing messages are deduped, so re-ingesting is safe -- but it takes a few minutes for larger windows and uses Gmail API quota.\n\nAfter this finishes, normal polling resumes immediately.`;
    if (!window.confirm(msg)) return;
    setOpen(false);
    setResult(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("id", inboxId);
        fd.set("daysBack", String(days));
        const r = await deepResyncInbox(null, fd);
        if (r.ok) {
          setResult({
            kind: "ok",
            messagesIngested: r.data.messagesIngested,
            threadsCreated: r.data.threadsCreated,
            daysBack: r.data.daysBack,
          });
        } else {
          setResult({ kind: "err", error: r.error ?? "Deep resync failed" });
        }
      } catch (err) {
        setResult({
          kind: "err",
          error: err instanceof Error ? err.message : "Deep resync failed",
        });
      }
    });
  }

  return (
    <div className="relative inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        title="Backfill historical Gmail messages by re-running first-poll with a custom lookback window"
        className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
      >
        {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <History className="h-3 w-3" />}
        Deep resync
      </button>
      {open && !pending && (
        <div className="absolute top-full right-0 z-10 mt-1 flex flex-col rounded-md border border-zinc-200 bg-white py-1 shadow-md dark:border-zinc-700 dark:bg-zinc-900">
          {PRESETS.map((p) => (
            <button
              key={p.days}
              type="button"
              onClick={() => handlePick(p.days)}
              className="w-full px-3 py-1.5 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              Last {p.label}
            </button>
          ))}
        </div>
      )}
      {result?.kind === "ok" && (
        <p className="text-[10px] text-emerald-600 dark:text-emerald-400">
          {`Pulled ${result.messagesIngested} message${result.messagesIngested === 1 ? "" : "s"} from the last ${result.daysBack} day${result.daysBack === 1 ? "" : "s"}. ${result.threadsCreated} new thread${result.threadsCreated === 1 ? "" : "s"}.`}
        </p>
      )}
      {result?.kind === "err" && (
        <p className="max-w-xs text-[10px] text-rose-600 dark:text-rose-400">{result.error}</p>
      )}
    </div>
  );
}
