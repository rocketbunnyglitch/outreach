"use client";

/**
 * CampaignSuggestionRow — surfaces the campaign-matcher's ranked
 * suggestions inline in ThreadPane.
 *
 * Render rules:
 *   - Only rendered when the parent passes a non-empty suggestions
 *     array (which itself only happens when the thread has no
 *     cityCampaignId yet and at least one suggestion crosses the
 *     confidence threshold).
 *   - Top suggestion gets the strong "Attach" CTA; the next 1-2
 *     show as smaller "Or attach X" chips.
 *   - Clicking Attach optimistically hides the suggestion row
 *     while the server action runs; on error we re-show + surface
 *     the message.
 *
 * Reasoning text from the matcher is displayed as a tooltip so the
 * operator can see WHY a given campaign was suggested without
 * cluttering the surface.
 */

import { Loader2, Sparkles, X } from "lucide-react";
import { useState, useTransition } from "react";
import { attachCityCampaignToThread } from "../_attach-campaign-action";

interface Suggestion {
  cityCampaignId: string;
  cityName: string;
  campaignName: string;
  brandName: string;
  confidence: number;
  reason: string;
}

export function CampaignSuggestionRow({
  threadId,
  suggestions,
}: {
  threadId: string;
  suggestions: Suggestion[];
}) {
  const [hidden, setHidden] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTx] = useTransition();

  if (hidden || suggestions.length === 0) return null;

  function attach(cityCampaignId: string) {
    setError(null);
    setPendingId(cityCampaignId);
    startTx(async () => {
      const fd = new FormData();
      fd.set("threadId", threadId);
      fd.set("cityCampaignId", cityCampaignId);
      const result = await attachCityCampaignToThread(null, fd);
      setPendingId(null);
      if (result.ok) {
        // Hide the row; the page revalidation will refresh with the
        // attachment reflected (and the matcher will return [] next
        // load, keeping the row hidden).
        setHidden(true);
      } else {
        setError(result.error);
      }
    });
  }

  const [top, ...rest] = suggestions;
  if (!top) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-violet-200/80 bg-violet-50/50 px-2.5 py-1.5 dark:border-violet-900/40 dark:bg-violet-950/20">
      <Sparkles className="h-3 w-3 text-violet-600 dark:text-violet-400" aria-hidden="true" />
      <span className="font-mono text-[10px] text-violet-700 uppercase tracking-widest dark:text-violet-300">
        Suggested
      </span>
      <button
        type="button"
        onClick={() => attach(top.cityCampaignId)}
        disabled={pendingId !== null}
        title={top.reason}
        className="inline-flex items-center gap-1 rounded-full bg-violet-600 px-2.5 py-0.5 font-medium text-[11px] text-white hover:bg-violet-700 disabled:opacity-60 dark:bg-violet-500 dark:hover:bg-violet-400"
      >
        {pendingId === top.cityCampaignId && <Loader2 className="h-3 w-3 animate-spin" />}
        Attach: {top.cityName} · {top.campaignName}
      </button>
      {rest.map((s) => (
        <button
          type="button"
          key={s.cityCampaignId}
          onClick={() => attach(s.cityCampaignId)}
          disabled={pendingId !== null}
          title={s.reason}
          className="inline-flex items-center gap-1 rounded-full border border-violet-300/60 bg-white px-2 py-0.5 text-[11px] text-violet-800 hover:bg-violet-100 disabled:opacity-60 dark:border-violet-700/60 dark:bg-zinc-950 dark:text-violet-200 dark:hover:bg-violet-950/30"
        >
          {pendingId === s.cityCampaignId && <Loader2 className="h-3 w-3 animate-spin" />}
          or {s.cityName} · {s.campaignName}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setHidden(true)}
        aria-label="Dismiss suggestion"
        className="ml-auto rounded-md p-1 text-violet-700/60 hover:bg-violet-100 hover:text-violet-900 dark:text-violet-300/60 dark:hover:bg-violet-950/40 dark:hover:text-violet-100"
      >
        <X className="h-3 w-3" />
      </button>
      {error && (
        <span className="basis-full text-rose-700 text-xs dark:text-rose-400">{error}</span>
      )}
    </div>
  );
}
