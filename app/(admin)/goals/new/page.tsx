import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { createGoal } from "../_actions";
import { GoalForm } from "../_components/goal-form";
import { loadScopeOptions } from "../_scope-options";

export const metadata = { title: "New goal" };
export const dynamic = "force-dynamic";

export default async function NewGoalPage() {
  const options = await loadScopeOptions();

  return (
    <div className="flex animate-[fade-in_300ms_ease-out] flex-col gap-8">
      <header>
        <Link
          href="/goals"
          className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          <ChevronLeft className="h-3 w-3" /> All goals
        </Link>
        <h1 className="mt-3 font-semibold text-4xl tracking-tight">New goal</h1>
      </header>
      <GoalForm
        mode="create"
        campaigns={options.campaigns}
        outreachBrands={options.outreachBrands}
        crawlBrands={options.crawlBrands}
        cityCampaigns={options.cityCampaigns}
        staff={options.staff}
        action={createGoal}
      />
    </div>
  );
}
