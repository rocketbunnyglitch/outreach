/**
 * /admin/cron-health -- observability dashboard for the eight cron
 * routes in app/api/cron/*. Reads from cron_runs (populated by
 * lib/cron-runs.ts#recordCronRun, which wraps every cron route).
 *
 * Three things this page answers at a glance:
 *
 *   1. "Are all crons running?" -- per-cron card shows the last
 *      run timestamp + status. A card with last-run > expected
 *      cadence is the "silently stopped" failure mode.
 *
 *   2. "Are any crons failing?" -- error rows surface in red with
 *      the captured error message inline.
 *
 *   3. "Is anything slow?" -- per-cron average duration over the
 *      last 10 runs. A 4x jump from baseline is the cue to dig.
 *
 * Admin-only. Force-dynamic since the freshness of the data is
 * itself the point of the page.
 */

import { cronRuns } from "@/db/schema/cron-runs";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { AlertTriangle, CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import Link from "next/link";
import { getSheetsBackupStatus } from "../_actions-sheets-backup";
import { SheetsBackupCard } from "../_components/sheets-backup-card";

export const metadata = { title: "Cron health · Admin" };
export const dynamic = "force-dynamic";

/** Canonical list of crons we track. If a cron route is added, add it here.
 *  A cron listed here with "no run in 24h" is ITSELF a finding — it means
 *  the route exists but the crontab entry is missing or broken. */
const CRON_NAMES = [
  "gmail-poll",
  "stale-tagger",
  "follow-up-cadence",
  "scheduled-sends",
  "inbox-alerts",
  "inbox-daily-stats",
  "daily-digest",
  "eventbrite-sync",
  "cadence-advance",
  "cancellation-review",
  "relationship-decay",
  "reply-corpus",
  "aging-watchdog",
  "deliverability-watchdog",
] as const;

interface CronCardData {
  name: string;
  lastRun: {
    status: "running" | "success" | "error";
    startedAt: Date;
    durationMs: number | null;
    errorMessage: string | null;
  } | null;
  /** Last 10 runs, most-recent first. Each entry is just a status
   *  for the dot strip. */
  recentStatuses: Array<"running" | "success" | "error">;
  /** Average duration of the last 10 successful runs. */
  avgSuccessMs: number | null;
  /** Count of error runs in the last 24h. */
  errorsLast24h: number;
}

export default async function CronHealthPage() {
  await requireAdmin();

  const cards = await Promise.all(CRON_NAMES.map(loadCronCard));
  const sheetsBackup = await getSheetsBackupStatus();

  // Email-ops vitals (2026-06-11 audit: integration health in one
  // place so nothing fails silently). Cheap aggregates, one query each.
  const opsRes = await db.execute<{
    connected: number;
    needs_reauth: number;
    reauth_list: string | null;
    queued: number;
    failing: number;
    oldest_queued_hours: number | null;
  }>(sql`
    SELECT
      (SELECT count(*)::int FROM connected_accounts WHERE status = 'connected') AS connected,
      (SELECT count(*)::int FROM connected_accounts WHERE status = 'needs_reauth') AS needs_reauth,
      (SELECT string_agg(email_address, ', ') FROM connected_accounts WHERE status = 'needs_reauth') AS reauth_list,
      (SELECT count(*)::int FROM email_drafts WHERE sent_at IS NULL AND scheduled_for IS NOT NULL) AS queued,
      (SELECT count(*)::int FROM email_drafts WHERE sent_at IS NULL AND scheduled_for < now() - interval '1 hour' AND COALESCE(send_attempts, 0) > 0) AS failing,
      (SELECT EXTRACT(EPOCH FROM (now() - min(scheduled_for)))::int / 3600 FROM email_drafts WHERE sent_at IS NULL AND scheduled_for IS NOT NULL) AS oldest_queued_hours
  `);
  type OpsRow = {
    connected: number;
    needs_reauth: number;
    reauth_list: string | null;
    queued: number;
    failing: number;
    oldest_queued_hours: number | null;
  };
  const ops: OpsRow = (Array.isArray(opsRes)
    ? (opsRes as unknown as OpsRow[])
    : ((opsRes as unknown as { rows?: OpsRow[] }).rows ?? []))[0] ?? {
    connected: 0,
    needs_reauth: 0,
    reauth_list: null,
    queued: 0,
    failing: 0,
    oldest_queued_hours: null,
  };

  // Treat a 'running' row with started_at > 30 min ago as a stuck
  // run. The dashboard surfaces this as a warning even though the
  // row hasn't been marked error.
  const stuckMs = 30 * 60 * 1000;
  const now = Date.now();
  const stuckCount = cards.filter(
    (c) => c.lastRun?.status === "running" && now - c.lastRun.startedAt.getTime() > stuckMs,
  ).length;
  const errorCount = cards.filter((c) => c.lastRun?.status === "error").length;
  const noRecentRunCount = cards.filter(
    (c) => c.lastRun === null || now - c.lastRun.startedAt.getTime() > 24 * 60 * 60 * 1000,
  ).length;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          &larr; Admin
        </Link>
        <h1 className="mt-2 font-semibold text-4xl tracking-tight">System health</h1>
        <p className="text-sm text-zinc-500">
          Observability for every cron route in app/api/cron/* plus email-ops vitals (inbox
          connections, the scheduled-send queue, backups). A tracked cron with no run in 24h means
          its crontab entry is missing — that is itself a finding. Refreshes on page load.
        </p>
      </header>

      {/* Top totals */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Tracked crons"
          value={String(CRON_NAMES.length)}
          tone="neutral"
          icon={<Clock className="h-4 w-4" />}
        />
        <StatCard
          label="Currently failing"
          value={String(errorCount)}
          tone={errorCount > 0 ? "error" : "neutral"}
          icon={<XCircle className="h-4 w-4" />}
        />
        <StatCard
          label="Stuck > 30 min"
          value={String(stuckCount)}
          tone={stuckCount > 0 ? "warning" : "neutral"}
          icon={<AlertTriangle className="h-4 w-4" />}
        />
        <StatCard
          label="No run in 24h"
          value={String(noRecentRunCount)}
          tone={noRecentRunCount > 0 ? "warning" : "neutral"}
          icon={<Clock className="h-4 w-4" />}
        />
      </section>

      {/* Email-ops vitals (2026-06-11): the non-cron half of system
          health — inbox connections + the scheduled-send queue. */}
      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-lg tracking-tight">Email ops</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="Inboxes connected"
            value={String(ops.connected)}
            tone="neutral"
            icon={<CheckCircle2 className="h-4 w-4" />}
          />
          <StatCard
            label="Needs reauth"
            value={String(ops.needs_reauth)}
            tone={ops.needs_reauth > 0 ? "warning" : "neutral"}
            icon={<AlertTriangle className="h-4 w-4" />}
          />
          <StatCard
            label="Queued sends"
            value={String(ops.queued)}
            tone="neutral"
            icon={<Clock className="h-4 w-4" />}
          />
          <StatCard
            label="Failing in queue"
            value={String(ops.failing)}
            tone={ops.failing > 0 ? "error" : "neutral"}
            icon={<XCircle className="h-4 w-4" />}
          />
        </div>
        {ops.needs_reauth > 0 && ops.reauth_list && (
          <p className="text-xs text-zinc-500">
            Reconnect needed:{" "}
            <span className="font-mono text-amber-700 dark:text-amber-400">{ops.reauth_list}</span>{" "}
            — Settings → Inboxes → Reconnect. Mail from these inboxes is NOT syncing.
          </p>
        )}
      </section>

      {/* Per-cron cards */}
      <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {cards.map((c) => (
          <CronCard key={c.name} data={c} now={now} />
        ))}
      </section>

      {/* Backups -- the nightly Google Sheets snapshot runs from
          system cron (not app/api/cron/*), so it lives in its own
          section with a manual "Export Now" trigger + last-run
          status pulled from cron_runs. */}
      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-lg tracking-tight">Backups</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <SheetsBackupCard initial={sheetsBackup} />
        </div>
      </section>
    </div>
  );
}

