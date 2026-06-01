import { connectedAccounts, emailSendEvents, emailThreads, staffMembers } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { startOfLocalDay } from "@/lib/send-cap";
import { and, eq, sql } from "drizzle-orm";
import { AlertTriangle, Check, Clock, Inbox as InboxIcon, Send } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inbox health · Me" };

/**
 * /me/inbox-health -- operator-facing view of THEIR own connected
 * accounts' health (send-cap usage, last sync, unread, stale).
 *
 * The admin equivalent at /admin/email-health shows every account
 * on the team -- useful for managers seeing the whole picture, but
 * out of reach for a regular outreach rep. This page covers the
 * gap with the same shape but scoped to ownerUserId = current
 * staff. Operators can answer "am I close to my cap" or "is my
 * Gmail still syncing" without paging a manager.
 *
 * Auth: requireStaff (not requireAdmin). The query joins on
 * ownerUserId = staff.id so there's no team-wide leakage even if
 * an admin lands here -- they see their OWN accounts, same as a
 * rep. Admins still have /admin/email-health for the team view.
 */
export default async function MyInboxHealthPage() {
  const { staff } = await requireStaff();

  // Per-operator account list. Mirrors loadEmailHealthDashboard's
  // query shape but filters to ownerUserId = current staff.
  // A rep typically has 1-3 connected_accounts; admins may have
  // a shared sending inbox plus their personal one. Per-account
  // cards render below the totals strip.
  const accounts = await db
    .select({
      id: connectedAccounts.id,
      emailAddress: connectedAccounts.emailAddress,
      ownerTimezone: staffMembers.timezone,
      rawStatus: connectedAccounts.status,
      coldSendCap: connectedAccounts.dailyColdSendCap,
      lastSyncedAt: connectedAccounts.lastSyncedAt,
    })
    .from(connectedAccounts)
    .innerJoin(staffMembers, eq(staffMembers.id, connectedAccounts.ownerUserId))
    .where(
      and(eq(connectedAccounts.teamId, staff.teamId), eq(connectedAccounts.ownerUserId, staff.id)),
    )
    .orderBy(connectedAccounts.emailAddress);

  // Compute per-account derived stats in parallel. Same pattern as
  // the admin dashboard helper but written inline here -- the
  // helper is monolithic + bakes in team-totals we don't need.
  const now = new Date();
  const rows = await Promise.all(
    accounts.map(async (a) => {
      const tz = a.ownerTimezone ?? "UTC";
      const todayStart = startOfLocalDay(tz);
      const [coldSendsTodayRow, unreadRow, staleRow] = await Promise.all([
        db.execute<{ n: number }>(sql`
          SELECT COUNT(*)::int AS n
          FROM ${emailSendEvents}
          WHERE connected_account_id = ${a.id}
            AND category = 'cold'
            AND counted_against_cap = true
            AND sent_at >= ${todayStart}
        `),
        // Sum unread across the operator's threads on this account.
        db
          .select({ n: sql<number>`COALESCE(SUM(${emailThreads.unreadCount}), 0)::int` })
          .from(emailThreads)
          .where(eq(emailThreads.staffOutreachEmailId, a.id)),
        db
          .select({ n: sql<number>`COUNT(*)::int` })
          .from(emailThreads)
          .where(and(eq(emailThreads.staffOutreachEmailId, a.id), eq(emailThreads.isStale, true))),
      ]);
      // drizzle execute returns array OR { rows }; normalize.
      const coldArr = Array.isArray(coldSendsTodayRow)
        ? coldSendsTodayRow
        : ((coldSendsTodayRow as { rows?: Array<{ n: number }> }).rows ?? []);
      const coldSendsToday = Number(coldArr[0]?.n ?? 0);
      const unread = Number(unreadRow[0]?.n ?? 0);
      const stale = Number(staleRow[0]?.n ?? 0);
      // Sync staleness threshold: anything older than 30 minutes
      // is suspicious. The poll worker runs every 5 minutes
      // normally so 30 minutes is 6x missed cycles -- enough
      // signal to surface as a warning.
      const lastSync = a.lastSyncedAt;
      const minutesSinceSync = lastSync
        ? Math.floor((now.getTime() - new Date(lastSync).getTime()) / 60_000)
        : null;
      const syncStale = minutesSinceSync !== null && minutesSinceSync > 30;
      return {
        id: a.id,
        emailAddress: a.emailAddress,
        rawStatus: a.rawStatus,
        coldSendCap: a.coldSendCap,
        coldSendsToday,
        unread,
        stale,
        lastSyncedAt: lastSync,
        minutesSinceSync,
        syncStale,
      };
    }),
  );

  // Totals across YOUR accounts. Useful when an operator has more
  // than one connected inbox.
  const totals = rows.reduce(
    (acc, r) => {
      acc.coldSendsToday += r.coldSendsToday;
      acc.capTotalToday += r.coldSendCap;
      acc.unread += r.unread;
      acc.stale += r.stale;
      return acc;
    },
    { coldSendsToday: 0, capTotalToday: 0, unread: 0, stale: 0 },
  );

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10 sm:px-10">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.14em]">me</p>
          <h1 className="mt-1 font-semibold text-3xl tracking-tight">Inbox health</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Your connected inbox status, send-cap usage, and sync state.
          </p>
        </div>
        <Link
          href="/me/activity"
          className="font-mono text-[11px] text-zinc-600 uppercase tracking-[0.08em] hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          My activity {"->"}
        </Link>
      </header>

      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <section className="card-surface mb-6 overflow-hidden">
            <div className="grid grid-cols-2 gap-px bg-zinc-200/60 sm:grid-cols-4 dark:bg-zinc-800/40">
              <StatCell
                label="Cold sends today"
                value={`${totals.coldSendsToday} / ${totals.capTotalToday}`}
                tone="text-emerald-600 dark:text-emerald-400"
                warn={
                  totals.capTotalToday > 0 && totals.coldSendsToday / totals.capTotalToday >= 0.9
                }
              />
              <StatCell
                label="Unread"
                value={totals.unread.toLocaleString("en-US")}
                tone="text-blue-600 dark:text-blue-400"
              />
              <StatCell
                label="Stale threads"
                value={totals.stale.toLocaleString("en-US")}
                tone="text-amber-600 dark:text-amber-400"
                warn={totals.stale > 0}
              />
              <StatCell
                label="Accounts"
                value={rows.length.toLocaleString("en-US")}
                tone="text-zinc-700 dark:text-zinc-300"
              />
            </div>
          </section>

          <section className="grid gap-3">
            {rows.map((r) => (
              <AccountCard key={r.id} row={r} />
            ))}
          </section>
        </>
      )}
    </main>
  );
}

