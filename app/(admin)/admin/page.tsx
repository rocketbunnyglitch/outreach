import { Button } from "@/components/ui/button";
import { campaigns, cities, cityCampaigns, staffMembers } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { CAMPAIGN_REGISTRY } from "@/lib/import/campaigns";
import { logger } from "@/lib/logger";
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
  Target,
  Users,
} from "lucide-react";
import Link from "next/link";
import { getUnclassifiedCount } from "./_actions-classifier";
import { getUntaggedVenueCount } from "./_actions-venue-tag";
import { CampaignImportPanel } from "./_components/campaign-import-panel";
import { ClassifierBackfillPanel } from "./_components/classifier-backfill-panel";
import { CsvImportWidget } from "./_components/csv-import-widget";
import { VenueTagBackfillPanel } from "./_components/venue-tag-backfill-panel";

export const metadata = { title: "Admin" };
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
  try {
    return await renderAdminPage();
  } catch (err) {
    // Last-resort safety net for anything not caught by the
    // Promise.allSettled below or the JSX-tree error boundary.
    // Renders an inline error UI with the ACTUAL error message
    // (no PM2 grep needed) because we catch it in our own code
    // before Next.js redacts it for production.
    const detail = (err as Error)?.message ?? String(err);
    const code = `S-${Math.floor(Date.now() / 60000)
      .toString(36)
      .toUpperCase()
      .padStart(4, "0")
      .slice(-4)}-${Math.random().toString(36).toUpperCase().slice(2, 6)}`;
    logger.error({ err, code }, "admin page render: unhandled throw");
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <div className="rounded-md border border-rose-200 bg-rose-50/60 p-4 dark:border-rose-900/40 dark:bg-rose-950/30">
          <p className="font-mono text-[10px] text-rose-700 uppercase tracking-[0.18em] dark:text-rose-300">
            Render error — code {code}
          </p>
          <h1 className="mt-2 font-semibold text-lg tracking-tight">Couldn't render /admin</h1>
          <p className="mt-2 text-sm text-rose-900 leading-relaxed dark:text-rose-100">
            The admin page hit an error during data preparation. The full message is below — paste
            it into Claude for a diagnosis.
          </p>
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded bg-white/80 p-3 font-mono text-[11px] text-rose-900 dark:bg-zinc-950/60 dark:text-rose-100">
            {detail}
          </pre>
        </div>
      </div>
    );
  }
}

