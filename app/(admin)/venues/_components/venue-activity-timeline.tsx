"use client";

import {
  ACTIVITY_TYPE_LABEL,
  type ActivityTone,
  type VenueActivityEntry,
  type VenueActivityType,
  filterActivity,
  presentTypes,
} from "@/lib/venue-activity-core";
import Link from "next/link";
import { useMemo, useState } from "react";

/**
 * Unified venue activity timeline (Phase 6). One chronological feed across
 * emails, calls, notes, tasks, slot lifecycle, floor-staff calls, wristbands
 * and relationship flags, with type + campaign filters. All timestamps arrive
 * pre-formatted from the server (`atLabel`) so this client component does no
 * date work -- no hydration risk.
 */

const DOT: Record<ActivityTone, string> = {
  positive: "bg-emerald-500",
  negative: "bg-rose-500",
  neutral: "bg-zinc-400 dark:bg-zinc-500",
};

function chipClass(active: boolean): string {
  return [
    "rounded-full px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide transition-colors",
    active
      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
      : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800/60 dark:text-zinc-300 dark:hover:bg-zinc-800",
  ].join(" ");
}

export function VenueActivityTimeline({
  entries,
  campaigns,
}: {
  entries: VenueActivityEntry[];
  campaigns: Array<{ id: string; name: string }>;
}) {
  const [activeTypes, setActiveTypes] = useState<Set<VenueActivityType>>(new Set());
  const [campaignId, setCampaignId] = useState<string | null>(null);

  const types = useMemo(() => presentTypes(entries), [entries]);
  const filtered = useMemo(
    () =>
      filterActivity(entries, {
        types: activeTypes.size > 0 ? Array.from(activeTypes) : null,
        campaignId,
      }),
    [entries, activeTypes, campaignId],
  );

  function toggleType(t: VenueActivityType) {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  if (entries.length === 0) {
    return (
      <div className="card-surface p-6 text-center text-sm text-zinc-500">
        No activity recorded for this venue yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Type filters */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setActiveTypes(new Set())}
          className={chipClass(activeTypes.size === 0)}
        >
          All
        </button>
        {types.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => toggleType(t)}
            className={chipClass(activeTypes.has(t))}
          >
            {ACTIVITY_TYPE_LABEL[t]}
          </button>
        ))}
      </div>

      {/* Campaign filter (only when more than one campaign is present) */}
      {campaigns.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[10px] text-zinc-400 uppercase tracking-widest">
            Campaign
          </span>
          <button
            type="button"
            onClick={() => setCampaignId(null)}
            className={chipClass(campaignId === null)}
          >
            All
          </button>
          {campaigns.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCampaignId(c.id)}
              className={chipClass(campaignId === c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {/* Feed */}
      {filtered.length === 0 ? (
        <div className="card-surface p-6 text-center text-sm text-zinc-500">
          No activity matches these filters.
        </div>
      ) : (
        <ol className="relative flex flex-col gap-0 border-zinc-200 border-l pl-5 dark:border-zinc-800">
          {filtered.map((e) => (
            <li key={e.id} className="relative pb-4 last:pb-0">
              <span
                className={`-left-[23px] absolute top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-zinc-950 ${DOT[e.tone ?? "neutral"]}`}
              />
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-medium text-sm">
                  {e.href ? (
                    <Link href={e.href} className="hover:underline">
                      {e.title}
                    </Link>
                  ) : (
                    e.title
                  )}
                </p>
                <span className="shrink-0 whitespace-nowrap font-mono text-[10px] text-zinc-400 tabular-nums">
                  {e.atLabel}
                </span>
              </div>
              {e.detail && <p className="mt-0.5 text-xs text-zinc-500">{e.detail}</p>}
              <p className="mt-0.5 font-mono text-[10px] text-zinc-400 uppercase tracking-wide">
                {ACTIVITY_TYPE_LABEL[e.type]}
                {e.actor ? ` · ${e.actor}` : ""}
                {e.campaignName ? ` · ${e.campaignName}` : ""}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