function StatCell({
  label,
  value,
  tone,
  warn,
}: {
  label: string;
  value: string;
  tone: string;
  warn?: boolean;
}) {
  return (
    <div className="bg-white px-5 py-4 dark:bg-zinc-950/60">
      <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">{label}</p>
      <p
        className={`mt-1 font-semibold text-2xl tabular-nums tracking-tight ${warn ? "text-amber-600 dark:text-amber-400" : tone}`}
      >
        {value}
      </p>
    </div>
  );
}

function AccountCard({
  row,
}: {
  row: {
    id: string;
    emailAddress: string;
    rawStatus: string;
    coldSendCap: number;
    coldSendsToday: number;
    unread: number;
    stale: number;
    lastSyncedAt: Date | null;
    minutesSinceSync: number | null;
    syncStale: boolean;
  };
}) {
  const capPct =
    row.coldSendCap > 0
      ? Math.min(100, Math.round((row.coldSendsToday / row.coldSendCap) * 100))
      : 0;
  const capWarn = capPct >= 90;
  const needsReauth = row.rawStatus !== "connected";

  return (
    <article className="card-surface px-5 py-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-mono font-medium text-sm text-zinc-900 dark:text-zinc-100">
          {row.emailAddress}
        </h2>
        {needsReauth ? (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] text-rose-600 uppercase tracking-[0.1em] dark:text-rose-400">
            <AlertTriangle className="h-3 w-3" />
            Needs reauth
          </span>
        ) : row.syncStale ? (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] text-amber-600 uppercase tracking-[0.1em] dark:text-amber-400">
            <Clock className="h-3 w-3" />
            Sync {row.minutesSinceSync}m ago
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] text-emerald-600 uppercase tracking-[0.1em] dark:text-emerald-400">
            <Check className="h-3 w-3" />
            Healthy
          </span>
        )}
      </header>

      <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
        <SmallStat
          icon={<Send className="h-3.5 w-3.5 text-emerald-500" />}
          label="Cold sends today"
          value={`${row.coldSendsToday} / ${row.coldSendCap}`}
          warn={capWarn}
        />
        <SmallStat
          icon={<InboxIcon className="h-3.5 w-3.5 text-blue-500" />}
          label="Unread"
          value={row.unread.toLocaleString("en-US")}
        />
        <SmallStat
          icon={<Clock className="h-3.5 w-3.5 text-amber-500" />}
          label="Stale"
          value={row.stale.toLocaleString("en-US")}
          warn={row.stale > 0}
        />
      </div>

      {row.coldSendCap > 0 && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div
            className={`h-full ${capWarn ? "bg-amber-500" : "bg-emerald-500"}`}
            style={{ width: `${capPct}%` }}
            aria-label={`Cap usage ${capPct}%`}
          />
        </div>
      )}
    </article>
  );
}

function SmallStat({
  icon,
  label,
  value,
  warn,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em]">
        {icon}
        {label}
      </span>
      <span
        className={`font-semibold tabular-nums ${warn ? "text-amber-600 dark:text-amber-400" : "text-zinc-900 dark:text-zinc-100"}`}
      >
        {value}
      </span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-zinc-200 border-dashed p-12 text-center dark:border-zinc-800">
      <InboxIcon className="mx-auto h-6 w-6 text-zinc-400" />
      <p className="mt-3 text-sm text-zinc-500">
        No connected inboxes yet. An admin can connect one from{" "}
        <Link
          href="/settings/inboxes"
          className="text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-300"
        >
          Settings &raquo; Inboxes
        </Link>
        .
      </p>
    </div>
  );
}
