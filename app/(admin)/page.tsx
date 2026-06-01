import { requireStaff } from "@/lib/auth";
import { getCurrentCampaign } from "@/lib/current-campaign";
import { loadDashboardData } from "@/lib/dashboard-queries";
import { loadPendingEscalationsForStaff } from "@/lib/escalations-data";
import { loadInboxWidget } from "@/lib/inbox-widget-data";
import { captureException } from "@/lib/logger";
import { loadNextBestActions } from "@/lib/next-best-actions";
import { loadTeamActivity } from "@/lib/team-activity";
import { loadTodayDigest } from "@/lib/today-data";
import { loadTrackerData } from "@/lib/tracker-data";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ClientOnly } from "./_components/client-only";
import { CitiesCompletedKpi } from "./_components/dashboard/cities-completed-kpi";
import { CitiesTable } from "./_components/dashboard/cities-table";
import { EscalationsWidget } from "./_components/dashboard/escalations-widget";
import { InboxWidget } from "./_components/dashboard/inbox-widget";
import { KpiCard } from "./_components/dashboard/kpi-strip";
import { MeetingMode } from "./_components/dashboard/meeting-mode";
import { NextBestActionsWidget } from "./_components/dashboard/next-best-actions-widget";
import { NotesWidget } from "./_components/dashboard/notes-widget";
import { TargetDateKpi } from "./_components/dashboard/target-date-kpi";
import { TasksWidget } from "./_components/dashboard/tasks-widget";
import { TeamActivityWidget } from "./_components/dashboard/team-activity-widget";
import { TodayWidget } from "./_components/dashboard/today-widget";
import { TrackerDashboardTable } from "./_components/dashboard/tracker-dashboard-table";
import { WhosOnline } from "./_components/dashboard/whos-online";

// Always render at request time — dashboard shows live counts from DB.
export const dynamic = "force-dynamic";

/**
 * Operations dashboard. Click any city row to drill into its campaigns
 * and events.
 *
 * Default scope: the operator's currently-selected campaign. The query
 * filters city_campaigns to just that campaign's. The "All campaigns"
 * link in the scope banner broadens the view by passing ?scope=all in
 * the URL.
 *
 * Visual model: Apple-system-grey aesthetic with financial-trading
 * compact KPI strip across the top, then an alternating-rows cities
 * table as the main content. Numbers are tabular-nums + Geist Mono.
 */
