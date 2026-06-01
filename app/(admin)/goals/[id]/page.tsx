import { Button } from "@/components/ui/button";
import { goals, staffMembers } from "@/db/schema";
import { db } from "@/lib/db";
import { type GoalRow, computeGoalProgress } from "@/lib/goal-progress";
import { fromStorageValue, metricLabel, scopeLabel } from "@/lib/validation/goals";
import { eq } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteGoal, updateGoal } from "../_actions";
import { GoalForm } from "../_components/goal-form";
import { loadScopeOptions } from "../_scope-options";

export const metadata = { title: "Goal" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function GoalDetailPage({ params }: Props) {
  const { id } = await params;

  const [goal, options] = await Promise.all([
    db
      .select({
        id: goals.id,
        scope: goals.scope,
        scopeId: goals.scopeId,
        metric: goals.metric,
        targetValue: goals.targetValue,
        periodStart: goals.periodStart,
        periodEnd: goals.periodEnd,
        version: goals.version,
        setByName: staffMembers.displayName,
      })
      .from(goals)
      .leftJoin(staffMembers, eq(staffMembers.id, goals.setByStaffId))
      .where(eq(goals.id, id))
      .limit(1)
      .then((r) => r[0]),
    loadScopeOptions(),
  ]);

  if (!goal) notFound();

  const targetDisplay = fromStorageValue(
    goal.metric,
    BigInt(goal.targetValue as unknown as string | number | bigint),
  );

  const goalRow: GoalRow = {
    id: goal.id,
    scope: goal.scope,
    scopeId: goal.scopeId,
    metric: goal.metric,
    targetValue: BigInt(goal.targetValue as unknown as string | number | bigint),
    periodStart: goal.periodStart,
    periodEnd: goal.periodEnd,
  };
  const progress = await computeGoalProgress(goalRow);
  const currentDisplay = fromStorageValue(goal.metric, progress.current);
  const isRevenue = goal.metric === "revenue_cents";

  return (
    <div className="flex animate-[fade-in_300ms_ease-out] flex-col gap-8">
      <header>
        <Link
          href="/goals"
          className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          <ChevronLeft className="h-3 w-3" /> All goals
        </Link>
        <h1 className="mt-3 font-semibold text-4xl tracking-tight">
          {metricLabel(goal.metric)} <span className="text-zinc-500">·</span>{" "}
          <span className="text-zinc-500">{scopeLabel(goal.scope)}</span>
        </h1>
      </header>

      {/* Progress summary */}
      <section className="card-surface p-6">
        <div className="flex items-baseline justify-between">
          <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">Progress</p>
          {progress.applicable && (
            <p className="font-mono text-xs text-zinc-500 tabular-nums">{progress.pct}%</p>
          )}
        </div>
        <p className="mt-2 font-mono font-semibold text-3xl tabular-nums">
          {isRevenue
            ? `$${currentDisplay.toLocaleString("en-US")}`
            : currentDisplay.toLocaleString("en-US")}
          <span className="ml-2 text-base text-zinc-500">
            of{" "}
            {isRevenue
              ? `$${targetDisplay.toLocaleString("en-US")}`
              : targetDisplay.toLocaleString("en-US")}
          </span>
        </p>
        {progress.applicable && (
          <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div
              className={
                progress.pct >= 80
                  ? "h-full rounded-full bg-emerald-500 transition-all"
                  : progress.pct >= 40
                    ? "h-full rounded-full bg-rose-500 transition-all"
                    : "h-full rounded-full bg-zinc-500 transition-all"
              }
              style={{ width: `${progress.pct}%` }}
            />
          </div>
        )}
        {!progress.applicable && (
          <p className="mt-3 font-mono text-[11px] text-zinc-400 italic">
            Progress tracking not yet implemented for this metric × scope combination.
          </p>
        )}
      </section>

      <GoalForm
        mode="edit"
        campaigns={options.campaigns}
        outreachBrands={options.outreachBrands}
        crawlBrands={options.crawlBrands}
        cityCampaigns={options.cityCampaigns}
        staff={options.staff}
        initial={{
          id: goal.id,
          scope: goal.scope,
          scopeId: goal.scopeId,
          metric: goal.metric,
          targetValueDisplay: targetDisplay,
          periodStart: goal.periodStart,
          periodEnd: goal.periodEnd,
          version: goal.version,
        }}
        action={updateGoal}
      />

      <form
        action={async (fd: FormData) => {
          "use server";
          await deleteGoal(null, fd);
        }}
        className="flex items-center justify-between rounded-md border border-rose-200 bg-rose-50 p-4 dark:border-rose-900 dark:bg-rose-950"
      >
        <input type="hidden" name="id" value={goal.id} />
        <div>
          <p className="font-medium text-rose-900 text-sm dark:text-rose-200">Delete this goal</p>
          <p className="mt-1 text-rose-800 text-xs dark:text-rose-300">
            Goals are deleted outright (no undo via UI). Audit log keeps the record.
          </p>
        </div>
        <Button type="submit" variant="destructive">
          Delete
        </Button>
      </form>
    </div>
  );
}
