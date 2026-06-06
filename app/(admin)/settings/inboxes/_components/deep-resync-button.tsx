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
 * Date range: the worker now honors an explicit window -- a Start date
 * maps to Gmail `after:` and an optional End date to `before:`, so the
 * operator can backfill a bounded historical span (not just
 * everything-through-today). Start-date-only ingests through now.
 *
 * Result rendering: collapses the dropdown and shows a one-line
 * outcome string with the worker's counts -- new messages ingested +
 * new threads, plus a "Scanned N, M already had, K errors" breakdown.
 * "Ingested" counts NEW rows written this run, so re-running on an
 * already-backfilled window correctly shows 0 ingested / all skipped.
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
        kind: "started";
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
            kind: "started",
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
      ? `\n\nThe engine will ingest only messages dated ${afterDate} through ${beforeDate}.`
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
              End date (optional)
              <input
                type="date"
                value={beforeDate}
                max={todayIso}
                onChange={(e) => setBeforeDate(e.target.value)}
                className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            <p className="text-[10px] text-zinc-400 leading-snug">
              Leave the end date blank to ingest from the start date through today, or set it to
              backfill a bounded historical window.
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
      {result?.kind === "started" && (
        <p className="max-w-xs text-right text-[10px] text-emerald-600 dark:text-emerald-400">
          {`Deep resync started ${
            result.afterDate
              ? `for ${result.afterDate}${result.beforeDate ? ` through ${result.beforeDate}` : ""} (~${result.daysBack} day${result.daysBack === 1 ? "" : "s"})`
              : `for the last ${result.daysBack} day${result.daysBack === 1 ? "" : "s"}`
          }. It runs in the background -- your mail appears over the next few minutes; no need to wait here.`}
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
