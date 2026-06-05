import { EmptyState } from "@/components/ui/empty-state";
import { requireStaff } from "@/lib/auth";
import { type CancelledVenueRow, loadCancelledVenues } from "@/lib/cancelled-venues-data";
import { cn } from "@/lib/cn";
import {
  CRAWL_DELIVERABLE_TYPES,
  type CrawlDeliverableType,
  loadCrawlManagement,
  loadGraphicsQueue,
} from "@/lib/crawl-management-data";
import { getCurrentCampaign } from "@/lib/current-campaign";
import { ClipboardCheck, XCircle } from "lucide-react";
import Link from "next/link";
import { CrawlManagementTree } from "./_components/crawl-management-tree";
import { GraphicsQueue } from "./_components/graphics-queue";

function fmtCancelledAt(iso: string | null): string {
  if (!iso) return "unknown";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Toronto",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function CancelledVenues({ rows }: { rows: CancelledVenueRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={XCircle}
        title="No cancellations"
        description="Venues that cancel after confirming will appear here, with who/when/why."
      />
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-zinc-200/60 dark:divide-zinc-800/40">
      {rows.map((r) => (
        <li key={r.venueEventId} className="flex items-start justify-between gap-3 py-3">
          <div className="min-w-0">
            <p className="font-medium text-sm">
              <Link href={`/venues/${r.venueId}`} className="hover:underline">
                {r.venueName}
              </Link>
              {r.cityName ? <span className="text-zinc-500"> &middot; {r.cityName}</span> : null}
              <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                {r.role === "alt_final" ? "final" : r.role}
              </span>
            </p>
            {r.reason ? (
              <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">{r.reason}</p>
            ) : null}
            <p className="mt-0.5 font-mono text-[10px] text-zinc-400">
              event {r.eventDate} &middot; cancelled {fmtCancelledAt(r.cancelledAt)}
              {r.cancelledByName ? ` by ${r.cancelledByName}` : ""}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export const metadata = { title: "Crawl management" };
export const dynamic = "force-dynamic";

/**
 * Crawl Management — operational checklist per venue_event.
 *
 * Tree shape:
 *   City (parent)
 *     Crawl (date + crawl-number + day-part + name)
 *       Venue row
 *         [social media] [staff sheet] [poster] [wristbands] [week of]
 *
 * Operators flip each cell between pending / done / n/a. A click
 * fires setDeliverableStatus; the page revalidates.
 *
 * The "wristbands" deliverable additionally shows a live status pill
 * for the linked wristbands row (pending / ready / shipped /
 * delivered / issue) so the team sees shipping state at a glance
 * alongside the operational handoff checkbox.
 */
const DELIVERABLE_LABELS: Record<CrawlDeliverableType, string> = {
  social_media_graphics: "Social media",
  staff_sheet: "Staff sheet",
  participant_poster: "Poster",
  wristbands: "Wristbands",
  week_of_confirmation: "Week of",
};

export default async function CrawlManagementPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; city?: string; pending?: string }>;
}) {
  await requireStaff();
  const { tab, city, pending } = await searchParams;
  const activeTab =
    tab === "graphics" ? "graphics" : tab === "cancelled" ? "cancelled" : "deliverables";
  const currentCampaign = await getCurrentCampaign();
  const campaignId = currentCampaign ? currentCampaign.campaign.id : null;

  const cities = campaignId ? await loadCrawlManagement({ campaignId }).catch(() => []) : [];

  // Filters (deliverables tab only): city + per-type pending.
  const selectedCity = city && city !== "all" ? city : null;
  const selectedPending =
    pending && CRAWL_DELIVERABLE_TYPES.includes(pending as CrawlDeliverableType)
      ? (pending as CrawlDeliverableType)
      : null;

  // Campaign-wide pending tally per type (drives the filter chip counts).
  const campaignPendingByType = CRAWL_DELIVERABLE_TYPES.reduce(
    (acc, t) => {
      acc[t] = cities.reduce((s, c) => s + c.pendingByType[t], 0);
      return acc;
    },
    {} as Record<CrawlDeliverableType, number>,
  );

  let visibleCities = cities;
  if (selectedCity) visibleCities = visibleCities.filter((c) => c.cityCampaignId === selectedCity);
  if (selectedPending) {
    visibleCities = visibleCities.filter((c) => c.pendingByType[selectedPending] > 0);
  }

  // Build a /crawl-management href preserving the active city + pending
  // filters, applying overrides (null clears a filter).
  function filterHref(over: { city?: string | null; pending?: string | null }): string {
    const q = new URLSearchParams();
    const c = over.city === undefined ? selectedCity : over.city;
    const p = over.pending === undefined ? selectedPending : over.pending;
    if (c) q.set("city", c);
    if (p) q.set("pending", p);
    const s = q.toString();
    return s ? `/crawl-management?${s}` : "/crawl-management";
  }
  const graphicsRows =
    campaignId && activeTab === "graphics"
      ? await loadGraphicsQueue({ campaignId }).catch(() => [])
      : [];
  const cancelledRows =
    campaignId && activeTab === "cancelled"
      ? await loadCancelledVenues({ campaignId }).catch(() => [])
      : [];

  // Aggregate pending across all cities for the header chip.
  const totalPending = cities.reduce((s, c) => s + c.pendingCount, 0);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-zinc-500 uppercase tracking-widest">
            Operational checklist
          </p>
          <h1 className="mt-1 font-semibold text-4xl tracking-tight">Crawl Management</h1>
          <p className="mt-2 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
            Pre-crawl deliverables for every venue in{" "}
            {currentCampaign ? currentCampaign.campaign.name : "the current campaign"}. Track social
            media graphics, staff sheets, participant posters, wristbands, and the week-of
            confirmation per venue.
          </p>
        </div>
        {totalPending > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 font-mono text-[11px] text-amber-800 uppercase tracking-widest dark:bg-amber-950/40 dark:text-amber-300">
            <ClipboardCheck className="h-3 w-3" />
            {totalPending} pending
          </span>
        )}
      </header>

      {/* Tabs: Deliverables (full per-venue checklist) | Graphics (the open
          create-queue of social graphics not yet made). */}
      <nav className="flex items-center gap-1 border-zinc-200 border-b dark:border-zinc-800">
        <TabLink
          href="/crawl-management"
          label="Deliverables"
          active={activeTab === "deliverables"}
        />
        <TabLink
          href="/crawl-management?tab=graphics"
          label="Graphics"
          active={activeTab === "graphics"}
        />
        <TabLink
          href="/crawl-management?tab=cancelled"
          label="Cancelled"
          active={activeTab === "cancelled"}
        />
      </nav>

      {/* Filters (deliverables tab only): city + per-type pending. */}
      {activeTab === "deliverables" && campaignId && cities.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <form method="get" className="flex items-center gap-2">
            {selectedPending && <input type="hidden" name="pending" value={selectedPending} />}
            <select
              name="city"
              defaultValue={selectedCity ?? "all"}
              className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="all">All cities ({totalPending} pending)</option>
              {cities.map((c) => (
                <option key={c.cityCampaignId} value={c.cityCampaignId}>
                  {c.cityName} ({c.pendingCount})
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              Filter
            </button>
          </form>

          <div className="flex flex-wrap items-center gap-1.5">
            <PendingChip
              label="All types"
              count={totalPending}
              active={!selectedPending}
              href={filterHref({ pending: null })}
            />
            {CRAWL_DELIVERABLE_TYPES.map((t) => (
              <PendingChip
                key={t}
                label={DELIVERABLE_LABELS[t]}
                count={campaignPendingByType[t]}
                active={selectedPending === t}
                href={filterHref({ pending: selectedPending === t ? null : t })}
              />
            ))}
          </div>

          {(selectedCity || selectedPending) && (
            <Link
              href="/crawl-management"
              className="text-xs text-zinc-500 underline-offset-2 hover:underline"
            >
              Clear
            </Link>
          )}
        </div>
      )}

      {!campaignId ? (
        <EmptyState
          icon={ClipboardCheck}
          title="No campaign selected"
          description="Pick a current campaign from the admin tab to see its crawl-management view."
        />
      ) : activeTab === "graphics" ? (
        <GraphicsQueue rows={graphicsRows} />
      ) : activeTab === "cancelled" ? (
        <CancelledVenues rows={cancelledRows} />
      ) : cities.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="No cities in this campaign"
          description="Add cities to the campaign first."
          action={{
            label: "Open campaigns",
            href: `/campaigns/${campaignId}`,
          }}
        />
      ) : visibleCities.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="No matches"
          description="No cities match the current filters."
          action={{ label: "Clear filters", href: "/crawl-management" }}
        />
      ) : (
        <CrawlManagementTree cities={visibleCities} />
      )}

      <p className="text-[10px] text-zinc-400">
        Wristbands status is read live from the wristbands tracker. Other deliverables save when
        flipped.{" "}
        <Link className="underline" href="/tracker">
          Open tracker
        </Link>
      </p>
    </div>
  );
}

function PendingChip({
  label,
  count,
  active,
  href,
}: {
  label: string;
  count: number;
  active: boolean;
  href: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-wider ring-1 ring-inset transition-colors",
        active
          ? "bg-zinc-900 text-white ring-zinc-900 dark:bg-white dark:text-zinc-900 dark:ring-white"
          : "text-zinc-500 ring-zinc-300 hover:bg-zinc-100 dark:ring-zinc-700 dark:hover:bg-zinc-900",
      )}
    >
      {label}
      <span
        className={cn(
          "tabular-nums",
          count === 0 ? "opacity-40" : active ? "" : "text-amber-600 dark:text-amber-400",
        )}
      >
        {count}
      </span>
    </Link>
  );
}

function TabLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        "-mb-px border-b-2 px-3 py-2 font-medium text-sm transition-colors",
        active
          ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
          : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200",
      )}
    >
      {label}
    </Link>
  );
}
