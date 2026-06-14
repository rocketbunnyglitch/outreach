import { hasMinimumRole, requireAdmin } from "@/lib/auth";
import { loadStaffActivityProfile } from "@/lib/team-analytics";
import { ChevronLeft, Download, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DateRangePicker } from "../_components/date-range-picker";
import { ActivityFeed } from "./_components/activity-feed";
import { DailyChart } from "./_components/daily-chart";
import { TopVenuesTable } from "./_components/top-venues-table";

export const dynamic = "force-dynamic";

/**
 * /admin/analytics/[staffId] — full activity profile for one operator.
 *
 * Three stacked sections:
 *   1. Header card — name, email, role pill, totals strip
 *   2. Daily chart — full bar chart of last N days (default 30) with
 *      channel breakdown stacked per bar
 *   3. Top venues + recent activity — two-column on desktop, stacked
 *      on mobile
 *
 * Admin-only — requireAdmin throws notFound() for non-admins so the
 * route is invisible to outreach reps.
 */
export default async function StaffAnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ staffId: string }>;
  searchParams: Promise<{ window?: string; from?: string; to?: string }>;
}) {
  await requireAdmin();
  const { staffId } = await params;
  // Guard: a non-UUID segment (e.g. a stale link to /admin/analytics/<word>)
  // would otherwise hit the loader's `= $1::uuid` and crash the route with a
  // 22P02 instead of a clean 404 (§12.3 — bad params 404, never crash).
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(staffId)) {
    notFound();
  }
  const sp = await searchParams;
  const windowDays = Number(sp.window ?? "30");
  const profile = await loadStaffActivityProfile({
    staffId,
    windowDays: Number.isFinite(windowDays) ? windowDays : 30,
    from: sp.from,
    to: sp.to,
  });
  if (!profile) notFound();

  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-10 sm:px-10">
      <Link
        href="/admin/analytics"
        className="mb-6 inline-flex items-center gap-1 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.14em] underline-offset-4 hover:text-zinc-900 hover:underline dark:hover:text-zinc-100"
      >
        <ChevronLeft className="h-3 w-3" /> Team analytics
      </Link>

      <ProfileHeader profile={profile} activeFrom={sp.from} activeTo={sp.to} />

      <div className="mt-6 grid gap-6">
        <DailyChart daily={profile.daily} windowDays={profile.windowDays} />

        <div className="grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <TopVenuesTable rows={profile.topVenues} />
          </div>
          <div className="lg:col-span-2">
            <ActivityFeed rows={profile.recentActivity} />
          </div>
        </div>
      </div>
    </main>
  );
}

function ProfileHeader({
  profile,
  activeFrom,
  activeTo,
}: {
  profile: NonNullable<Awaited<ReturnType<typeof loadStaffActivityProfile>>>;
  activeFrom?: string;
  activeTo?: string;
}) {
  const initials = profile.staff.displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");

  const isAdmin = hasMinimumRole(profile.staff, "admin");

  return (
    <section className="card-surface overflow-hidden">
      <header className="flex items-center gap-4 border-zinc-200/60 border-b px-6 py-5 dark:border-zinc-800/40">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-zinc-200 to-zinc-300 font-mono font-semibold text-sm text-zinc-700 dark:from-zinc-700 dark:to-zinc-800 dark:text-zinc-200">
          {initials || "?"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="font-semibold text-2xl tracking-tight">{profile.staff.displayName}</h1>
            {isAdmin && <ShieldCheck className="h-4 w-4 text-purple-500" aria-label="Admin" />}
          </div>
          <p className="mt-0.5 font-mono text-[11px] text-zinc-500">
            {profile.staff.primaryEmail} ·{" "}
            <span className="uppercase tracking-[0.08em]">{profile.staff.role}</span>
            {profile.staff.status !== "active" && (
              <span className="ml-1 text-rose-500">· {profile.staff.status}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={(() => {
              if (activeFrom && activeTo) {
                return `/api/admin/analytics/${profile.staff.staffId}/export.csv?from=${activeFrom}&to=${activeTo}`;
              }
              return `/api/admin/analytics/${profile.staff.staffId}/export.csv?window=${profile.windowDays}`;
            })()}
            download
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-3 py-1.5 font-mono text-[11px] text-zinc-600 uppercase tracking-[0.08em] transition-colors hover:border-zinc-400 hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
          >
            <Download className="h-3 w-3" />
            Download CSV
          </a>
          <WindowSelector currentWindow={profile.windowDays} staffId={profile.staff.staffId} />
          <DateRangePicker
            activeFrom={activeFrom}
            activeTo={activeTo}
            staffId={profile.staff.staffId}
          />
        </div>
      </header>

      <div className="grid grid-cols-2 gap-px bg-zinc-200/60 sm:grid-cols-3 lg:grid-cols-6 dark:bg-zinc-800/40">
        <StatCell
          label="Calls"
          value={profile.totals.calls}
          tone="text-blue-600 dark:text-blue-400"
        />
        <StatCell
          label="Emails sent"
          value={profile.totals.emailsSent}
          tone="text-emerald-600 dark:text-emerald-400"
        />
        <StatCell
          label="SMS sent"
          value={profile.totals.smsSent}
          tone="text-orange-600 dark:text-orange-400"
        />
        <StatCell
          label="Viber"
          value={profile.totals.viberTouches}
          tone="text-purple-600 dark:text-purple-400"
        />
        <StatCell
          label="Total touches"
          value={profile.totals.totalTouches}
          tone="text-zinc-900 dark:text-zinc-100"
        />
        <StatCell
          label="Active days"
          value={profile.totals.activeDays}
          tone="text-zinc-700 dark:text-zinc-300"
          subtext={
            profile.totals.activeDays > 0
              ? `${(profile.totals.totalTouches / profile.totals.activeDays).toFixed(1)} avg`
              : undefined
          }
        />
      </div>

      <p className="border-zinc-200/60 border-t px-6 py-2 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em] dark:border-zinc-800/40">
        {profile.windowStart} → {profile.windowEnd} · {profile.windowDays} days
      </p>
    </section>
  );
}

function StatCell({
  label,
  value,
  tone,
  subtext,
}: {
  label: string;
  value: number;
  tone: string;
  subtext?: string;
}) {
  return (
    <div className="bg-white px-5 py-4 dark:bg-zinc-950/60">
      <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">{label}</p>
      <p className={`mt-1 font-semibold text-2xl tabular-nums tracking-tight ${tone}`}>
        {value.toLocaleString("en-US")}
      </p>
      {subtext && <p className="mt-0.5 font-mono text-[10px] text-zinc-500">{subtext}</p>}
    </div>
  );
}

function WindowSelector({
  currentWindow,
  staffId,
}: {
  currentWindow: number;
  staffId: string;
}) {
  const options = [
    { days: 7, label: "7d" },
    { days: 30, label: "30d" },
    { days: 90, label: "90d" },
    { days: 365, label: "1y" },
  ];
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
      {options.map((o) => {
        const active = o.days === currentWindow;
        return (
          <Link
            key={o.days}
            href={`/admin/analytics/${staffId}?window=${o.days}`}
            className={`px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors ${
              active
                ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            }`}
          >
            {o.label}
          </Link>
        );
      })}
    </div>
  );
}
