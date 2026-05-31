import { requireAdmin } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { type AccountHealthRow, loadEmailHealthDashboard } from "@/lib/email-health";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDot,
  Clock,
  Inbox,
  Mail,
  Send,
  Timer,
  XCircle,
} from "lucide-react";
import Link from "next/link";

export const metadata = { title: "Email Health · Admin" };
export const dynamic = "force-dynamic";

/**
 * /admin/email-health — operational dashboard for every connected
 * Gmail account on the team.
 *
 * Admin-only. Surfaces the signals leads actually care about during
 * a push: who needs reauth, who's at cap, who has stale replies,
 * who hasn't synced in hours. One page, no tabs.
 */
export default async function EmailHealthPage() {
  const { staff } = await requireAdmin();
  const { accounts, teamTotals } = await loadEmailHealthDashboard(staff.teamId);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          ← Admin
        </Link>
        <h1 className="mt-2 font-semibold text-4xl tracking-tight">Email health</h1>
        <p className="text-sm text-zinc-500">
          Per-account operational signal across every connected Gmail on your team. Refreshes on
          page load.
        </p>
      </header>

      {/* Team totals */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <TotalCard
          icon={<Mail className="h-3.5 w-3.5" />}
          label="Connected"
          value={`${teamTotals.accountsConnected}`}
          subtext={`${accounts.length} total`}
        />
        <TotalCard
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
          label="Need reauth"
          value={`${teamTotals.accountsNeedingReauth}`}
          tone={teamTotals.accountsNeedingReauth > 0 ? "rose" : "zinc"}
        />
        <TotalCard
          icon={<Send className="h-3.5 w-3.5" />}
          label="Cold sends today"
          value={`${teamTotals.coldSendsToday}`}
          subtext={`of ${teamTotals.capTotalToday} cap`}
          tone={
            teamTotals.capTotalToday > 0 &&
            teamTotals.coldSendsToday / teamTotals.capTotalToday > 0.8
              ? "amber"
              : "zinc"
          }
        />
        <TotalCard
          icon={<Inbox className="h-3.5 w-3.5" />}
          label="Unread"
          value={`${teamTotals.unreadCount}`}
        />
        <TotalCard
          icon={<Timer className="h-3.5 w-3.5" />}
          label="Stale threads"
          value={`${teamTotals.staleThreads}`}
          tone={teamTotals.staleThreads > 0 ? "amber" : "zinc"}
        />
        <TotalCard
          icon={<XCircle className="h-3.5 w-3.5" />}
          label="Bounces (30d)"
          value={`${teamTotals.bouncesLast30d}`}
          tone={teamTotals.bouncesLast30d > 5 ? "rose" : "zinc"}
        />
      </section>

      {/* Per-account table */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-950">
        {accounts.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-zinc-500">
            No connected Gmail accounts yet. Staff can connect their Gmail from{" "}
            <Link href="/admin/users" className="underline">
              the Users page
            </Link>
            .
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-zinc-200 border-b text-xs text-zinc-500 dark:border-zinc-800">
                <th className="px-3 py-2 text-left font-medium">Account</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Cap today</th>
                <th className="px-3 py-2 text-right font-medium">Sent 7d</th>
                <th className="px-3 py-2 text-right font-medium">Replies 7d</th>
                <th className="px-3 py-2 text-right font-medium">Stale</th>
                <th className="px-3 py-2 text-right font-medium">Unread</th>
                <th className="px-3 py-2 text-left font-medium">Last sync</th>
                <th className="px-3 py-2 font-medium" aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <AccountRow key={a.id} account={a} />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function TotalCard({
  icon,
  label,
  value,
  subtext,
  tone = "zinc",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtext?: string;
  tone?: "zinc" | "rose" | "amber";
}) {
  const toneClass =
    tone === "rose"
      ? "border-rose-200 bg-rose-50 dark:border-rose-900/60 dark:bg-rose-950/30"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/30"
        : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950";
  return (
    <div className={cn("rounded-xl border px-3 py-2.5", toneClass)}>
      <div className="flex items-center gap-1.5 text-xs text-zinc-500">
        {icon}
        <span className="font-mono text-[10px] uppercase tracking-widest">{label}</span>
      </div>
      <div className="mt-1 font-semibold text-2xl tracking-tight">{value}</div>
      {subtext && <div className="text-[11px] text-zinc-500">{subtext}</div>}
    </div>
  );
}

function AccountRow({ account: a }: { account: AccountHealthRow }) {
  const capPct = a.coldSendCap > 0 ? Math.min(100, (a.coldSendsToday / a.coldSendCap) * 100) : 0;
  const atCap = a.coldSendsToday >= a.coldSendCap;
  const nearCap = capPct >= 80;

  return (
    <tr className="border-zinc-100 border-b last:border-b-0 hover:bg-zinc-50/60 dark:border-zinc-900 dark:hover:bg-zinc-900/40">
      <td className="px-3 py-2">
        <div className="flex flex-col">
          <span className="font-medium">{a.emailAddress}</span>
          {a.ownerName && (
            <span className="font-mono text-[10px] text-zinc-500">{a.ownerName}</span>
          )}
        </div>
      </td>
      <td className="px-3 py-2">
        <StatusBadge status={a.status} />
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex flex-col items-end gap-0.5">
          <span
            className={cn(
              "font-mono text-xs",
              atCap
                ? "text-rose-700 dark:text-rose-300"
                : nearCap
                  ? "text-amber-700 dark:text-amber-300"
                  : "text-zinc-700 dark:text-zinc-300",
            )}
          >
            {a.coldSendsToday}/{a.coldSendCap}
          </span>
          <div className="h-1 w-16 rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                atCap ? "bg-rose-500" : nearCap ? "bg-amber-500" : "bg-emerald-500",
              )}
              style={{ width: `${capPct}%` }}
            />
          </div>
        </div>
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs text-zinc-700 dark:text-zinc-300">
        {a.sendsLast7d}
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs text-zinc-700 dark:text-zinc-300">
        {a.inboundLast7d}
      </td>
      <td
        className={cn(
          "px-3 py-2 text-right font-mono text-xs",
          a.staleThreads > 0 ? "text-amber-700 dark:text-amber-300" : "text-zinc-500",
        )}
      >
        {a.staleThreads}
      </td>
      <td
        className={cn(
          "px-3 py-2 text-right font-mono text-xs",
          a.unreadCount > 0 ? "text-blue-700 dark:text-blue-300" : "text-zinc-500",
        )}
      >
        {a.unreadCount}
      </td>
      <td className="px-3 py-2 font-mono text-[11px] text-zinc-500">
        {a.lastSyncedAt ? <RelativeTime date={a.lastSyncedAt} /> : "—"}
      </td>
      <td className="px-3 py-2 text-right">
        <Link
          href={`/inbox?accounts=${a.id}`}
          className="inline-flex items-center gap-0.5 rounded-md border border-zinc-200 px-1.5 py-1 text-xs text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
        >
          Inbox
          <ArrowRight className="h-3 w-3" />
        </Link>
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: AccountHealthRow["status"] }) {
  if (status === "healthy") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 font-mono text-[10px] text-emerald-800 uppercase tracking-widest dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
        <CheckCircle2 className="h-2.5 w-2.5" />
        Healthy
      </span>
    );
  }
  if (status === "needs_reauth") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-1.5 py-0.5 font-mono text-[10px] text-rose-800 uppercase tracking-widest dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
        <AlertTriangle className="h-2.5 w-2.5" />
        Reauth
      </span>
    );
  }
  if (status === "disconnected") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-700 uppercase tracking-widest dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
        <CircleDot className="h-2.5 w-2.5" />
        Off
      </span>
    );
  }
  // stale
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] text-amber-800 uppercase tracking-widest dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
      <Clock className="h-2.5 w-2.5" />
      Stale sync
    </span>
  );
}

/**
 * Compact relative time: "3m ago", "2h ago", "yesterday", "Jan 12".
 * Server-rendered string so we don't pay for a client component on
 * a read-only dashboard.
 */
function RelativeTime({ date }: { date: Date }) {
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / (60 * 1000));
  if (minutes < 1) return <span>just now</span>;
  if (minutes < 60) return <span>{minutes}m ago</span>;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return <span>{hours}h ago</span>;
  const days = Math.floor(hours / 24);
  if (days === 1) return <span>yesterday</span>;
  if (days < 7) return <span>{days}d ago</span>;
  return <span>{date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>;
}