export default async function DashboardHome({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const params = await searchParams;
  const allCampaigns = params.scope === "all";

  // Current staff — used to scope the escalations widget to "me".
  // Layout already requireStaff'd to keep us authed; cheap to re-read
  // the cookie here for the id + name we need.
  const { staff } = await requireStaff();

  const currentCampaign = await getCurrentCampaign();
  // No campaign selected → bounce to the role-appropriate landing.
  // The middleware also catches this for direct URL access but we
  // re-check here in case the cookie is set but references a
  // stale/archived campaign (which makes getCurrentCampaign() return
  // null while the cookie is still present).
  if (!currentCampaign && !allCampaigns) {
    // Admin → /admin (campaign-agnostic overview)
    // Non-admin → /pick-campaign (one-click picker, no dropdown
    //              required). Operator: "If a non admin logins
    //              and doesn't select a campaign they have a
    //              loading screen with active campaigns to click
    //              to automatically load it rather than having
    //              to select it from the drop down at the top."
    redirect(staff.role === "admin" ? "/admin" : "/pick-campaign");
  }
  // If the operator picked a campaign in the switcher AND hasn't opted into
  // "all campaigns" via the URL, scope the dashboard to that campaign.
  const campaignId = !allCampaigns && currentCampaign ? currentCampaign.campaign.id : null;

  const data = await loadDashboardData({ campaignId, viewerStaffId: staff.id });

  // Premium per-campaign tracker + Today digest — both campaign-scoped,
  // loaded in parallel so the dashboard stays under one DB roundtrip
  // budget perceived from the operator's POV.
  //
  // CLAUDE.md §12.3 fix (carryover): each secondary load is wrapped so
  // a single broken query (schema drift, missing index, transient pool
  // exhaustion) degrades the affected widget rather than 500-ing the
  // entire dashboard. The primary loadDashboardData call above stays
  // unguarded — without KPIs + city rows there's nothing useful to
  // show, so an error page is the right response.
  //
  // captureException routes via lib/logger.ts: pino entry + (when
  // configured) Sentry forward. Engineers see WHICH widget failed in
  // pm2 logs; operators see the rest of the dashboard render with the
  // failed widget showing empty state.
  const [
    trackerLoaded,
    todayDigest,
    nextBestActions,
    teamActivity,
    pendingEscalations,
    inboxWidget,
  ] = await Promise.all([
    campaignId
      ? loadTrackerData({ campaignId }).catch(async (err) => {
          await captureException(err, { widget: "tracker", campaignId });
          return { rows: [], staff: [] };
        })
      : Promise.resolve({ rows: [], staff: [] }),
    loadTodayDigest(campaignId).catch(async (err) => {
      await captureException(err, { widget: "today_digest", campaignId });
      return { urgentCrawls: [], staleFollowUps: [], recentWins: [] };
    }),
    loadNextBestActions(campaignId).catch(async (err) => {
      await captureException(err, { widget: "next_best_actions", campaignId });
      return [];
    }),
    loadTeamActivity(4).catch(async (err) => {
      await captureException(err, { widget: "team_activity" });
      return { entries: [], windowHours: 4, totalEvents: 0 };
    }),
    loadPendingEscalationsForStaff(staff.id).catch(async (err) => {
      await captureException(err, { widget: "escalations", staffId: staff.id });
      return [];
    }),
    loadInboxWidget({ userId: staff.id, teamId: staff.teamId }).catch(async (err) => {
      await captureException(err, { widget: "inbox", staffId: staff.id });
      // Empty data — widget hides itself when nothing to show.
      return { threads: [], myInboxes: [], totalNeedsReply: 0 };
    }),
  ]);
  const { rows: trackerRows, staff: trackerStaff } = trackerLoaded;

  const kpis = [
    {
      label: "Events",
      value: (data.kpis.eventsConfirmed + data.kpis.eventsPlanned).toString(),
      meta: `${data.kpis.eventsConfirmed} confirmed · ${data.kpis.eventsPlanned} planned`,
      tooltip:
        "Total crawls in scope — confirmed (locked in) plus planned (still being built out).",
      trend: "flat" as const,
    },
    {
      label: "Reply rate 30d",
      value: `${data.kpis.replyRate}%`,
      meta: "of all touchpoints",
      tooltip:
        "Share of outreach messages in the last 30 days that got a reply. Higher is better; under ~10% suggests the outreach needs attention.",
      trend:
        data.kpis.replyRate >= 20
          ? ("up" as const)
          : data.kpis.replyRate >= 10
            ? ("flat" as const)
            : ("down" as const),
    },
  ];

  return (
    <div className="flex animate-[fade-in_300ms_ease-out] flex-col gap-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-mono text-xs text-zinc-500 tabular-nums">
            live · {new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
          </p>
          <p className="mt-1.5 font-mono text-xs text-zinc-500 uppercase tracking-widest">
            Operations
          </p>
          <h1 className="mt-1 font-semibold text-4xl tracking-tight">Dashboard</h1>
        </div>
        <div className="flex items-center gap-3 sm:justify-end">
          {/* WhosOnline + MeetingMode are browser-state-dependent
              (presence polling, localStorage-backed flags, live
              cursor layer). They were the suspected source of an
              intermittent React #418 (HTML element-type mismatch)
              when the operator's localStorage had meeting mode ON +
              the WebSocket landed a peer message mid-hydration. They
              also contribute nothing to the initial server HTML —
              the user can't interact with them until JS hydrates.
              Rendering them client-only after mount eliminates the
              hydration risk without changing perceived behavior. */}
          <ClientOnly>
            <WhosOnline currentStaffId={staff.id} compact />
          </ClientOnly>
          <ClientOnly>
            <MeetingMode
              room={`dashboard:${campaignId ?? "global"}`}
              viewerName={staff.displayName}
            />
          </ClientOnly>
          {/* Scope tile — compact, top-right. Communicates exactly what the
              dashboard is showing without taking a full-width row. */}
          <div className="card-surface-quiet flex items-center gap-3 px-3 py-2">
            <p className="max-w-[55vw] truncate font-mono text-[11px] text-zinc-500 uppercase tracking-widest sm:max-w-xs">
              {data.scopedCampaign ? (
                <>
                  Scope:{" "}
                  <span className="text-zinc-900 dark:text-zinc-100">
                    {data.scopedCampaign.name}
                  </span>
                </>
              ) : currentCampaign ? (
                <>
                  Scope: <span className="text-zinc-900 dark:text-zinc-100">all campaigns</span>
                </>
              ) : (
                <>
                  Scope: <span className="text-zinc-900 dark:text-zinc-100">all campaigns</span>
                </>
              )}
            </p>
            {data.scopedCampaign ? (
              <Link
                href="/?scope=all"
                className="whitespace-nowrap font-mono text-[11px] text-zinc-500 uppercase tracking-widest hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                view all →
              </Link>
            ) : currentCampaign ? (
              <Link
                href="/"
                className="whitespace-nowrap font-mono text-[11px] text-zinc-500 uppercase tracking-widest hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                scope →
              </Link>
            ) : null}
          </div>
        </div>
      </header>

      {/* KPI band layout:
            Mobile (default): 2 columns. Cities-completed + Target-date
                              sit side-by-side at 1/2 each. KPI strip
                              drops to its own row spanning full width.
            Desktop (sm+):    6 columns. Cities-completed col-span-2
                              (= 1/3). Target-date col-span-2 (= 1/3).
                              KPI strip col-span-2 (= 1/3).
          The 6-col base gives the flexibility to land at thirds on
          desktop while keeping the mobile layout clean. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6 sm:gap-4">
        <div className="col-span-1 sm:col-span-2">
          <CitiesCompletedKpi
            completed={data.kpis.citiesCompleted}
            goal={data.kpis.citiesGoal}
            campaignId={campaignId}
            isAdmin={staff.role === "admin"}
          />
        </div>
        <div className="col-span-1 sm:col-span-2">
          <TargetDateKpi
            endDate={currentCampaign?.campaign.endDate ?? null}
            campaignId={campaignId}
            isAdmin={staff.role === "admin"}
          />
        </div>
        <div className="card-surface col-span-2 grid grid-cols-1 gap-px overflow-hidden bg-zinc-200 sm:col-span-2 sm:grid-cols-2 dark:bg-zinc-800/40">
          {kpis.map((kpi) => (
            <KpiCard key={kpi.label} kpi={kpi} />
          ))}
        </div>
      </div>

      {/* Escalations widget — only renders when this staffer actually
          has pending escalations parked with them. Empty array = hide
          entirely (avoids cluttering the dashboard for staffers who
          never receive escalations, e.g. outreach specialists). When
          shown, the widget is the second thing the operator sees
          after KPIs — by design, since unresolved escalations are
          high-priority unblockers. */}
      {pendingEscalations.length > 0 && (
        <EscalationsWidget
          escalations={pendingEscalations}
          staffFirstName={staff.displayName.split(" ")[0] ?? staff.displayName}
        />
      )}

      {/* Inbox widget — needs-reply queue + per-inbox send-cap rail.
          Renders only when the operator has threads OR connected
          inboxes to surface (the component returns null for an
          empty/empty pair, keeping the dashboard tidy). Sits high
          on the page because email is the operational primary
          surface in the outreach phase. */}
      <InboxWidget data={inboxWidget} />

      <TodayWidget
        digest={todayDigest}
        currentCampaign={
          currentCampaign
            ? { id: currentCampaign.campaign.id, name: currentCampaign.campaign.name }
            : null
        }
      />

      <NextBestActionsWidget actions={nextBestActions} />

      <section className="flex flex-col gap-3">
        <TasksWidget
          tasks={data.upcomingTasks}
          totalOpen={data.kpis.openTaskCount}
          overdueCount={data.kpis.overdueTaskCount}
        />
        <NotesWidget notes={data.recentNotes} />
      </section>

      <section className="flex flex-col gap-3">
        <header className="flex items-baseline justify-between">
          <h2 className="font-semibold text-2xl tracking-tight ">Cities</h2>
          <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
            {trackerRows.length || data.cityRows.length}{" "}
            {(trackerRows.length || data.cityRows.length) === 1 ? "city" : "cities"} ·{" "}
            {campaignId ? "inline-edit Assign + Notes" : "click to expand"}
          </p>
        </header>
        {campaignId && trackerRows.length > 0 ? (
          <TrackerDashboardTable rows={trackerRows} staff={trackerStaff} />
        ) : (
          <CitiesTable
            cities={data.cityRows}
            currentCampaign={
              currentCampaign
                ? { id: currentCampaign.campaign.id, name: currentCampaign.campaign.name }
                : null
            }
          />
        )}
      </section>

      <TeamActivityWidget summary={teamActivity} />
    </div>
  );
}
