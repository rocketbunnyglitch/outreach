import type { CityFocus } from "@/lib/city-focus";
import { Send } from "lucide-react";
import Link from "next/link";

/**
 * "Cold outreach focus" -- the first card on the daily worklist. Tells the
 * staffer which of their assigned cities to cold-email TODAY: top two by
 * priority that are still under the 30-contacted target, plus how much
 * daily send capacity they have left. Pure presentational server component;
 * data comes from lib/city-focus.ts.
 */
export function CityFocusSection({ focus }: { focus: CityFocus }) {
  if (focus.assignedTotal === 0) {
    return (
      <section className="card-surface px-5 py-4">
        <h2 className="flex items-center gap-2 font-semibold text-sm tracking-tight">
          <Send className="h-3.5 w-3.5 text-zinc-400" /> Cold outreach focus
        </h2>
        <p className="mt-1.5 text-sm text-zinc-500">
          No cities are assigned to you yet. Claim one on the{" "}
          <Link href="/tracker" className="underline underline-offset-2">
            Tracker
          </Link>{" "}
          — or queue an email in a city and it auto-assigns to you.
        </p>
      </section>
    );
  }

  return (
    <section className="card-surface px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold text-sm tracking-tight">
          <Send className="h-3.5 w-3.5 text-zinc-400" /> Cold outreach focus — today
        </h2>
        <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
          {focus.remainingSendsToday} cold send{focus.remainingSendsToday === 1 ? "" : "s"} left
          today
        </span>
      </div>

      {focus.focus.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          All {focus.assignedTotal} of your assigned cities have hit the{" "}
          {focus.focus[0]?.target ?? 30}-contact target — ask for the next batch of cities on the{" "}
          <Link href="/tracker" className="underline underline-offset-2">
            Tracker
          </Link>
          .
        </p>
      ) : (
        <>
          <ol className="mt-3 flex flex-col gap-2">
            {focus.focus.map((c, i) => (
              <li key={c.cityCampaignId} className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em]">
                  {i + 1}.
                </span>
                <Link
                  href={`/city-campaigns/${c.cityCampaignId}`}
                  className="font-medium text-sm underline-offset-2 hover:underline"
                >
                  {c.cityName}
                </Link>
                <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
                  P{c.priority}
                </span>
                <span className="ml-auto font-mono text-[11px] text-zinc-500 tabular-nums">
                  {c.contacted}/{c.target} contacted
                </span>
                <div className="h-1 w-24 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-emerald-500"
                    style={{
                      width: `${Math.min(100, Math.round((c.contacted / c.target) * 100))}%`,
                    }}
                  />
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-zinc-500">
            Max out today&apos;s sends on city 1 first; past {focus.focus[0]?.target ?? 30}{" "}
            contacted, move to the next city by priority.
            {focus.atTarget > 0 &&
              ` ${focus.atTarget} of your cities ${focus.atTarget === 1 ? "is" : "are"} already at target.`}
          </p>
        </>
      )}
    </section>
  );
}