async function loadCronCard(name: string): Promise<CronCardData> {
  // Last 10 runs for this cron + a separate 24h error count.
  // Using two small queries instead of one fancy one because the
  // result types are different shapes (head row + dots + count).
  const recent = await db
    .select({
      status: cronRuns.status,
      startedAt: cronRuns.startedAt,
      durationMs: cronRuns.durationMs,
      errorMessage: cronRuns.errorMessage,
    })
    .from(cronRuns)
    .where(sql`${cronRuns.cronName} = ${name}`)
    .orderBy(sql`${cronRuns.startedAt} DESC`)
    .limit(10);

  const errorsLast24hRows = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n
    FROM cron_runs
    WHERE cron_name = ${name}
      AND status = 'error'
      AND started_at > NOW() - INTERVAL '24 hours'
  `);
  const errorsList = Array.isArray(errorsLast24hRows)
    ? (errorsLast24hRows as unknown as Array<{ n: number }>)
    : ((errorsLast24hRows as unknown as { rows: Array<{ n: number }> }).rows ?? []);
  const errorsLast24h = Number(errorsList[0]?.n ?? 0);

  const successWithDuration = recent.filter(
    (r) => r.status === "success" && typeof r.durationMs === "number",
  );
  const avgSuccessMs =
    successWithDuration.length > 0
      ? Math.round(
          successWithDuration.reduce((sum, r) => sum + (r.durationMs ?? 0), 0) /
            successWithDuration.length,
        )
      : null;

  const head = recent[0] ?? null;
  return {
    name,
    lastRun: head
      ? {
          status: head.status as "running" | "success" | "error",
          startedAt: head.startedAt,
          durationMs: head.durationMs,
          errorMessage: head.errorMessage,
        }
      : null,
    recentStatuses: recent.map((r) => r.status as "running" | "success" | "error"),
    avgSuccessMs,
    errorsLast24h,
  };
}

function CronCard({ data, now }: { data: CronCardData; now: number }) {
  const last = data.lastRun;
  let tone: "ok" | "warning" | "error" | "neutral" = "neutral";
  if (!last) tone = "warning";
  else if (last.status === "error") tone = "error";
  else if (last.status === "running" && now - last.startedAt.getTime() > 30 * 60 * 1000)
    tone = "warning";
  else if (last.status === "success") tone = "ok";
  else tone = "neutral";

  const borderClass =
    tone === "error"
      ? "border-rose-500/40 dark:border-rose-500/40"
      : tone === "warning"
        ? "border-amber-500/40 dark:border-amber-500/40"
        : tone === "ok"
          ? "border-emerald-500/30 dark:border-emerald-500/30"
          : "border-zinc-200 dark:border-zinc-800";

  return (
    <article className={`rounded-xl border bg-white p-4 dark:bg-zinc-950 ${borderClass}`}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">Cron</p>
          <h2 className="mt-0.5 font-mono font-semibold text-base">{data.name}</h2>
        </div>
        <StatusBadge status={last?.status ?? null} stale={tone === "warning"} />
      </header>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
        {last ? (
          <>
            <span>
              Last:{" "}
              <span className="text-zinc-900 dark:text-zinc-100">
                {formatRelative(last.startedAt, now)}
              </span>
            </span>
            {last.durationMs !== null && (
              <span>
                Duration:{" "}
                <span className="text-zinc-900 dark:text-zinc-100">
                  {formatDuration(last.durationMs)}
                </span>
              </span>
            )}
            {data.avgSuccessMs !== null && (
              <span>
                Avg:{" "}
                <span className="text-zinc-900 dark:text-zinc-100">
                  {formatDuration(data.avgSuccessMs)}
                </span>
              </span>
            )}
            {data.errorsLast24h > 0 && (
              <span className="text-rose-600 dark:text-rose-400">
                {data.errorsLast24h} error{data.errorsLast24h === 1 ? "" : "s"} / 24h
              </span>
            )}
          </>
        ) : (
          <span className="text-zinc-500 italic">
            No runs recorded yet. (Has the cron been invoked since this table was created?)
          </span>
        )}
      </div>

      {/* Last 10 runs as colored dots */}
      {data.recentStatuses.length > 0 && (
        <div className="mt-3 flex items-center gap-1">
          {data.recentStatuses
            .slice()
            .reverse()
            .map((s, i) => (
              <span
                key={`${i}-${s}`}
                className={`h-2 w-2 rounded-full ${
                  s === "success" ? "bg-emerald-500" : s === "error" ? "bg-rose-500" : "bg-blue-500"
                }`}
                title={s}
              />
            ))}
        </div>
      )}

      {last?.status === "error" && last.errorMessage && (
        <pre className="mt-3 max-h-32 overflow-auto rounded-md bg-rose-50 p-2 font-mono text-[11px] text-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          {last.errorMessage.split("\n").slice(0, 6).join("\n")}
        </pre>
      )}
    </article>
  );
}

function StatusBadge({
  status,
  stale,
}: {
  status: "running" | "success" | "error" | null;
  stale: boolean;
}) {
  if (status === "running" && !stale) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-blue-100 px-2 py-0.5 font-medium text-[10px] text-blue-700 uppercase tracking-widest dark:bg-blue-900/40 dark:text-blue-300">
        <Loader2 className="h-3 w-3 animate-spin" />
        Running
      </span>
    );
  }
  if (status === "running" && stale) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 font-medium text-[10px] text-amber-800 uppercase tracking-widest dark:bg-amber-900/40 dark:text-amber-200">
        <AlertTriangle className="h-3 w-3" />
        Stuck
      </span>
    );
  }
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
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-0.5 font-medium text-[10px] text-zinc-600 uppercase tracking-widest dark:bg-zinc-800 dark:text-zinc-400">
      No data
    </span>
  );
}

function StatCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone: "neutral" | "warning" | "error";
  icon: React.ReactNode;
}) {
  const toneClass =
    tone === "error"
      ? "text-rose-600 dark:text-rose-400"
      : tone === "warning"
        ? "text-amber-600 dark:text-amber-400"
        : "text-zinc-900 dark:text-zinc-100";
  return (
    <div className="card-surface flex items-start gap-3 p-3">
      <span className="mt-0.5 text-zinc-500">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">{label}</p>
        <p className={`mt-0.5 font-semibold text-2xl tabular-nums ${toneClass}`}>{value}</p>
      </div>
    </div>
  );
}

function formatRelative(then: Date, now: number): string {
  const deltaSec = Math.max(0, Math.floor((now - then.getTime()) / 1000));
  if (deltaSec < 60) return `${deltaSec}s ago`;
  const min = Math.floor(deltaSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = s / 60;
  return `${m.toFixed(1)}min`;
}
