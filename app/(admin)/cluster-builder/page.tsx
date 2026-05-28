import { campaigns, cities, cityCampaigns } from "@/db/schema";
import { buildClustersForCity } from "@/lib/cluster-builder";
import { formatDistance } from "@/lib/clustering";
import { db } from "@/lib/db";
import { asc, eq, isNull } from "drizzle-orm";
import { MapPin, Sliders } from "lucide-react";
import Link from "next/link";

export const metadata = { title: "Cluster builder" };
export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{
    cityId?: string;
    cityCampaignId?: string;
    radius?: string;
  }>;
}

export default async function ClusterBuilderPage({ searchParams }: Props) {
  const params = await searchParams;
  const radiusMeters = Math.max(50, Math.min(2000, Number(params.radius) || 400));

  // Resolve cityId: explicit > derive from cityCampaignId > nothing
  let activeCityId: string | null = params.cityId ?? null;
  const activeCityCampaignId: string | null = params.cityCampaignId ?? null;

  if (!activeCityId && activeCityCampaignId) {
    const cc = await db
      .select({ cityId: cityCampaigns.cityId })
      .from(cityCampaigns)
      .where(eq(cityCampaigns.id, activeCityCampaignId))
      .limit(1);
    activeCityId = cc[0]?.cityId ?? null;
  }

  // Dropdown options: every active city
  const cityOptions = await db
    .select({ id: cities.id, name: cities.name, region: cities.region })
    .from(cities)
    .where(isNull(cities.archivedAt))
    .orderBy(asc(cities.name));

  // For "save as middle group" we need the city_campaigns for the chosen city
  const ccOptions = activeCityId
    ? await db
        .select({
          id: cityCampaigns.id,
          campaignName: campaigns.name,
        })
        .from(cityCampaigns)
        .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
        .where(eq(cityCampaigns.cityId, activeCityId))
        .orderBy(asc(campaigns.name))
    : [];

  const cityName = activeCityId
    ? (cityOptions.find((c) => c.id === activeCityId)?.name ?? "Unknown")
    : null;

  // Run the clustering when a city is picked
  const result = activeCityId ? await buildClustersForCity(activeCityId, radiusMeters) : null;

  return (
    <div className="flex animate-[fade-in_300ms_ease-out] flex-col gap-8">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-zinc-500 uppercase tracking-widest">Lead pipeline</p>
          <h1 className="mt-1 font-semibold text-4xl tracking-tight">Cluster builder</h1>
          <p className="mt-2 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
            Group venues by walking distance. Pick a city, set a walking radius (~5 minutes ≈ 400m),
            and the builder finds tight venue clusters. Save a cluster as a{" "}
            <Link href="/middle-groups" className="underline hover:no-underline">
              Middle Venue Group
            </Link>{" "}
            with one click — the group then attaches to any number of crawls.
          </p>
        </div>
      </header>

      {/* City + radius picker */}
      <section className="card-surface p-5">
        <form className="flex flex-wrap items-end gap-4" method="get">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="cityId"
              className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest"
            >
              City
            </label>
            <select
              id="cityId"
              name="cityId"
              defaultValue={activeCityId ?? ""}
              className="min-w-[200px] rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="">— Pick city —</option>
              {cityOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.region ? ` · ${c.region}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="radius"
              className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest"
            >
              Walking radius
            </label>
            <select
              id="radius"
              name="radius"
              defaultValue={String(radiusMeters)}
              className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="200">200m (~2 min)</option>
              <option value="300">300m (~4 min)</option>
              <option value="400">400m (~5 min)</option>
              <option value="500">500m (~6 min)</option>
              <option value="800">800m (~10 min)</option>
            </select>
          </div>
          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-4 py-2 font-medium text-sm text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            <Sliders className="mr-1 inline h-3.5 w-3.5" />
            Build clusters
          </button>
        </form>
      </section>

      {/* Results */}
      {!result ? (
        <div className="card-surface border-dashed p-12 text-center">
          <MapPin className="mx-auto h-8 w-8 text-zinc-400" />
          <h3 className="mt-4 font-semibold text-2xl tracking-tight">Pick a city to start</h3>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            The builder pulls all active venues with lat/lng coordinates in that city, then groups
            them by walking distance.
          </p>
        </div>
      ) : result.clusters.length === 0 ? (
        <div className="card-surface border-dashed p-12 text-center">
          <MapPin className="mx-auto h-8 w-8 text-zinc-400" />
          <h3 className="mt-4 font-semibold text-2xl tracking-tight">
            No venues with coordinates in {cityName}
          </h3>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            {result.missingCoords} venue
            {result.missingCoords === 1 ? "" : "s"} in this city, but none have lat/lng set yet. Run{" "}
            <Link href="/discover" className="underline">
              discover
            </Link>{" "}
            or set coordinates on individual venues to enable clustering.
          </p>
        </div>
      ) : (
        <section className="flex flex-col gap-4">
          <header className="flex items-baseline justify-between">
            <p className="font-mono text-[11px] text-zinc-500 uppercase tracking-widest">
              {result.clusters.length} cluster
              {result.clusters.length === 1 ? "" : "s"} · {result.venues.length} venues
              {result.missingCoords > 0 && (
                <span className="ml-2 text-amber-500 normal-case tracking-normal">
                  ({result.missingCoords} more without coordinates skipped)
                </span>
              )}
            </p>
            <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
              radius: {radiusMeters}m
            </p>
          </header>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {result.clusters.map((cluster) => {
              const venueIdsParam = cluster.venues.map((v) => v.id).join(",");
              const defaultName = `${cityName ?? "Group"} cluster ${cluster.id + 1}`;
              return (
                <article key={cluster.id} className="card-surface p-5">
                  <header className="flex items-baseline justify-between">
                    <h3 className="font-semibold text-lg tracking-tight">
                      Cluster {cluster.id + 1}
                      <span className="ml-2 font-mono font-normal text-[11px] text-zinc-500 tabular-nums">
                        {cluster.venues.length} venue{cluster.venues.length === 1 ? "" : "s"}
                      </span>
                    </h3>
                    <p className="font-mono text-[10px] text-zinc-500 uppercase tabular-nums tracking-widest">
                      ⌀ {formatDistance(cluster.diameterMeters)}
                    </p>
                  </header>

                  <ul className="mt-3 flex flex-col gap-1.5">
                    {cluster.venues.map((v) => (
                      <li key={v.id} className="flex items-baseline justify-between gap-2 text-sm">
                        <Link href={`/venues/${v.id}`} className="truncate hover:underline">
                          {v.name}
                        </Link>
                        {v.address && (
                          <span className="shrink-0 truncate text-[11px] text-zinc-500">
                            {v.address.split(",")[0]}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>

                  {/* Save-as-group form */}
                  <div className="mt-4 border-zinc-200 border-t pt-3 dark:border-zinc-800/60">
                    {ccOptions.length === 0 ? (
                      <p className="font-mono text-[11px] text-zinc-500">
                        No campaigns reference this city yet — assign one in{" "}
                        <Link href="/city-campaigns" className="underline">
                          City Campaigns
                        </Link>{" "}
                        first.
                      </p>
                    ) : (
                      <form
                        method="get"
                        action="/middle-groups/new"
                        className="flex flex-wrap items-center gap-2"
                      >
                        <input type="hidden" name="venueIds" value={venueIdsParam} />
                        <input type="hidden" name="name" value={defaultName} />
                        <select
                          name="cityCampaignId"
                          required
                          defaultValue={activeCityCampaignId ?? ccOptions[0]?.id}
                          className="flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                        >
                          {ccOptions.map((cc) => (
                            <option key={cc.id} value={cc.id}>
                              {cc.campaignName}
                            </option>
                          ))}
                        </select>
                        <button
                          type="submit"
                          className="rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-xs text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                        >
                          Save as group →
                        </button>
                      </form>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
