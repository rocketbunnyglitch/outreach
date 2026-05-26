import {
  campaigns,
  cities,
  cityCampaigns,
  middleVenueGroupMembers,
  middleVenueGroups,
  venues,
} from "@/db/schema";
import { db } from "@/lib/db";
import { asc, eq } from "drizzle-orm";
import { ChevronLeft, X } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { removeVenueFromMiddleGroup, updateMiddleVenueGroup } from "../_actions";
import { MiddleGroupForm } from "../_components/middle-group-form";

export const metadata = { title: "Middle group · Crawl Engine" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function MiddleGroupDetailPage({ params }: Props) {
  const { id } = await params;

  const [group, members, ccOptions] = await Promise.all([
    db
      .select({
        group: middleVenueGroups,
        cc: cityCampaigns,
        city: cities,
        campaign: campaigns,
      })
      .from(middleVenueGroups)
      .innerJoin(cityCampaigns, eq(cityCampaigns.id, middleVenueGroups.cityCampaignId))
      .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
      .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
      .where(eq(middleVenueGroups.id, id))
      .limit(1)
      .then((r) => r[0]),
    db
      .select({
        memberId: middleVenueGroupMembers.id,
        venueId: venues.id,
        venueName: venues.name,
        venueAddress: venues.address,
        status: middleVenueGroupMembers.status,
        confirmedAt: middleVenueGroupMembers.confirmedAt,
      })
      .from(middleVenueGroupMembers)
      .innerJoin(venues, eq(venues.id, middleVenueGroupMembers.venueId))
      .where(eq(middleVenueGroupMembers.middleVenueGroupId, id))
      .orderBy(asc(venues.name)),
    db
      .select({
        id: cityCampaigns.id,
        cityName: cities.name,
        campaignName: campaigns.name,
      })
      .from(cityCampaigns)
      .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
      .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
      .orderBy(asc(cities.name), asc(campaigns.name)),
  ]);

  if (!group) notFound();

  return (
    <div className="flex animate-[fade-in_300ms_ease-out] flex-col gap-8">
      <header>
        <Link
          href="/middle-groups"
          className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          <ChevronLeft className="h-3 w-3" /> All groups
        </Link>
        <h1 className="mt-3 font-semibold text-4xl tracking-tight">{group.group.name}</h1>
        <p className="mt-2 font-mono text-xs text-zinc-500 tabular-nums">
          {group.city.name} · {group.campaign.name}
          {group.group.dayPart && (
            <>
              {" · "}
              <span className="uppercase tracking-widest">
                {group.group.dayPart.replace("_", " ")}
              </span>
            </>
          )}
        </p>
      </header>

      {/* Members panel */}
      <section className="card-surface p-5">
        <header className="mb-4 flex items-baseline justify-between">
          <h2 className="font-semibold text-lg tracking-tight">
            Member venues
            <span className="ml-2 font-mono font-normal text-[11px] text-zinc-500">
              {members.length}
            </span>
          </h2>
          <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
            attach more via cluster builder or the venue picker (coming)
          </p>
        </header>

        {members.length === 0 ? (
          <p className="py-6 text-center text-xs text-zinc-500 italic">
            No venues attached yet. Use the{" "}
            <Link
              href={`/cluster-builder?cityCampaignId=${group.group.cityCampaignId}`}
              className="underline"
            >
              cluster builder
            </Link>{" "}
            to find venues to attach.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {members.map((m) => (
              <li
                key={m.memberId}
                className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800/60"
              >
                <div className="min-w-0">
                  <Link href={`/venues/${m.venueId}`} className="font-medium hover:underline">
                    {m.venueName}
                  </Link>
                  {m.venueAddress && (
                    <p className="mt-0.5 truncate text-xs text-zinc-500">{m.venueAddress}</p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
                    {m.status}
                  </span>
                  <form
                    action={async (fd: FormData) => {
                      "use server";
                      await removeVenueFromMiddleGroup(null, fd);
                    }}
                  >
                    <input type="hidden" name="id" value={m.memberId} />
                    <button
                      type="submit"
                      className="text-zinc-400 hover:text-rose-500"
                      title="Remove from group"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Edit panel */}
      <MiddleGroupForm
        mode="edit"
        cityCampaigns={ccOptions.map((cc) => ({
          id: cc.id,
          label: `${cc.cityName} · ${cc.campaignName}`,
        }))}
        initial={{
          id: group.group.id,
          cityCampaignId: group.group.cityCampaignId,
          name: group.group.name,
          dayPart: group.group.dayPart ?? "",
          status: group.group.status,
          notes: group.group.notes ?? "",
          version: group.group.version,
        }}
        action={updateMiddleVenueGroup}
      />
    </div>
  );
}
