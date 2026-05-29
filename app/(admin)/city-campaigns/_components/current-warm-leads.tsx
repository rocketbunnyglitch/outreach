/**
 * Current warm leads for THIS city campaign.
 *
 * Distinct from the separate `WarmLeadsPanel` (which surfaces venues
 * with positive history from PAST campaigns). This panel filters the
 * current campaign's cold-outreach entries for status='interested' —
 * the venues an operator has explicitly moved from cold to warm via
 * either the bulk "Move to warm leads" button or the per-row status
 * dropdown.
 *
 * Each row pairs the venue name with a Promote button that opens the
 * existing two-step picker (which crawl → which slot) and routes
 * through assignSlotVenue, picking up the same conflict detection the
 * city sheet uses.
 *
 * Empty state hidden — when there are no warm leads the whole panel
 * is suppressed so the page stays uncluttered. Header counts surface
 * the queue size at a glance.
 */
import { WarmLeadPromoteButton } from "@/app/(admin)/_components/warm-lead-promote-button";
import { ExternalLink, Flame } from "lucide-react";
import Link from "next/link";

type SlotRole = "wristband" | "middle" | "final" | "alt_final";

interface CrawlOption {
  eventId: string;
  dayPart: "thursday_night" | "friday_night" | "saturday_night";
  crawlNumber: number;
  middleVenueGroupId: string | null;
  filledSlots: Array<{ role: SlotRole; slotPosition: number; venueName: string | null }>;
}

interface WarmEntry {
  entryId: string;
  venueId: string;
  venueName: string;
  venueEmail: string | null;
  remarks: string | null;
}

export function CurrentWarmLeads({
  entries,
  crawls,
  cityCampaignId,
}: {
  entries: WarmEntry[];
  crawls: CrawlOption[];
  cityCampaignId: string;
}) {
  if (entries.length === 0) return null;

  return (
    <section className="card-surface overflow-hidden">
      <header className="flex items-baseline justify-between gap-3 border-zinc-200/60 border-b px-5 py-3 dark:border-zinc-800/40">
        <div className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-emerald-500" />
          <h2 className="font-semibold text-base tracking-tight">Warm leads</h2>
          <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em]">
            interested venues from this city&apos;s cold outreach
          </p>
        </div>
        <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em]">
          {entries.length}
        </p>
      </header>

      <ul className="flex flex-col divide-y divide-zinc-200/40 dark:divide-zinc-800/30">
        {entries.map((e) => (
          <li
            key={e.entryId}
            className="group flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 transition-colors hover:bg-zinc-50/60 dark:hover:bg-zinc-900/30"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="font-medium text-sm text-zinc-900 dark:text-zinc-100">
                  {e.venueName}
                </span>
                <Link
                  href={`/venues/${e.venueId}`}
                  className="rounded p-0.5 text-zinc-300 opacity-0 transition-opacity hover:text-zinc-700 group-hover:opacity-100 dark:text-zinc-600 dark:hover:text-zinc-300"
                  title="Open venue detail"
                  aria-label="Open venue detail"
                >
                  <ExternalLink className="h-2.5 w-2.5" />
                </Link>
              </div>
              {e.remarks && (
                <p className="mt-0.5 line-clamp-2 text-[11px] text-zinc-500 italic">{e.remarks}</p>
              )}
            </div>
            <WarmLeadPromoteButton
              venueId={e.venueId}
              venueName={e.venueName}
              cityCampaignId={cityCampaignId}
              crawls={crawls}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
