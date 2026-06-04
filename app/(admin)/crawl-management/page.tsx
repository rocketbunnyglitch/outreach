import { EmptyState } from "@/components/ui/empty-state";
import { requireStaff } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { loadCrawlManagement, loadGraphicsQueue } from "@/lib/crawl-management-data";
import { getCurrentCampaign } from "@/lib/current-campaign";
import { ClipboardCheck } from "lucide-react";
import Link from "next/link";
import { CrawlManagementTree } from "./_components/crawl-management-tree";
import { GraphicsQueue } from "./_components/graphics-queue";

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
export default async function CrawlManagementPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireStaff();
  const { tab } = await searchParams;
  const activeTab = tab === "graphics" ? "graphics" : "deliverables";
  const currentCampaign = await getCurrentCampaign();
  const campaignId = currentCampaign ? currentCampaign.campaign.id : null;

  const cities = campaignId ? await loadCrawlManagement({ campaignId }).catch(() => []) : [];
  const graphicsRows =
    campaignId && activeTab === "graphics"
      ? await loadGraphicsQueue({ campaignId }).catch(() => [])
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
      </nav>

      {!campaignId ? (
        <EmptyState
          icon={ClipboardCheck}
          title="No campaign selected"
          description="Pick a current campaign from the admin tab to see its crawl-management view."
        />
      ) : activeTab === "graphics" ? (
        <GraphicsQueue rows={graphicsRows} />
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
      ) : (
        <CrawlManagementTree cities={cities} />
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
