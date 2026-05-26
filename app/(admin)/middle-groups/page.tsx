import { campaigns, cities, cityCampaigns, middleVenueGroups } from "@/db/schema";
import { db } from "@/lib/db";
import { asc, eq, isNull, sql } from "drizzle-orm";
import { Layers, Plus } from "lucide-react";
import Link from "next/link";

export const metadata = { title: "Middle Venue Groups · Crawl Engine" };
export const dynamic = "force-dynamic";

export default async function MiddleGroupsPage() {
  const groups = await db
    .select({
      id: middleVenueGroups.id,
      name: middleVenueGroups.name,
      dayPart: middleVenueGroups.dayPart,
      status: middleVenueGroups.status,
      cityCampaignId: middleVenueGroups.cityCampaignId,
      cityName: cities.name,
      campaignName: campaigns.name,
      memberCount: sql<number>`(
        SELECT count(*)::int FROM middle_venue_group_members
        WHERE middle_venue_group_id = ${middleVenueGroups.id}
      )`,
      createdAt: middleVenueGroups.createdAt,
    })
    .from(middleVenueGroups)
    .innerJoin(cityCampaigns, eq(cityCampaigns.id, middleVenueGroups.cityCampaignId))
    .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
    .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
    .where(isNull(middleVenueGroups.archivedAt))
    .orderBy(asc(cities.name), asc(campaigns.name), asc(middleVenueGroups.name));

  return (
    <div className="flex animate-[fade-in_300ms_ease-out] flex-col gap-8">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-zinc-500 uppercase tracking-widest">Operations</p>
          <h1 className="mt-1 font-semibold text-4xl tracking-tight">Middle Venue Groups</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Collections of venues that share the "middle" role across multiple crawls within the
            same city. Build groups manually here or auto-detect from walking-distance{" "}
            <Link href="/cluster-builder" className="underline hover:no-underline">
              clusters
            </Link>
            .
          </p>
        </div>
        <Link
          href="/middle-groups/new"
          className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 font-medium text-sm text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          <Plus className="h-4 w-4" />
          New group
        </Link>
      </header>

      {groups.length === 0 ? (
        <div className="card-surface border-dashed p-12 text-center">
          <Layers className="mx-auto h-8 w-8 text-zinc-400" />
          <h3 className="mt-4 font-semibold text-2xl tracking-tight">No groups yet</h3>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Use the cluster builder to auto-detect walking-distance groups from your venue list, or
            build one manually.
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <Link
              href="/cluster-builder"
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-4 py-2 font-medium text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
            >
              Open cluster builder
            </Link>
            <Link
              href="/middle-groups/new"
              className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 font-medium text-sm text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              <Plus className="h-4 w-4" />
              New manual group
            </Link>
          </div>
        </div>
      ) : (
        <div className="card-surface overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-zinc-200 border-b text-left font-mono text-[10px] text-zinc-500 uppercase tracking-widest dark:border-zinc-800/60">
                <th className="px-4 py-2.5">Group</th>
                <th className="px-4 py-2.5">City × Campaign</th>
                <th className="px-4 py-2.5">Day part</th>
                <th className="px-4 py-2.5 text-right">Venues</th>
                <th className="px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g, i) => (
                <tr
                  key={g.id}
                  className={i % 2 === 0 ? "dark:bg-transparent" : "dark:bg-white/[0.015]"}
                >
                  <td className="px-4 py-2.5">
                    <Link href={`/middle-groups/${g.id}`} className="font-medium hover:underline">
                      {g.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-zinc-500 tabular-nums">
                    {g.cityName} · {g.campaignName}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-zinc-500">
                    {g.dayPart ? dayPartLabel(g.dayPart) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">{g.memberCount}</td>
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
                      {g.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function dayPartLabel(dp: string): string {
  switch (dp) {
    case "thursday_night":
      return "Thu Night";
    case "friday_night":
      return "Fri Night";
    case "saturday_day":
      return "Sat Day";
    case "saturday_night":
      return "Sat Night";
    case "sunday_day":
      return "Sun Day";
    case "sunday_night":
      return "Sun Night";
    default:
      return dp;
  }
}
