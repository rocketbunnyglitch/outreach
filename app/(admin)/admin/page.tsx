import { Button } from "@/components/ui/button";
import { campaigns, cities, cityCampaigns, staffMembers } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { asc, eq, isNull, sql } from "drizzle-orm";
import {
  Archive,
  ArrowRight,
  Building2,
  Edit3,
  Globe,
  Plus,
  Settings2,
  Sparkles,
  Users,
} from "lucide-react";
import Link from "next/link";
import { CsvImportWidget } from "./_components/csv-import-widget";

export const metadata = { title: "Admin · Crawl Engine" };
export const dynamic = "force-dynamic";

/**
 * Admin hub.
 *
 * Design intent:
 *   • Premium, calm. Three sections stack vertically with breathing
 *     space. No tabs, no nested routers.
 *   • Each section is a self-contained card with its own header,
 *     contents, and primary action.
 *   • The CSV import widget lives here because it's the highest-value
 *     admin operation for the upcoming Halloween push.
 *
 * Sections:
 *   1. Stats strip (campaigns, cities, staff — read-only summary)
 *   2. Campaigns (table with create + edit, archive)
 *   3. CSV import (bulk-load cities + crawl instances)
 *   4. Master cities directory (count + link to add)
 */
export default async function AdminPage() {
  await requireAdmin();

  const [campaignRows, cityCount, ccCount, staffCount] = await Promise.all([
    db
      .select({
        id: campaigns.id,
        name: campaigns.name,
        slug: campaigns.slug,
        status: campaigns.status,
        startDate: campaigns.startDate,
        archivedAt: campaigns.archivedAt,
        cityCount: sql<number>`(
          SELECT count(*)::int FROM city_campaigns
          WHERE city_campaigns.campaign_id = ${campaigns.id}
        )`,
      })
      .from(campaigns)
      .orderBy(asc(campaigns.archivedAt), asc(campaigns.name)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(cities)
      .where(isNull(cities.archivedAt))
      .then((r) => Number(r[0]?.count ?? 0)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(cityCampaigns)
      .then((r) => Number(r[0]?.count ?? 0)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(staffMembers)
      .where(eq(staffMembers.status, "active"))
      .then((r) => Number(r[0]?.count ?? 0)),
  ]);

  const activeCampaigns = campaignRows.filter((c) => !c.archivedAt);
  const archivedCampaigns = campaignRows.filter((c) => c.archivedAt);

  return (
    <div className="mx-auto flex max-w-5xl animate-[fade-in_300ms_ease-out] flex-col gap-8">
      {/* Page header */}
      <header className="flex flex-col gap-2">
        <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.18em]">
          Operations
        </p>
        <h1 className="font-semibold text-4xl tracking-tight">Admin</h1>
        <p className="max-w-2xl text-sm text-zinc-600 leading-relaxed dark:text-zinc-400">
          Manage campaigns, the master city directory, and team membership. Use the bulk import to
          spin up a campaign's full city list and crawl roster from CSV in one paste.
        </p>
      </header>

      {/* Stats strip */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          icon={<Sparkles className="h-3.5 w-3.5" />}
          label="Active campaigns"
          value={activeCampaigns.length}
          href="#campaigns"
        />
        <StatCard
          icon={<Globe className="h-3.5 w-3.5" />}
          label="Cities in campaigns"
          value={ccCount}
        />
        <StatCard
          icon={<Building2 className="h-3.5 w-3.5" />}
          label="Master cities"
          value={cityCount}
          href="/cities"
        />
        <StatCard
          icon={<Users className="h-3.5 w-3.5" />}
          label="Active staff"
          value={staffCount}
        />
      </section>

      {/* Campaigns */}
      <section
        id="campaigns"
        className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-sm shadow-zinc-200/40 dark:border-zinc-800/60 dark:bg-zinc-950/60 dark:shadow-none"
      >
        <header className="flex items-baseline justify-between gap-3 border-zinc-200/60 border-b px-6 py-4 dark:border-zinc-800/40">
          <div>
            <h2 className="inline-flex items-center gap-2.5 font-semibold text-lg tracking-tight">
              <Settings2 className="h-4 w-4 text-zinc-500" />
              Campaigns
            </h2>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
              Holiday-scoped rollouts. Each campaign is a brand × year × holiday combination.
            </p>
          </div>
          <Button asChild size="sm">
            <Link href="/campaigns/new">
              <Plus className="h-3.5 w-3.5" />
              New campaign
            </Link>
          </Button>
        </header>

        {activeCampaigns.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="font-medium text-sm text-zinc-700 dark:text-zinc-300">
              No active campaigns
            </p>
            <p className="mt-1 text-xs text-zinc-500">Create your first campaign to get started.</p>
          </div>
        ) : (
          <ul className="divide-y divide-zinc-200/60 dark:divide-zinc-800/40">
            {activeCampaigns.map((c) => (
              <CampaignRow key={c.id} campaign={c} />
            ))}
          </ul>
        )}

        {archivedCampaigns.length > 0 && (
          <details className="border-zinc-200/60 border-t dark:border-zinc-800/40">
            <summary className="cursor-pointer px-6 py-3 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em] hover:text-zinc-900 dark:hover:text-zinc-100">
              {archivedCampaigns.length} archived
            </summary>
            <ul className="divide-y divide-zinc-200/60 px-0 opacity-70 dark:divide-zinc-800/40">
              {archivedCampaigns.map((c) => (
                <CampaignRow key={c.id} campaign={c} />
              ))}
            </ul>
          </details>
        )}
      </section>

      {/* CSV import */}
      <CsvImportWidget campaigns={activeCampaigns.map((c) => ({ id: c.id, name: c.name }))} />

      {/* Master cities pointer */}
      <section className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-sm shadow-zinc-200/40 dark:border-zinc-800/60 dark:bg-zinc-950/60 dark:shadow-none">
        <header className="flex items-baseline justify-between gap-3 border-zinc-200/60 border-b px-6 py-4 dark:border-zinc-800/40">
          <div>
            <h2 className="inline-flex items-center gap-2.5 font-semibold text-lg tracking-tight">
              <Building2 className="h-4 w-4 text-zinc-500" />
              Master cities
            </h2>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
              {cityCount} cities with timezone + coordinates. The CSV importer resolves names
              against this list.
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href="/cities">
              Manage <ArrowRight className="h-3 w-3" />
            </Link>
          </Button>
        </header>
        <div className="px-6 py-4 text-xs text-zinc-500">
          Cities not in the directory will be flagged during CSV import. Add them via{" "}
          <Link
            href="/cities/new"
            className="text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-300"
          >
            New city
          </Link>{" "}
          to populate timezone + coordinates once, then reuse across campaigns.
        </div>
      </section>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  href?: string;
}) {
  const inner = (
    <div className="flex h-full flex-col justify-between rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-sm shadow-zinc-200/40 transition-all duration-200 hover:border-zinc-300 hover:shadow-md dark:border-zinc-800/60 dark:bg-zinc-950/60 dark:shadow-none dark:hover:border-zinc-700">
      <div className="flex items-center gap-1.5 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
        {icon}
        {label}
      </div>
      <div className="mt-3 font-mono font-semibold text-3xl text-zinc-900 tabular-nums tracking-tight dark:text-zinc-100">
        {value}
      </div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function CampaignRow({
  campaign,
}: {
  campaign: {
    id: string;
    name: string;
    slug: string;
    status: string;
    startDate: string | null;
    archivedAt: Date | null;
    cityCount: number;
  };
}) {
  // Extract year from startDate when present (e.g. "2026-10-30" → "2026")
  const year = campaign.startDate ? campaign.startDate.slice(0, 4) : null;
  return (
    <li>
      <Link
        href={`/campaigns/${campaign.id}`}
        className="flex items-center gap-4 px-6 py-3.5 transition-colors hover:bg-zinc-50/60 dark:hover:bg-zinc-900/40"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2.5">
            <h3 className="font-medium text-zinc-900 dark:text-zinc-100">{campaign.name}</h3>
            {year && (
              <span className="font-mono text-[10px] text-zinc-500 tabular-nums">{year}</span>
            )}
          </div>
          <p className="mt-0.5 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em]">
            {campaign.slug} · {campaign.status}
          </p>
        </div>
        <div className="flex items-baseline gap-2 font-mono text-xs tabular-nums">
          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
            {campaign.cityCount}
          </span>
          <span className="text-[10px] text-zinc-500 uppercase tracking-[0.1em]">
            {campaign.cityCount === 1 ? "city" : "cities"}
          </span>
        </div>
        {campaign.archivedAt && <Archive className="h-3.5 w-3.5 text-zinc-400" />}
        <Edit3 className="h-3.5 w-3.5 text-zinc-400" />
      </Link>
    </li>
  );
}
