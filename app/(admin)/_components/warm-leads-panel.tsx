import { EmptyState } from "@/components/ui/empty-state";
import type { WarmLeadRow } from "@/lib/warm-leads";
import { CheckCircle2, Flame } from "lucide-react";
import Link from "next/link";
import { WarmLeadPromoteButton } from "./warm-lead-promote-button";

interface CrawlOption {
  eventId: string;
  dayPart:
    | "thursday_night"
    | "friday_night"
    | "saturday_day"
    | "saturday_night"
    | "sunday_day"
    | "sunday_night"
    | "other"
    | null;
  crawlNumber: number;
  middleVenueGroupId: string | null;
  filledSlots: Array<{
    role: "wristband" | "middle" | "final" | "alt_final";
    slotPosition: number;
    venueName: string | null;
  }>;
}

interface Props {
  cityName: string;
  campaignName: string;
  leads: WarmLeadRow[];
  /** Optional — when present, each lead renders a Promote-to-Slot button. */
  cityCampaignId?: string;
  crawls?: CrawlOption[];
}

/**
 * Warm-leads panel for a city sheet.
 *
 * "Warm" = previously confirmed in another campaign in this city, or
 * had a positive outreach outcome. Operator can promote any warm lead
 * straight into a crawl slot via the Promote button (conflict checks
 * run; failures surface inline).
 *
 * When cityCampaignId + crawls are omitted (e.g. on a campaign-wide
 * report view), the promote affordance is hidden and rows are
 * read-only — same data, no edit handle.
 */
export function WarmLeadsPanel({ cityName, campaignName, leads, cityCampaignId, crawls }: Props) {
  if (leads.length === 0) {
    return (
      <section className="card-surface overflow-hidden rounded-2xl p-3">
        <header className="mb-3 flex items-baseline gap-2 px-3 pt-3">
          <Flame className="h-4 w-4 text-zinc-500" />
          <h2 className="font-semibold text-lg tracking-tight">Warm leads</h2>
        </header>
        <EmptyState
          icon={Flame}
          title={`No warm leads in ${cityName} yet`}
          description="As outreach happens, the engine remembers venues that said yes and resurfaces them here for future campaigns."
          size="compact"
        />
      </section>
    );
  }

  const previouslyConfirmed = leads.filter((l) => l.pastConfirmedCount > 0);
  const positiveOutreachOnly = leads.filter(
    (l) => l.pastConfirmedCount === 0 && l.bestOutreachOutcome,
  );

  const promoteEnabled = !!cityCampaignId && !!crawls;

  return (
    <section className="card-surface overflow-hidden">
      <header className="flex items-baseline justify-between gap-3 border-zinc-200/60 border-b px-5 py-4 dark:border-zinc-800/40">
        <div className="flex items-baseline gap-2">
          <Flame className="h-4 w-4 text-amber-500" />
          <h2 className="font-semibold text-lg tracking-tight">
            Warm leads
            <span className="ml-2 font-mono font-normal text-[11px] text-zinc-500">
              {leads.length} in {cityName}
            </span>
          </h2>
        </div>
        <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
          from past campaigns (excluding {campaignName})
        </p>
      </header>

      <div className="space-y-5 px-5 py-4">
        {previouslyConfirmed.length > 0 && (
          <div>
            <p className="mb-2 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
              Confirmed in past campaigns · {previouslyConfirmed.length}
            </p>
            <ul className="flex flex-col gap-1.5">
              {previouslyConfirmed.map((lead) => (
                <WarmLeadRowItem
                  key={lead.id}
                  lead={lead}
                  cityCampaignId={cityCampaignId}
                  crawls={crawls}
                  promoteEnabled={promoteEnabled}
                />
              ))}
            </ul>
          </div>
        )}

        {positiveOutreachOnly.length > 0 && (
          <div>
            <p className="mb-2 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
              Positive past outreach · {positiveOutreachOnly.length}
            </p>
            <ul className="flex flex-col gap-1.5">
              {positiveOutreachOnly.map((lead) => (
                <WarmLeadRowItem
                  key={lead.id}
                  lead={lead}
                  cityCampaignId={cityCampaignId}
                  crawls={crawls}
                  promoteEnabled={promoteEnabled}
                />
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function WarmLeadRowItem({
  lead,
  cityCampaignId,
  crawls,
  promoteEnabled,
}: {
  lead: WarmLeadRow;
  cityCampaignId?: string;
  crawls?: CrawlOption[];
  promoteEnabled: boolean;
}) {
  return (
    <li className="group flex items-center justify-between gap-3 rounded-lg border border-zinc-200/60 bg-white px-3 py-2 text-sm transition-colors hover:border-zinc-300 dark:border-zinc-800/40 dark:bg-zinc-900/40 dark:hover:border-zinc-700">
      <div className="min-w-0 flex-1">
        <Link href={`/venues/${lead.id}`} className="font-medium hover:underline">
          {lead.name}
        </Link>
        {lead.address && <p className="mt-0.5 truncate text-xs text-zinc-500">{lead.address}</p>}
      </div>
      <div className="flex items-center gap-3">
        {lead.pastConfirmedCount > 0 && (
          <span
            className="inline-flex items-center gap-1 font-mono text-[10px] text-emerald-600 uppercase tracking-[0.1em] dark:text-emerald-400"
            title={`Confirmed in ${lead.pastConfirmedCount} past event${lead.pastConfirmedCount === 1 ? "" : "s"}`}
          >
            <CheckCircle2 className="h-3 w-3" />
            {lead.pastConfirmedCount}× confirmed
          </span>
        )}
        {lead.bestOutreachOutcome && lead.pastConfirmedCount === 0 && (
          <span
            className="font-mono text-[10px] text-amber-600 uppercase tracking-[0.1em] dark:text-amber-400"
            title={lead.lastPositiveAt?.toLocaleDateString()}
          >
            {lead.bestOutreachOutcome.replace("_", " ")}
          </span>
        )}
        {lead.lastPositiveAt && (
          <span className="font-mono text-[10px] text-zinc-500 tabular-nums">
            {formatDate(lead.lastPositiveAt)}
          </span>
        )}
        {promoteEnabled && cityCampaignId && crawls && (
          <WarmLeadPromoteButton
            venueId={lead.id}
            venueName={lead.name}
            cityCampaignId={cityCampaignId}
            crawls={crawls}
          />
        )}
      </div>
    </li>
  );
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
