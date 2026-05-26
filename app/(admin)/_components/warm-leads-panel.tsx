import type { WarmLeadRow } from "@/lib/warm-leads";
import { CheckCircle2, Flame } from "lucide-react";
import Link from "next/link";

interface Props {
  cityName: string;
  campaignName: string;
  leads: WarmLeadRow[];
}

/**
 * Warm-leads surfacing panel for a city_campaign detail page.
 *
 * "Warm" = either (a) confirmed in a past campaign in this city, or
 * (b) had a positive outreach outcome (interested / confirmed /
 * callback_requested) in any past touchpoint.
 *
 * Lists up to 50 venues, sorted by past-confirmation count then most
 * recent positive activity. The operator can click into each one to
 * start outreach immediately instead of cold-cluster-discovering them
 * from scratch.
 *
 * Empty state: a calm "no historical warm leads" message — this is
 * normal for a brand-new city, not an error.
 */
export function WarmLeadsPanel({ cityName, campaignName, leads }: Props) {
  if (leads.length === 0) {
    return (
      <section className="card-surface p-5">
        <header className="mb-3 flex items-baseline gap-2">
          <Flame className="h-4 w-4 text-zinc-500" />
          <h2 className="font-semibold text-lg tracking-tight">Warm leads from past campaigns</h2>
        </header>
        <p className="text-xs text-zinc-500 italic">
          No venues with past positive outcomes in {cityName} yet. As outreach happens, the engine
          remembers who said yes and resurfaces them here for future campaigns.
        </p>
      </section>
    );
  }

  // Bucket the leads into two groups for clearer presentation
  const previouslyConfirmed = leads.filter((l) => l.pastConfirmedCount > 0);
  const positiveOutreachOnly = leads.filter(
    (l) => l.pastConfirmedCount === 0 && l.bestOutreachOutcome,
  );

  return (
    <section className="card-surface p-5">
      <header className="mb-4 flex items-baseline justify-between">
        <div className="flex items-baseline gap-2">
          <Flame className="h-4 w-4 text-amber-500" />
          <h2 className="font-semibold text-lg tracking-tight">
            Warm leads
            <span className="ml-2 font-mono font-normal text-[11px] text-zinc-500">
              {leads.length} in {cityName}
            </span>
          </h2>
        </div>
        <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
          from past campaigns (excluding {campaignName})
        </p>
      </header>

      {previouslyConfirmed.length > 0 && (
        <div className="mb-5">
          <p className="mb-2 font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
            Confirmed in past campaigns ({previouslyConfirmed.length})
          </p>
          <ul className="flex flex-col gap-1.5">
            {previouslyConfirmed.map((lead) => (
              <WarmLeadRowItem key={lead.id} lead={lead} />
            ))}
          </ul>
        </div>
      )}

      {positiveOutreachOnly.length > 0 && (
        <div>
          <p className="mb-2 font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
            Positive past outreach ({positiveOutreachOnly.length})
          </p>
          <ul className="flex flex-col gap-1.5">
            {positiveOutreachOnly.map((lead) => (
              <WarmLeadRowItem key={lead.id} lead={lead} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function WarmLeadRowItem({ lead }: { lead: WarmLeadRow }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800/60">
      <div className="min-w-0 flex-1">
        <Link href={`/venues/${lead.id}`} className="font-medium hover:underline">
          {lead.name}
        </Link>
        {lead.address && <p className="mt-0.5 truncate text-xs text-zinc-500">{lead.address}</p>}
      </div>
      <div className="flex items-center gap-3">
        {lead.pastConfirmedCount > 0 && (
          <span
            className="inline-flex items-center gap-1 font-mono text-[10px] text-emerald-500 uppercase tracking-widest"
            title={`Confirmed in ${lead.pastConfirmedCount} past event${lead.pastConfirmedCount === 1 ? "" : "s"}`}
          >
            <CheckCircle2 className="h-3 w-3" />
            {lead.pastConfirmedCount}× confirmed
          </span>
        )}
        {lead.bestOutreachOutcome && lead.pastConfirmedCount === 0 && (
          <span
            className="font-mono text-[10px] text-amber-500 uppercase tracking-widest"
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
      </div>
    </li>
  );
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