async function renderAdminPage() {
  await requireAdmin();

  // Promise.allSettled so one broken query can't crash the whole
  // admin page. Each fulfilled value is unwrapped to a sensible
  // default. Each rejection is logged + folded into a top-level
  // "dataIssues" list the page surfaces in a red banner so the
  // operator sees exactly what's broken (and the rest of the page
  // still renders so they can use other admin tools).
  const dataIssues: string[] = [];
  const safeNumber = (
    settled: PromiseSettledResult<number>,
    label: string,
    fallback = 0,
  ): number => {
    if (settled.status === "fulfilled") return settled.value;
    const msg = (settled.reason as Error)?.message ?? String(settled.reason);
    logger.error({ err: settled.reason, label }, "admin page query failed");
    dataIssues.push(`${label}: ${msg}`);
    return fallback;
  };

  const results = await Promise.allSettled([
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
    // Snapshot for the classifier backfill panel — refreshed via
    // router.refresh() after each batch click.
    getUnclassifiedCount(),
    // Snapshot for the AI venue-tag backfill panel (Haiku ROI #8).
    // Counts venues with empty venueType arrays so the operator
    // knows the size of the backlog before clicking.
    getUntaggedVenueCount(),
  ]);

  const campaignRows = results[0].status === "fulfilled" ? results[0].value : [];
  if (results[0].status === "rejected") {
    const msg = (results[0].reason as Error)?.message ?? String(results[0].reason);
    logger.error({ err: results[0].reason }, "admin page: campaigns query failed");
    dataIssues.push(`campaigns: ${msg}`);
  }

  const cityCount = safeNumber(results[1] as PromiseSettledResult<number>, "cities count");
  const ccCount = safeNumber(results[2] as PromiseSettledResult<number>, "city_campaigns count");
  const staffCount = safeNumber(results[3] as PromiseSettledResult<number>, "staff count");
  const unclassifiedCount = safeNumber(
    results[4] as PromiseSettledResult<number>,
    "unclassified thread count",
  );
  const untaggedVenueCount = safeNumber(
    results[5] as PromiseSettledResult<number>,
    "untagged venue count",
  );

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

      {/* Data issues banner — surfaces any per-query failure from
          the page's Promise.allSettled so the operator can see
          exactly what's broken instead of getting a generic 500
          on the whole page. Each issue lists the failing source
          + the error message. */}
      {dataIssues.length > 0 && (
        <section className="rounded-md border border-rose-200 bg-rose-50/60 px-4 py-3 text-xs dark:border-rose-900/40 dark:bg-rose-950/30">
          <p className="font-mono text-[10px] text-rose-700 uppercase tracking-[0.08em] dark:text-rose-300">
            Data issues — {dataIssues.length}
          </p>
          <p className="mt-1 text-rose-900 dark:text-rose-100">
            Some admin stats failed to load. The rest of the page rendered normally, but these
            counters may be stale. Most common cause: a new migration hasn't been applied yet.
          </p>
          <ul className="mt-2 list-disc pl-5">
            {dataIssues.map((issue) => (
              <li
                key={issue.slice(0, 40)}
                className="font-mono text-[11px] text-rose-900 dark:text-rose-100"
              >
                {issue}
              </li>
            ))}
          </ul>
        </section>
      )}

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
      <section id="campaigns" className="card-surface overflow-hidden">
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
      <section className="card-surface overflow-hidden">
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

      {/* Goals link — admin-only ticket-sales targets per #025. */}
      <section className="card-surface overflow-hidden">
        <header className="flex items-center justify-between px-6 py-4">
          <div className="flex items-start gap-3">
            <Target className="mt-0.5 h-5 w-5 text-zinc-500" />
            <div>
              <h2 className="font-semibold text-lg tracking-tight">Ticket-sales goals</h2>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                Set per-campaign ticket-sales targets. Admin-only — outreach staff don't see dollar
                / count targets per decision #025.
              </p>
            </div>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href="/admin/goals">
              Open <ArrowRight className="h-3 w-3" />
            </Link>
          </Button>
        </header>
      </section>

      {/* Archived venues — soft-deleted records. Admin can restore
          (clear archived_at) or permanently delete (cascading DELETE
          through outreach + events + history). Per operator:
          "an Archived Venue tab should be in Admin and allow me to
          restore if needed". The archive verb itself lives on the
          per-row affordance in the city-venues list (under cold
          outreach on each city sheet) or on the venue detail page. */}
      <section className="card-surface overflow-hidden">
        <header className="flex items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-start gap-3">
            <Archive className="mt-0.5 h-5 w-5 text-zinc-500" />
            <div>
              <h2 className="font-semibold text-lg tracking-tight">Archived venues</h2>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                Soft-deleted venues. Restore to bring them back, or permanently delete (cascades
                through outreach + events + history; cannot be undone).
              </p>
            </div>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href="/admin/archived-venues">
              Open <ArrowRight className="h-3 w-3" />
            </Link>
          </Button>
        </header>
      </section>

      {/* Archived cities — parallel surface to archived-venues. Per
          operator: "from the cities tab you should be able to
          permanently delete a city as an admin not just archive". */}
      <section className="card-surface overflow-hidden">
        <header className="flex items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-start gap-3">
            <Archive className="mt-0.5 h-5 w-5 text-zinc-500" />
            <div>
              <h2 className="font-semibold text-lg tracking-tight">Archived cities</h2>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                Soft-deleted cities. Restore to bring them back to the master directory, or
                permanently delete (cascades through venues + campaigns; cannot be undone).
              </p>
            </div>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href="/admin/archived-cities">
              Open <ArrowRight className="h-3 w-3" />
            </Link>
          </Button>
        </header>
      </section>

      {/* Archived campaigns — third archive surface. Per operator:
          "archived campaigns should not show on the dropdown
          campaign at the top nor on the non-admin home page". Both
          filters already in place (campaign-switcher.tsx line 25 +
          getCurrentCampaign in lib/current-campaign.ts line 63).
          This page is the restore + hard-delete surface. */}
      <section className="card-surface overflow-hidden">
        <header className="flex items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-start gap-3">
            <Archive className="mt-0.5 h-5 w-5 text-zinc-500" />
            <div>
              <h2 className="font-semibold text-lg tracking-tight">Archived campaigns</h2>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                Soft-deleted campaigns. Hidden from the campaign switcher and the non-admin home
                page. Restore brings them back (status → planning); permanently delete cascades
                through city_campaigns + events + cold_outreach (irreversible).
              </p>
            </div>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href="/admin/archived-campaigns">
              Open <ArrowRight className="h-3 w-3" />
            </Link>
          </Button>
        </header>
      </section>

      {/* Classifier backfill — admin-only tool to apply the rule-based
          triage classifier to historical unclassified threads. The
          classifier runs live on new mail (gmail-poll-worker.ts), but
          threads from before we shipped triage stay 'unclassified' and
          need this batch sweep. */}
      <section className="card-surface overflow-hidden">
        <header className="flex items-start gap-3 px-6 pt-4 pb-2">
          <Sparkles className="mt-0.5 h-5 w-5 text-zinc-500" />
          <div>
            <h2 className="font-semibold text-lg tracking-tight">Inbox classifier backfill</h2>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
              Re-classify historical inbox threads stuck at "unclassified". Runs the same rule-based
              engine that fires on incoming mail. Idempotent — safe to re-run; only touches threads
              currently marked unclassified.
            </p>
          </div>
        </header>
        <ClassifierBackfillPanel initialUnclassified={unclassifiedCount} />
      </section>

      {/* AI venue-type backfill (Haiku ROI #8). Sweeps venues with
          empty venueType arrays + asks Haiku for tags from a fixed
          vocabulary. Operator manual edits are never overwritten.
          Cheap — ~$0.0001/venue, ~$0.30 for 3000-venue full run. */}
      <section className="card-surface overflow-hidden">
        <header className="flex items-start gap-3 px-6 pt-4 pb-2">
          <Sparkles className="mt-0.5 h-5 w-5 text-violet-500" />
          <div>
            <h2 className="font-semibold text-lg tracking-tight">AI venue-type tagging</h2>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
              Many venues have empty venue_type arrays because the column was added later. This
              one-time backfill reads name + address + city and picks tags from a fixed vocabulary
              (bar, lounge, cocktail_bar, dive_bar, etc). Skips any venue that's already tagged —
              manual edits are never overwritten.
            </p>
          </div>
        </header>
        <VenueTagBackfillPanel initialUntaggedCount={untaggedVenueCount} />
      </section>

      {/* Halloween 2025 import (Phase 3). Reads data/halloween_2025.json
      {/* ----------------------------------------------------------------
          Campaign imports — one section per campaign in the registry,
          recency-ordered (newest first). Each section runs the same
          generic CampaignImportPanel with its own config: slug, name,
          mode (active/history), and JSON / overrides paths.

          The first time you ship a new campaign:
            1. Parse the xlsx → data/<slug>.json via scripts/parse-campaign-xlsx.py
            2. Add the campaign config to lib/import/campaigns.ts
            3. Add a section here that mounts CampaignImportPanel
            4. Run dry-run to verify the city + label mappings
            5. Apply for real once the numbers look right
            6. After the verify pass, drop the resolver-overrides JSON
               into data/<slug>_resolver_overrides.json and re-run
                                                                ---------------- */}
      {CAMPAIGN_REGISTRY.map((cfg) => (
        <section key={cfg.slug} className="card-surface overflow-hidden">
          <header className="flex items-start gap-3 px-6 pt-4 pb-2">
            <Sparkles className="mt-0.5 h-5 w-5 text-violet-500" />
            <div>
              <h2 className="font-semibold text-lg tracking-tight">{cfg.name} import</h2>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                {cfg.mode === "history"
                  ? `Historical import from the parsed ${cfg.name} xlsx. Writes venues + venue_events for confirmed slots so the city-venues table shows "previously used in ${cfg.name}" history. Skips the cold-outreach queue (past campaign).`
                  : `One-time import from the parsed ${cfg.name} xlsx. Run dry-run first to review decisions, then apply for real. After applying, download the review queue markdown and hand it to Claude Code to verify stubs against Google Maps via Claude in Chrome.`}
              </p>
            </div>
          </header>
          <CampaignImportPanel
            slug={cfg.slug}
            name={cfg.name}
            mode={cfg.mode ?? "active"}
            jsonPath={cfg.jsonPath}
            overridesPath={cfg.overridesPath}
          />
        </section>
      ))}
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
    startDate: string | Date | null;
    archivedAt: Date | null;
    cityCount: number;
  };
}) {
  // Extract year from startDate. Drizzle's `date()` column returns
  // either a YYYY-MM-DD string OR a Date object depending on the
  // pg-node type parser config. Handle both shapes so a single
  // campaign with a startDate can't crash the entire page render.
  const year = (() => {
    if (!campaign.startDate) return null;
    if (typeof campaign.startDate === "string") {
      return campaign.startDate.slice(0, 4);
    }
    if (campaign.startDate instanceof Date) {
      return String(campaign.startDate.getUTCFullYear());
    }
    return null;
  })();
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
