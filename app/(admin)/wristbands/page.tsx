import {
  events,
  campaigns,
  cities,
  cityCampaigns,
  venueEvents,
  venues,
  wristbands,
} from "@/db/schema";
import { cn } from "@/lib/cn";
import { getCurrentCampaign } from "@/lib/current-campaign";
import { db } from "@/lib/db";
import { and, asc, eq, isNull } from "drizzle-orm";
import { Package } from "lucide-react";
import Link from "next/link";
import { WristbandShippingRow } from "./_components/wristband-shipping-row";

export const metadata = { title: "Wristbands" };
export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ scope?: string; status?: string; ve?: string }>;
}

export default async function WristbandsPage({ searchParams }: Props) {
  const params = await searchParams;
  const allScope = params.scope === "all";
  const filterStatus = params.status ?? null;
  // Deep-link from a city-sheet crawl's wristband dot: focus one
  // wristband-role venue_event. When set, ignore campaign scope so the
  // row always resolves regardless of the current campaign.
  const focusVe = params.ve ?? null;

  const currentCampaign = await getCurrentCampaign();
  const campaignId = !allScope && !focusVe && currentCampaign ? currentCampaign.campaign.id : null;

  // Pull every wristband-role venue_event in scope, joined to wristbands
  // tracking. LEFT join because some confirmed wristband venue_events
  // may not have a wristbands row yet — surface those as "needs setup".
  const rows = await db
    .select({
      venueEventId: venueEvents.id,
      venueId: venues.id,
      venueName: venues.name,
      cityName: cities.name,
      campaignName: campaigns.name,
      eventDate: events.eventDate,
      veStatus: venueEvents.status,
      wristbandId: wristbands.id,
      quantity: wristbands.quantity,
      status: wristbands.status,
      recipientName: wristbands.recipientName,
      recipientPhone: wristbands.recipientPhone,
      shippingAddress: wristbands.shippingAddress,
      carrier: wristbands.carrier,
      trackingNumber: wristbands.trackingNumber,
      shippedAt: wristbands.shippedAt,
      deliveredAt: wristbands.deliveredAt,
      expectedDeliveryDate: wristbands.expectedDeliveryDate,
    })
    .from(venueEvents)
    .innerJoin(venues, eq(venues.id, venueEvents.venueId))
    .innerJoin(cities, eq(cities.id, venues.cityId))
    .innerJoin(events, eq(events.id, venueEvents.eventId))
    .innerJoin(cityCampaigns, eq(cityCampaigns.id, events.cityCampaignId))
    .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
    .leftJoin(wristbands, eq(wristbands.venueEventId, venueEvents.id))
    .where(
      and(
        eq(venueEvents.role, "wristband"),
        eq(venueEvents.status, "confirmed"),
        isNull(events.archivedAt),
        campaignId ? eq(campaigns.id, campaignId) : undefined,
      ),
    )
    .orderBy(asc(events.eventDate), asc(cities.name), asc(venues.name));

  // Filter by status if requested (NEEDS SETUP = no wristbands row yet)
  const statusFiltered = filterStatus
    ? rows.filter((r) => {
        if (filterStatus === "needs_setup") return !r.wristbandId;
        return r.status === filterStatus;
      })
    : rows;
  // A ve deep-link narrows to that single wristband venue_event.
  const filtered = focusVe
    ? statusFiltered.filter((r) => r.venueEventId === focusVe)
    : statusFiltered;

  const stats = {
    total: rows.length,
    needsSetup: rows.filter((r) => !r.wristbandId).length,
    pending: rows.filter((r) => r.status === "pending").length,
    shipped: rows.filter((r) => r.status === "shipped").length,
    delivered: rows.filter((r) => r.status === "delivered").length,
    issues: rows.filter((r) => r.status === "issue").length,
  };

  return (
    <div className="flex animate-[fade-in_300ms_ease-out] flex-col gap-8">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-zinc-500 uppercase tracking-widest">Operations</p>
          <h1 className="mt-1 font-semibold text-4xl tracking-tight">Wristband shipping</h1>
          <p className="mt-2 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
            Track wristband shipments to confirmed wristband-role venues. Auto-created when a
            wristband venue_event flips to confirmed. Missing shipping address or tracking number
            surfaces a task for the operator to chase.
          </p>
        </div>
      </header>

      {/* Scope banner */}
      <div className="card-surface-quiet flex items-baseline justify-between gap-3 px-4 py-2.5">
        <p className="font-mono text-[11px] text-zinc-500 uppercase tracking-widest">
          {campaignId && currentCampaign ? (
            <>
              Scope:{" "}
              <span className="text-zinc-900 dark:text-zinc-100">
                {currentCampaign.campaign.name}
              </span>
            </>
          ) : (
            <>
              Scope: <span className="text-zinc-900 dark:text-zinc-100">all campaigns</span>
            </>
          )}
        </p>
        {campaignId ? (
          <Link
            href="/wristbands?scope=all"
            className="font-mono text-[11px] text-zinc-500 uppercase tracking-widest hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            view all →
          </Link>
        ) : currentCampaign ? (
          <Link
            href="/wristbands"
            className="font-mono text-[11px] text-zinc-500 uppercase tracking-widest hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            ← scope to {currentCampaign.campaign.name}
          </Link>
        ) : null}
      </div>

      {/* Stats strip */}
      {stats.total > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <StatCard label="Total" value={stats.total} />
          <StatCard
            label="Needs setup"
            value={stats.needsSetup}
            href={stats.needsSetup > 0 ? "/wristbands?status=needs_setup" : undefined}
            tone="amber"
          />
          <StatCard label="Pending" value={stats.pending} tone="amber" />
          <StatCard label="Shipped" value={stats.shipped} tone="blue" />
          <StatCard label="Delivered" value={stats.delivered} tone="emerald" />
          <StatCard label="Issues" value={stats.issues} tone="rose" />
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="card-surface border-dashed p-12 text-center">
          <Package className="mx-auto h-8 w-8 text-zinc-400" />
          <h3 className="mt-4 font-semibold text-2xl tracking-tight">
            {rows.length === 0
              ? "No confirmed wristband venues yet"
              : "Nothing matches that filter"}
          </h3>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            {rows.length === 0
              ? "When you flip a wristband-role venue_event to confirmed, it appears here for shipping tracking."
              : "Clear the filter to see all wristbands."}
          </p>
        </div>
      ) : (
        <div className="card-surface overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-zinc-200 border-b text-left font-mono text-[10px] text-zinc-500 uppercase tracking-widest dark:border-zinc-800/60">
                <th className="px-4 py-2.5">Venue</th>
                <th className="px-4 py-2.5">Recipient</th>
                <th className="px-4 py-2.5">Shipping</th>
                <th className="px-4 py-2.5">Tracking</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="w-10 px-2 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <WristbandShippingRow key={r.venueEventId} row={r} striped={i % 2 === 1} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  href,
  tone,
}: {
  label: string;
  value: number;
  href?: string;
  tone?: "amber" | "blue" | "emerald" | "rose";
}) {
  const toneClass =
    tone === "amber"
      ? "text-amber-500"
      : tone === "blue"
        ? "text-blue-500"
        : tone === "emerald"
          ? "text-emerald-500"
          : tone === "rose"
            ? "text-rose-500"
            : "";
  const Body = (
    <div
      className={cn(
        "card-surface-quiet p-4",
        href && "transition-colors hover:brightness-110 dark:hover:brightness-125",
      )}
    >
      <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">{label}</p>
      <p className={cn("mt-2 font-mono font-semibold text-2xl tabular-nums", toneClass)}>{value}</p>
    </div>
  );
  return href ? <Link href={href}>{Body}</Link> : Body;
}
