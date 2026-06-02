"use client";

/**
 * Admin -> Google Sheets backup card.
 *
 * Surfaces the nightly Sheets backup on the cron-health page:
 *   - Last run status (success / error / running) + relative time
 *   - Link to the workbook on success, or the CSV-fallback path +
 *     error message on failure
 *   - "Export Now" button that triggers the backup on demand and
 *     polls the server for the new outcome
 *
 * The heavy lifting (data correctness, CSV fallback, Metadata tab)
 * lives in scripts/backup-to-sheets.ts. This card is the operator's
 * window into it.
 */

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { CheckCircle2, Clock, Download, ExternalLink, Loader2, XCircle } from "lucide-react";
import { useState, useTransition } from "react";
import type { SheetsBackupStatus } from "../_actions-sheets-backup";
import { getSheetsBackupStatus, runSheetsBackupNow } from "../_actions-sheets-backup";

interface Props {
  initial: SheetsBackupStatus;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const deltaSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (deltaSec < 60) return `${deltaSec}s ago`;
  const min = Math.floor(deltaSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export function SheetsBackupCard({ initial }: Props) {
  const [status, setStatus] = useState<SheetsBackupStatus>(initial);
  const [pending, startTx] = useTransition();
  const toast = useToast();

  const last = status.lastRun;
  let tone: "ok" | "error" | "warning" | "neutral" = "neutral";
  if (last?.status === "success") tone = "ok";
  else if (last?.status === "error") tone = "error";
  else if (last?.status === "running") tone = "warning";

  const borderClass =
    tone === "error"
      ? "border-rose-500/40"
      : tone === "warning"
        ? "border-amber-500/40"
        : tone === "ok"
          ? "border-emerald-500/30"
          : "border-zinc-200 dark:border-zinc-800";

  function refresh() {
    startTx(async () => {
      const next = await getSheetsBackupStatus();
      setStatus(next);
    });
  }

  function exportNow() {
    startTx(async () => {
      const res = await runSheetsBackupNow();
      if (!res.ok) {
        toast.show({ kind: "error", message: res.error });
        return;
      }
      toast.show({
        kind: "success",
        message: "Export started. Refresh in a few seconds to see the result.",
      });
      // Give the script a head start, then pull the new status once.
      setTimeout(async () => {
        const next = await getSheetsBackupStatus();
        setStatus(next);
      }, 4000);
    });
  }

  return (
    <article className={`rounded-xl border bg-white p-4 dark:bg-zinc-950 ${borderClass}`}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">Backup</p>
          <h2 className="mt-0.5 font-semibold text-base">Google Sheets snapshot</h2>
          <p className="mt-0.5 text-xs text-zinc-500">Nightly at 04:00 UTC. Ticket counts lead.</p>
        </div>
        <StatusBadge status={last?.status ?? null} />
      </header>

      {!status.configured && (
        <p className="mt-3 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          Not configured. Set SHEETS_BACKUP_SPREADSHEET_ID + SHEETS_BACKUP_CAMPAIGN_SLUG in the app
          environment.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
        {last ? (
          <>
            <span>
              Last:{" "}
              <span className="text-zinc-900 dark:text-zinc-100">
                {relativeTime(last.startedAt)}
              </span>
            </span>
            {last.destination && (
              <span>
                Wrote: <span className="text-zinc-900 dark:text-zinc-100">{last.destination}</span>
              </span>
            )}
            {last.cities !== null && (
              <span>
                <span className="text-zinc-900 dark:text-zinc-100">{last.cities}</span> cities
              </span>
            )}
            {last.events !== null && (
              <span>
                <span className="text-zinc-900 dark:text-zinc-100">{last.events}</span> events
              </span>
            )}
          </>
        ) : (
          <span className="text-zinc-500 italic">No backup has run yet.</span>
        )}
      </div>

      {last?.status === "error" && last.errorMessage && (
        <pre className="mt-3 max-h-28 overflow-auto rounded-md bg-rose-50 p-2 font-mono text-[11px] text-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          {last.errorMessage.split("\n").slice(0, 5).join("\n")}
        </pre>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={exportNow} disabled={pending || !status.configured}>
          {pending ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="mr-1 h-3.5 w-3.5" />
          )}
          Export now
        </Button>
        <Button size="sm" variant="outline" onClick={refresh} disabled={pending}>
          Refresh
        </Button>
        {last?.sheetUrl && (
          <a
            href={last.sheetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-blue-600 text-xs hover:underline dark:text-blue-400"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open sheet
          </a>
        )}
        {last?.csvPath && (
          <span className="inline-flex items-center gap-1 text-amber-700 text-xs dark:text-amber-300">
            <Clock className="h-3.5 w-3.5" />
            CSV fallback: {last.csvPath}
          </span>
        )}
      </div>
    </article>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (status === "success") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 font-medium text-[10px] text-emerald-800 uppercase tracking-widest dark:bg-emerald-900/40 dark:text-emerald-200">
        <CheckCircle2 className="h-3 w-3" />
        Success
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-rose-100 px-2 py-0.5 font-medium text-[10px] text-rose-800 uppercase tracking-widest dark:bg-rose-900/40 dark:text-rose-200">
        <XCircle className="h-3 w-3" />
        Error
      </span>
    );
  }
  if (status === "running") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-blue-100 px-2 py-0.5 font-medium text-[10px] text-blue-700 uppercase tracking-widest dark:bg-blue-900/40 dark:text-blue-300">
        <Loader2 className="h-3 w-3 animate-spin" />
        Running
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-0.5 font-medium text-[10px] text-zinc-600 uppercase tracking-widest dark:bg-zinc-800 dark:text-zinc-400">
      No data
    </span>
  );
}
