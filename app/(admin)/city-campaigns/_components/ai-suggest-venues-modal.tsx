"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { Check, ExternalLink, Loader2, MapPin, RefreshCw, Sparkles, Star, X } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import {
  type VenueSuggestion,
  addSuggestedVenueToColdOutreach,
  suggestVenuesForCampaign,
} from "../../_actions/venue-suggestion-actions";

interface Props {
  cityCampaignId: string;
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
  /** Browser-restricted Maps key for the static overview map. Optional —
   *  without it, the overview map just hides. */
  googleMapsApiKey?: string;
}

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      suggestions: VenueSuggestion[];
      noticeKey?: string;
      city: { name: string; region: string | null };
    }
  | { kind: "notConfigured"; reason: "ai" | "places" };

const SLOT_OPTIONS: Array<{ value: "any" | "wristband" | "middle" | "final"; label: string }> = [
  { value: "any", label: "Flexible" },
  { value: "wristband", label: "Wristband" },
  { value: "middle", label: "Middle" },
  { value: "final", label: "Final" },
];

/**
 * Sheet-style modal that asks Claude (or rating-fallback when AI
 * isn't configured) to rank fresh Places-API candidates by fit for
 * a specific crawl slot.
 *
 * Flow:
 *   1. Open → fires suggestVenuesForCampaign automatically
 *   2. 5-15s later, 8 cards render ranked by fit
 *   3. Each card shows AI rationale, rating, address
 *   4. 'Add to outreach' creates the venue (if new) + cold-outreach
 *      entry in a single transaction, then marks the card 'added'
 *   5. Change the slot pill at top to re-rank for a different role
 *
 * Selectors stay independent — adding venue A doesn't block adding
 * venue B; each card has its own pending state.
 */
