import { requireStaff } from "@/lib/auth";
import { loadStaffActivityProfile } from "@/lib/team-analytics";
import Link from "next/link";
import { notFound } from "next/navigation";
// Reuses the rendering components from the admin analytics page.
// They're presentational + take typed props; safe to import here.
import { ActivityFeed } from "../../admin/analytics/[staffId]/_components/activity-feed";
import { DailyChart } from "../../admin/analytics/[staffId]/_components/daily-chart";
import { TopVenuesTable } from "../../admin/analytics/[staffId]/_components/top-venues-table";

export const dynamic = "force-dynamic";
export const metadata = { title: "My activity" };

/**
 * /me/activity -- operator-facing view of their own activity profile.
 *
 * The corresponding admin route (/admin/analytics/[staffId]) is
 * admin-only because it can target any operator. This page exists
 * so a regular outreach rep can see THEIR OWN stats without going
 * through admin -- a real workflow gap before this commit, since
 * operators want to know "how am I doing this week" without
 * waiting on a manager to pull the data.
 *
 * Same three sections as the admin page:
 *   1. Header card (no admin shield, no team-analytics back link,
 *      no role pill -- this is YOUR page, not someone else's)
 *   2. Daily chart
 *   3. Top venues + recent activity
 *
 * Auth: requireStaff (not requireAdmin). The page scopes to the
 * caller's own staffId only; there's no params.staffId to
 * impersonate. Admins viewing their own activity get the same
 * page as a regular rep -- they have /admin/analytics for the
 * cross-team view.
 */
export default async function MyActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string; from?: string; to?: string }>;
}) {
  const { staff } = await requireStaff();
  const sp = await searchParams;
  const windowDays = Number(sp.window ?? "30");
  const profile = await loadStaffActivityProfile({
    staffId: staff.id,
    windowDays: Number.isFinite(windowDays) ? windowDays : 30,
    from: sp.from,
    to: sp.to,
  });
  // Should never happen for a logged-in staff (we just authed them)
  // but the loader can return null defensively; fail closed.
  if (!profile) notFound();

  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-10 sm:px-10">
      <ProfileHeader profile={profile} />

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

/**
 * Local header component. Simpler than the admin page's variant:
 * no role pill (you know your own role), no admin shield (same),
 * no "team analytics" back link (this isn't part of the admin
 * surface). Otherwise the layout matches so muscle memory carries
 * over for admins who use both.
 */
function ProfileHeader({
  profile,
}: {
  profile: NonNullable<Awaited<ReturnType<typeof loadStaffActivityProfile>>>;
}) {
  const initials = profile.staff.displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");

  // CSV export URL: the existing /api/admin/analytics/[staffId]/export.csv
  // route is admin-only. For the operator-facing page we don't expose CSV
  // since cross-page download would require either a new operator-scoped
  // route or relaxing the admin gate on the existing one. Skipping for
  // now -- the data is already on-screen.

  return (
    <section className="card-surface overflow-hidden">
      <header className="flex items-center gap-4 border-zinc-200/60 border-b px-6 py-5 dark:border-zinc-800/40">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-zinc-200 to-zinc-300 font-mono font-semibold text-sm text-zinc-700 dark:from-zinc-700 dark:to-zinc-800 dark:text-zinc-200">
          {initials || "?"}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="font-semibold text-2xl tracking-tight">My activity</h1>
          <p className="mt-0.5 font-mono text-[11px] text-zinc-500">{profile.staff.primaryEmail}</p>
        </div>
        <div className="flex items-center gap-2">
          <WindowSelector currentWindow={profile.windowDays} />
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
        {profile.windowStart} {"->"} {profile.windowEnd} · {profile.windowDays} days
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

/**
 * Window selector. Routes back to /me/activity (not the admin
 * route) since this is the operator-facing surface. We intentionally
 * don't carry custom from/to ranges in the link query -- if the
 * operator was using a custom range, the window-preset click is
 * a deliberate switch back to a fixed window.
 */
function WindowSelector({ currentWindow }: { currentWindow: number }) {
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
            href={`/me/activity?window=${o.days}`}
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
