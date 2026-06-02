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
 * UI: button + dropdown with two ways to pick the backfill window:
 *   1. Preset day-windows (7/30/90/180/365).
 *   2. A custom date range (Start date / optional End date).
 *
 * Both fire a window.confirm with a clear explanation of what's about
 * to happen (re-fetch from Gmail; ingest dedupes on
 * (gmail_message_id, account) so it's safe but takes minutes for
 * larger windows). On confirm, the server action runs.
 *
 * Date-range caveat surfaced in the UI: the polling worker only
 * accepts a days-back lookback, so the engine derives days-back from
 * the Start date and always ingests through "now". An End date is
 * accepted but the engine does NOT stop at it -- we warn the operator
 * when they set one. (Enforcing an upper bound would require changing
 * the worker, which is out of scope for this control.)
 *
 * Result rendering: collapses the dropdown and shows a one-line
 * outcome string with the counts the worker exposes (messages
 * ingested + new threads) and the resolved window. NOTE: the worker's
 * result object only returns { messagesIngested, threadsCreated }; it
 * does NOT expose a messages-found / duplicates-skipped / errors /
 * rate-limited breakdown, so those can't be shown here without a
 * worker change. "Ingested" counts NEW rows written this run --
 * re-running on an already-backfilled window correctly shows 0.
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
  const [afterDate, setAfterDate] = useState("");
  const [beforeDate, setBeforeDate] = useState("");
  const [result, setResult] = useState<
    | {
        kind: "ok";
        messagesIngested: number;
        threadsCreated: number;
        daysBack: number;
        afterDate: string | null;
        beforeDate: string | null;
        beforeUnsupported: boolean;
      }
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

  // Today as YYYY-MM-DD for the date inputs' max attribute (no future
  // start dates). Local-time slice is fine -- the action re-validates.
  const todayIso = new Date().toISOString().slice(0, 10);

  function run(fd: FormData) {
    setOpen(false);
    setResult(null);
    startTransition(async () => {
      try {
        const r = await deepResyncInbox(null, fd);
        if (r.ok) {
          setResult({
            kind: "ok",
            messagesIngested: r.data.messagesIngested,
            threadsCreated: r.data.threadsCreated,
            daysBack: r.data.daysBack,
            afterDate: r.data.afterDate,
            beforeDate: r.data.beforeDate,
            beforeUnsupported: r.data.beforeUnsupported,
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

  function handlePickPreset(days: number) {
    const msg = `Deep-resync ${inboxEmail} for the last ${days} day${days === 1 ? "" : "s"}?\n\nThis clears the incremental cursor and re-fetches messages from Gmail. Existing messages are deduped, so re-ingesting is safe -- but it takes a few minutes for larger windows and uses Gmail API quota.\n\nAfter this finishes, normal polling resumes immediately.`;
    if (!window.confirm(msg)) return;
    const fd = new FormData();
    fd.set("id", inboxId);
    fd.set("daysBack", String(days));
    run(fd);
  }

  function handleRunCustom() {
    if (!afterDate) {
      setResult({ kind: "err", error: "Pick a start date for the custom window." });
      return;
    }
    if (beforeDate && beforeDate <= afterDate) {
      setResult({ kind: "err", error: "End date must be after the start date." });
      return;
    }
    const windowText = beforeDate ? `from ${afterDate} to ${beforeDate}` : `since ${afterDate}`;
    const beforeWarn = beforeDate
      ? "\n\nNote: the engine backfills by days-back from the start date and ingests through today -- the End date is NOT enforced, so messages after it will also be pulled."
      : "";
    const msg = `Deep-resync ${inboxEmail} ${windowText}?\n\nThis clears the incremental cursor and re-fetches messages from Gmail. Existing messages are deduped, so re-ingesting is safe -- but it takes a few minutes for larger windows and uses Gmail API quota.${beforeWarn}\n\nAfter this finishes, normal polling resumes immediately.`;
    if (!window.confirm(msg)) return;
    const fd = new FormData();
    fd.set("id", inboxId);
    fd.set("afterDate", afterDate);
    if (beforeDate) fd.set("beforeDate", beforeDate);
    run(fd);
  }

  return (
    <div className="relative inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        title="Backfill historical Gmail messages by re-running first-poll with a custom lookback window or date range"
        className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
      >
        {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <History className="h-3 w-3" />}
        Deep resync
      </button>
      {open && !pending && (
        <div className="absolute top-full right-0 z-10 mt-1 flex w-60 flex-col rounded-md border border-zinc-200 bg-white py-1 shadow-md dark:border-zinc-700 dark:bg-zinc-900">
          <p className="px-3 pt-1 pb-0.5 font-mono text-[10px] text-zinc-400 uppercase tracking-widest">
            Preset window
          </p>
          {PRESETS.map((p) => (
            <button
              key={p.days}
              type="button"
              onClick={() => handlePickPreset(p.days)}
              className="w-full px-3 py-1.5 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              Last {p.label}
            </button>
          ))}
          <div className="my-1 border-zinc-200 border-t dark:border-zinc-700" />
          <p className="px-3 pt-1 pb-0.5 font-mono text-[10px] text-zinc-400 uppercase tracking-widest">
            Custom range
          </p>
          <div className="flex flex-col gap-1.5 px-3 pt-1 pb-2">
            <label className="flex flex-col gap-0.5 text-[10px] text-zinc-500">
              Start date
              <input
                type="date"
                value={afterDate}
                max={todayIso}
                onChange={(e) => setAfterDate(e.target.value)}
                className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            <label className="flex flex-col gap-0.5 text-[10px] text-zinc-500">
              End date (optional, not enforced)
              <input
                type="date"
                value={beforeDate}
                max={todayIso}
                onChange={(e) => setBeforeDate(e.target.value)}
                className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            <p className="text-[10px] text-zinc-400 leading-snug">
              The engine backfills by days-back from the start date and ingests through today. An
              end date is accepted but not enforced.
            </p>
            <button
              type="button"
              onClick={handleRunCustom}
              disabled={!afterDate}
              className="mt-0.5 inline-flex items-center justify-center gap-1 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
            >
              Backfill this range
            </button>
          </div>
        </div>
      )}
      {result?.kind === "ok" && (
        <p className="max-w-xs text-right text-[10px] text-emerald-600 dark:text-emerald-400">
          {`Ingested ${result.messagesIngested} new message${result.messagesIngested === 1 ? "" : "s"} ${
            result.afterDate
              ? `since ${result.afterDate} (~${result.daysBack} day${result.daysBack === 1 ? "" : "s"})`
              : `from the last ${result.daysBack} day${result.daysBack === 1 ? "" : "s"}`
          }. ${result.threadsCreated} new thread${result.threadsCreated === 1 ? "" : "s"}.`}
          {result.beforeUnsupported && result.beforeDate
            ? ` End date ${result.beforeDate} was not applied -- the engine ingests through today.`
            : ""}
        </p>
      )}
      {result?.kind === "err" && (
        <p className="max-w-xs text-right text-[10px] text-rose-600 dark:text-rose-400">
          {result.error}
        </p>
      )}
    </div>
  );
}