export function AiSuggestVenuesModal({
  cityCampaignId,
  open,
  onClose,
  onAdded,
  googleMapsApiKey,
}: Props) {
  const [slot, setSlot] = useState<"any" | "wristband" | "middle" | "final">("any");
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  const [pending, startTx] = useTransition();
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  // Auto-load on open
  // biome-ignore lint/correctness/useExhaustiveDependencies: fire on open transition
  useEffect(() => {
    if (open && state.kind === "idle") {
      load(slot);
    }
    if (!open) {
      // Reset for next open so the operator gets fresh results
      setState({ kind: "idle" });
      setAddedIds(new Set());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  function load(slotKind: typeof slot) {
    setState({ kind: "loading" });
    const fd = new FormData();
    fd.set("cityCampaignId", cityCampaignId);
    fd.set("slotKind", slotKind);
    startTx(async () => {
      const result = await suggestVenuesForCampaign(null, fd);
      if (!result.ok) {
        setState({ kind: "error", message: result.error ?? "Couldn't load suggestions." });
        return;
      }
      if (result.data && "notConfigured" in result.data) {
        setState({ kind: "notConfigured", reason: result.data.reason });
        return;
      }
      setState({
        kind: "ready",
        suggestions: result.data.suggestions,
        noticeKey: result.data.noticeKey,
        city: result.data.city,
      });
    });
  }

  function setSlotAndReload(s: typeof slot) {
    setSlot(s);
    load(s);
  }

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        onClick={onClose}
        tabIndex={-1}
        aria-label="Close"
        className="fixed inset-0 z-[60] cursor-default bg-zinc-900/40 backdrop-blur-sm"
      />

      <aside className="fixed inset-y-0 right-0 z-[70] flex w-full max-w-2xl flex-col border-zinc-200 border-l bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
        <header className="border-zinc-200 border-b px-6 py-4 dark:border-zinc-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-violet-500" />
              <h2 className="font-semibold text-base tracking-tight">
                AI venue suggestions
                {state.kind === "ready" && (
                  <span className="ml-1.5 font-normal text-zinc-500">· {state.city.name}</span>
                )}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1">
            <span className="mr-1 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
              Filling
            </span>
            {SLOT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setSlotAndReload(opt.value)}
                disabled={pending}
                className={cn(
                  "rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors",
                  slot === opt.value
                    ? "bg-violet-500/15 text-violet-700 dark:text-violet-300"
                    : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800",
                )}
              >
                {opt.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => load(slot)}
              disabled={pending}
              className="ml-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em] transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
              title="Refresh"
            >
              <RefreshCw className={cn("h-2.5 w-2.5", pending && "animate-spin")} /> Re-rank
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {state.kind === "loading" && (
            <div className="flex flex-col items-center gap-2 py-16">
              <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
              <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
                Scouting venues + ranking by fit…
              </p>
              <p className="text-[10px] text-zinc-400">5-15 seconds</p>
            </div>
          )}

          {state.kind === "notConfigured" && (
            <div className="rounded-md border border-rose-200 bg-rose-50/60 px-4 py-3 dark:border-rose-900 dark:bg-rose-950/30">
              <p className="text-rose-800 text-sm dark:text-rose-200">
                {state.reason === "places" ? (
                  <>
                    Places API isn't configured. Set{" "}
                    <code className="font-mono text-xs">GOOGLE_MAPS_API_KEY</code> on the server to
                    use venue suggestions.
                  </>
                ) : (
                  <>
                    Claude isn't configured. Set{" "}
                    <code className="font-mono text-xs">ANTHROPIC_API_KEY</code> on the server for
                    AI-ranked suggestions. Falling back to rating-sort meanwhile.
                  </>
                )}
              </p>
            </div>
          )}

          {state.kind === "error" && (
            <div className="rounded-md border border-rose-200 bg-rose-50/60 px-4 py-3 dark:border-rose-900 dark:bg-rose-950/30">
              <p className="text-rose-700 text-sm dark:text-rose-300">{state.message}</p>
              <button
                type="button"
                onClick={() => load(slot)}
                className="mt-2 inline-flex items-center gap-1 font-mono text-[10px] text-rose-700 uppercase tracking-[0.08em] underline-offset-2 hover:underline dark:text-rose-300"
              >
                <RefreshCw className="h-2.5 w-2.5" /> Retry
              </button>
            </div>
          )}

          {state.kind === "ready" && state.suggestions.length === 0 && (
            <div className="py-12 text-center">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {state.noticeKey === "no_candidates_after_dedupe"
                  ? "Places API didn't return any new candidates — every nearby venue is already in your database for this city."
                  : "No suggestions right now. Try widening the slot to 'Flexible' or check back later."}
              </p>
            </div>
          )}

          {state.kind === "ready" && state.suggestions.length > 0 && (
            <ul className="space-y-3">
              {state.noticeKey === "ai_not_configured" && (
                <li className="rounded-md border border-rose-200 bg-rose-50/60 px-3 py-2 text-rose-800 text-xs dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
                  Showing rating-sorted candidates without AI ranking. Set ANTHROPIC_API_KEY for
                  Claude reasoning.
                </li>
              )}
              {googleMapsApiKey && (
                <SuggestionsOverviewMap apiKey={googleMapsApiKey} suggestions={state.suggestions} />
              )}
              {state.suggestions.map((s, idx) => (
                <SuggestionCard
                  key={s.googlePlaceId}
                  suggestion={s}
                  rank={idx + 1}
                  cityCampaignId={cityCampaignId}
                  added={addedIds.has(s.googlePlaceId)}
                  onAdded={() => {
                    setAddedIds((prev) => {
                      const next = new Set(prev);
                      next.add(s.googlePlaceId);
                      return next;
                    });
                    onAdded();
                  }}
                />
              ))}
            </ul>
          )}
        </div>

        <footer className="border-zinc-200 border-t px-6 py-3 text-center font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em] dark:border-zinc-800">
          {state.kind === "ready"
            ? `${state.suggestions.length} candidates ranked${state.noticeKey === "ai_not_configured" ? " (rating fallback)" : " by Claude"}`
            : "Powered by Places API + Claude"}
        </footer>
      </aside>
    </>
  );
}

function SuggestionCard({
  suggestion,
  rank,
  cityCampaignId,
  added,
  onAdded,
}: {
  suggestion: VenueSuggestion;
  rank: number;
  cityCampaignId: string;
  added: boolean;
  onAdded: () => void;
}) {
  const [pending, startTx] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function add() {
    setError(null);
    const fd = new FormData();
    fd.set("cityCampaignId", cityCampaignId);
    fd.set("googlePlaceId", suggestion.googlePlaceId);
    fd.set("venueName", suggestion.name);
    fd.set("formattedAddress", suggestion.formattedAddress ?? "");
    startTx(async () => {
      const result = await addSuggestedVenueToColdOutreach(null, fd);
      if (!result.ok) {
        setError(result.error ?? "Couldn't add.");
        return;
      }
      onAdded();
    });
  }

  return (
    <li
      className={cn(
        "rounded-lg border bg-white p-4 shadow-sm transition-colors dark:bg-zinc-900/50",
        added
          ? "border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/40 dark:bg-emerald-950/20"
          : "border-zinc-200 dark:border-zinc-800",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 font-mono font-semibold text-[10px]",
                rank <= 3
                  ? "bg-violet-500 text-white"
                  : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
              )}
            >
              {rank}
            </span>
            <h3 className="truncate font-semibold text-sm tracking-tight">{suggestion.name}</h3>
            {suggestion.rating !== null && (
              <span className="inline-flex shrink-0 items-center gap-0.5 font-mono text-[10px] text-rose-600 dark:text-rose-400">
                <Star className="h-2.5 w-2.5 fill-current" />
                {suggestion.rating.toFixed(1)}
                {suggestion.userRatingCount !== null && (
                  <span className="text-zinc-400">({suggestion.userRatingCount})</span>
                )}
              </span>
            )}
          </div>
          {suggestion.formattedAddress && (
            <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-zinc-500">
              <MapPin className="h-2.5 w-2.5" />
              {suggestion.formattedAddress}
            </p>
          )}
          {suggestion.reasoning && (
            <p className="mt-2 text-xs text-zinc-700 leading-snug dark:text-zinc-300">
              {suggestion.reasoning}
            </p>
          )}
          {error && (
            <p className="mt-2 font-mono text-[10px] text-rose-600 dark:text-rose-400">{error}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {added ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-1 font-mono text-[10px] text-emerald-700 uppercase tracking-[0.08em] dark:text-emerald-300">
              <Check className="h-2.5 w-2.5" /> Added
            </span>
          ) : (
            <Button type="button" size="sm" onClick={add} disabled={pending}>
              {pending ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Adding…
                </>
              ) : (
                <>
                  <Sparkles className="h-3 w-3" />
                  Add to outreach
                </>
              )}
            </Button>
          )}
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(suggestion.name)}&query_place_id=${suggestion.googlePlaceId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em] underline-offset-2 hover:text-zinc-900 hover:underline dark:hover:text-zinc-100"
          >
            <ExternalLink className="h-2.5 w-2.5" /> Maps
          </a>
        </div>
      </div>
    </li>
  );
}

/**
 * Overview map for the suggestion list. Renders a Google Static Maps image
 * with one numbered red pin per suggestion that has coordinates — gives the
 * operator a quick "lay of the land" view at the top of the panel without
 * the cost (or complexity) of a full interactive map. The numbers match
 * each card's rank, so glancing at the map and reading the list compose.
 *
 * Static Maps API uses the same browser-restricted key the rest of the app
 * uses; one image, no JS, no extra map quota beyond the static-maps call.
 */
function SuggestionsOverviewMap({
  apiKey,
  suggestions,
}: {
  apiKey: string;
  suggestions: VenueSuggestion[];
}) {
  const withCoords = suggestions
    .map((s, i) => ({ rank: i + 1, lat: s.lat, lng: s.lng }))
    .filter((p): p is { rank: number; lat: number; lng: number } => p.lat != null && p.lng != null);
  if (withCoords.length === 0) return null;

  // Static Maps URL: one marker per suggestion, numbered, red.
  const markers = withCoords
    .map((p) => `markers=color:red%7Clabel:${p.rank}%7C${p.lat},${p.lng}`)
    .join("&");
  const url = `https://maps.googleapis.com/maps/api/staticmap?size=600x260&scale=2&maptype=roadmap&${markers}&key=${apiKey}`;

  return (
    <li className="overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50/40 dark:border-zinc-800 dark:bg-zinc-900/40">
      <img
        src={url}
        alt={`Overview map of ${withCoords.length} suggested venues`}
        className="block h-auto w-full"
        loading="lazy"
      />
      <p className="px-3 py-1.5 font-mono text-[9px] text-zinc-500 uppercase tracking-[0.12em]">
        Pin numbers match the rank in the list below
      </p>
    </li>
  );
}
