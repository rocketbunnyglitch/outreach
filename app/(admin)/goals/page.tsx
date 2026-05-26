import { goals, staffMembers } from "@/db/schema";
import { cn } from "@/lib/cn";
import { db } from "@/lib/db";
import { type GoalRow, computeGoalProgress } from "@/lib/goal-progress";
import { fromStorageValue, metricLabel, scopeLabel } from "@/lib/validation/goals";
import { asc, eq, sql } from "drizzle-orm";
import { Plus, Target } from "lucide-react";
import Link from "next/link";

export const metadata = { title: "Goals · Crawl Engine" };
export const dynamic = "force-dynamic";

export default async function GoalsListPage() {
  const rows = await db
    .select({
      id: goals.id,
      scope: goals.scope,
      scopeId: goals.scopeId,
      metric: goals.metric,
      targetValue: goals.targetValue,
      periodStart: goals.periodStart,
      periodEnd: goals.periodEnd,
      setByName: staffMembers.displayName,
    })
    .from(goals)
    .leftJoin(staffMembers, eq(staffMembers.id, goals.setByStaffId))
    .orderBy(
      // Active goals first, then by period end
      sql`CASE WHEN ${goals.periodEnd} >= current_date THEN 0 ELSE 1 END`,
      asc(goals.periodEnd),
    );

  // Compute progress for each. Parallelize.
  const withProgress = await Promise.all(
    rows.map(async (g) => {
      const goalRow: GoalRow = {
        id: g.id,
        scope: g.scope,
        scopeId: g.scopeId,
        metric: g.metric,
        targetValue: BigInt(g.targetValue as unknown as string | number | bigint),
        periodStart: g.periodStart,
        periodEnd: g.periodEnd,
      };
      const progress = await computeGoalProgress(goalRow);
      return { ...g, progress };
    }),
  );

  const activeCount = withProgress.filter((g) => new Date(g.periodEnd) >= new Date()).length;

  return (
    <div className="flex animate-[fade-in_300ms_ease-out] flex-col gap-8">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <p className="font-mono text-stone-500 text-xs uppercase tracking-widest">Operations</p>
          <h1 className="mt-1 font-semibold text-4xl tracking-tight">Goals</h1>
          <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
            Top-down targets for revenue, venue counts, or outreach activity.
          </p>
        </div>
        <Link
          href="/goals/new"
          className="inline-flex items-center gap-1.5 rounded-md bg-stone-900 px-4 py-2 font-medium text-sm text-stone-50 hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200"
        >
          <Plus className="h-4 w-4" />
          New goal
        </Link>
      </header>

      {withProgress.length === 0 ? (
        <div className="rounded-lg border border-stone-200 border-dashed bg-white p-12 text-center dark:border-stone-800 dark:bg-stone-950">
          <Target className="mx-auto h-8 w-8 text-stone-400" />
          <h3 className="mt-4 font-semibold text-2xl tracking-tight">No goals set yet</h3>
          <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
            Set a goal for a campaign, city, brand, or staff member and the dashboard will track
            progress.
          </p>
          <Link
            href="/goals/new"
            className="mt-6 inline-flex items-center gap-1.5 rounded-md bg-stone-900 px-4 py-2 font-medium text-sm text-stone-50 hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200"
          >
            <Plus className="h-4 w-4" />
            Set your first goal
          </Link>
        </div>
      ) : (
        <>
          <p className="font-mono text-[11px] text-stone-500 uppercase tracking-widest">
            {activeCount} active · {withProgress.length - activeCount} expired
          </p>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {withProgress.map((g) => (
              <GoalCard key={g.id} goal={g} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

interface GoalCardData {
  id: string;
  scope: "campaign" | "outreach_brand" | "crawl_brand" | "city_campaign" | "staff_weekly";
  metric:
    | "revenue_cents"
    | "venue_count"
    | "emails_sent"
    | "calls_made"
    | "confirmations"
    | "replies_received";
  targetValue: string | number | bigint;
  periodStart: string;
  periodEnd: string;
  setByName: string | null;
  progress: {
    current: number;
    applicable: boolean;
    pct: number;
  };
}

function GoalCard({ goal }: { goal: GoalCardData }) {
  const isExpired = new Date(goal.periodEnd) < new Date();
  const targetDisplay = fromStorageValue(
    goal.metric,
    BigInt(goal.targetValue as unknown as string | number | bigint),
  );
  const currentDisplay = fromStorageValue(goal.metric, goal.progress.current);
  const isRevenue = goal.metric === "revenue_cents";

  return (
    <Link
      href={`/goals/${goal.id}`}
      className={cn(
        "block rounded-lg border border-stone-200 bg-white p-5 transition-colors hover:border-stone-300 hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-950 dark:hover:border-stone-700 dark:hover:bg-stone-900",
        isExpired && "opacity-60",
      )}
    >
      <header className="flex items-baseline justify-between">
        <h3 className="font-semibold text-sm tracking-tight">{metricLabel(goal.metric)}</h3>
        <p className="font-mono text-[10px] text-stone-500 uppercase tracking-widest">
          {scopeLabel(goal.scope)}
          {isExpired && " · expired"}
        </p>
      </header>

      <div className="mt-3 flex items-baseline gap-2">
        <p className="font-mono font-semibold text-2xl tabular-nums">
          {isRevenue ? `$${currentDisplay.toLocaleString()}` : currentDisplay.toLocaleString()}
        </p>
        <p className="font-mono text-sm text-stone-500 tabular-nums">
          of {isRevenue ? `$${targetDisplay.toLocaleString()}` : targetDisplay.toLocaleString()}
        </p>
      </div>

      {goal.progress.applicable ? (
        <div className="mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                goal.progress.pct >= 80
                  ? "bg-emerald-500"
                  : goal.progress.pct >= 40
                    ? "bg-amber-500"
                    : "bg-stone-500",
              )}
              style={{ width: `${goal.progress.pct}%` }}
            />
          </div>
          <p
            className={cn(
              "mt-1.5 font-mono text-[11px] tabular-nums",
              goal.progress.pct >= 80
                ? "text-emerald-500"
                : goal.progress.pct >= 40
                  ? "text-amber-500"
                  : "text-stone-500",
            )}
          >
            {goal.progress.pct}% complete
          </p>
        </div>
      ) : (
        <p className="mt-3 font-mono text-[11px] text-stone-400 italic">
          progress not yet tracked for this metric × scope combination
        </p>
      )}

      <footer className="mt-4 flex items-baseline justify-between border-stone-200 border-t pt-3 dark:border-stone-800">
        <p className="font-mono text-[10px] text-stone-500 tabular-nums">
          {formatDate(goal.periodStart)} → {formatDate(goal.periodEnd)}
        </p>
        {goal.setByName && (
          <p className="font-mono text-[10px] text-stone-500">set by {goal.setByName}</p>
        )}
      </footer>
    </Link>
  );
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
