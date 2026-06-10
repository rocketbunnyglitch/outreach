import type { TeamMemberSummary } from "@/lib/team-city-summary";
import Link from "next/link";

/**
 * Dashboard footer cards (operator request 2026-06-10):
 *   1. Confirmed venues per user (responsibility = "Scheduled by").
 *   2. Open (non-completed) cities per user.
 *   3. Every user's cities, with priority + tickets sold beside each name.
 * Pure presentational server components; data from lib/team-city-summary.
 */
export function TeamCityCards({ team }: { team: TeamMemberSummary[] }) {
  if (team.length === 0) return null;
  const byConfirmed = [...team].sort((a, b) => b.confirmedVenues - a.confirmedVenues);
  const byOpen = [...team].sort((a, b) => b.openCities - a.openCities);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <section className="card-surface px-5 py-4">
        <h2 className="font-semibold text-sm tracking-tight">Confirmed venues per person</h2>
        <ul className="mt-3 flex flex-col gap-1.5">
          {byConfirmed.map((m) => (
            <li key={m.staffId} className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate">{m.displayName}</span>
              <span className="font-mono text-[11px] text-zinc-500 tabular-nums">
                {m.confirmedVenues}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card-surface px-5 py-4">
        <h2 className="font-semibold text-sm tracking-tight">Open cities per person</h2>
        <p className="mt-0.5 text-[11px] text-zinc-500">planning or active, not yet completed</p>
        <ul className="mt-2.5 flex flex-col gap-1.5">
          {byOpen.map((m) => (
            <li key={m.staffId} className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate">{m.displayName}</span>
              <span className="font-mono text-[11px] text-zinc-500 tabular-nums">
                {m.openCities}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card-surface px-5 py-4">
        <h2 className="font-semibold text-sm tracking-tight">Everyone&apos;s cities</h2>
        <div className="mt-3 flex max-h-72 flex-col gap-3 overflow-y-auto pr-1">
          {team.map((m) => (
            <div key={m.staffId}>
              <p className="font-medium text-xs text-zinc-700 dark:text-zinc-300">
                {m.displayName}
                <span className="ml-1.5 font-mono text-[10px] text-zinc-500">
                  {m.cities.length} cit{m.cities.length === 1 ? "y" : "ies"}
                </span>
              </p>
              {m.cities.length > 0 ? (
                <ul className="mt-1 flex flex-col gap-0.5">
                  {m.cities.map((c) => (
                    <li
                      key={c.cityCampaignId}
                      className="flex items-baseline gap-2 font-mono text-[11px] text-zinc-500"
                    >
                      <Link
                        href={`/city-campaigns/${c.cityCampaignId}`}
                        className="truncate text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400"
                      >
                        {c.cityName}
                      </Link>
                      <span>P{c.priority}</span>
                      <span className="ml-auto tabular-nums">{c.ticketsSold} sold</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-0.5 font-mono text-[11px] text-zinc-400">no cities assigned</p>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
