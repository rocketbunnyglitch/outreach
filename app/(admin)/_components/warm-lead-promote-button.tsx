"use client";
import { cn } from "@/lib/cn";
import { ChevronRight, Loader2, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { assignSlotVenue } from "../city-campaigns/_slot-actions";

type SlotRole = "wristband" | "middle" | "final" | "alt_final";

interface CrawlOption {
  eventId: string;
  dayPart: "thursday_night" | "friday_night" | "saturday_night";
  crawlNumber: number;
  /** Set when the crawl is using a shared middle group — middle role
   * is disabled because the group is authoritative. */
  middleVenueGroupId: string | null;
  /** Filled slots on this crawl so we can show "Final · taken" etc. */
  filledSlots: Array<{ role: SlotRole; slotPosition: number; venueName: string | null }>;
}

interface Props {
  venueId: string;
  venueName: string;
  cityCampaignId: string;
  crawls: CrawlOption[];
}

const DAY_LABEL = {
  thursday_night: "Thursday",
  friday_night: "Friday",
  saturday_night: "Saturday",
};

const ROLE_OPTIONS: Array<{
  role: SlotRole;
  label: string;
  position: number;
  tone: string;
}> = [
  { role: "wristband", label: "Wristband", position: 1, tone: "bg-amber-400 text-amber-950" },
  { role: "middle", label: "Middle 1", position: 1, tone: "bg-orange-500 text-orange-50" },
  { role: "middle", label: "Middle 2", position: 2, tone: "bg-orange-500 text-orange-50" },
  { role: "final", label: "Final", position: 1, tone: "bg-red-500 text-red-50" },
  {
    role: "alt_final",
    label: "Alt Final",
    position: 1,
    tone: "bg-red-500/60 text-red-50",
  },
];

/**
 * Promotes a warm lead into a specific crawl slot.
 *
 * UX:
 *   Step 1: pick a crawl (compact list, one tap)
 *   Step 2: pick the slot role
 *   Step 3: confirmation + error surfaced inline
 *
 * Picker re-uses the city sheet's conflict detection by calling
 * assignSlotVenue. If the venue would conflict (e.g. already a final
 * on another same-day crawl), the error surfaces in the picker.
 *
 * Filled slots are visible but pre-selected with a 'replace' affordance
 * so the operator knows what they'd overwrite before tapping.
 */
export function WarmLeadPromoteButton({ venueId, venueName, cityCampaignId, crawls }: Props) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"crawl" | "role">("crawl");
  const [selectedCrawl, setSelectedCrawl] = useState<CrawlOption | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, startTx] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function close() {
    setOpen(false);
    setStep("crawl");
    setSelectedCrawl(null);
    setError(null);
    setSuccess(false);
  }

  function pickCrawl(c: CrawlOption) {
    setSelectedCrawl(c);
    setStep("role");
    setError(null);
  }

  function pickRole(role: SlotRole, position: number) {
    if (!selectedCrawl) return;
    setError(null);
    setSuccess(false);
    const fd = new FormData();
    fd.set("eventId", selectedCrawl.eventId);
    fd.set("role", role);
    fd.set("slotPosition", String(position));
    fd.set("venueId", venueId);
    fd.set("cityCampaignId", cityCampaignId);
    startTx(async () => {
      const result = await assignSlotVenue(null, fd);
      if (result.ok) {
        setSuccess(true);
        setTimeout(close, 1400);
      } else {
        setError(result.error ?? "Couldn't promote — try a different slot.");
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em] transition-colors hover:bg-emerald-500/[0.08] hover:text-emerald-700 dark:text-zinc-400 dark:hover:text-emerald-300"
        title={`Promote ${venueName} to a crawl slot`}
      >
        <Sparkles className="h-3 w-3" />
        Promote
      </button>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={close}
        className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/[0.12] px-2 py-1 font-mono text-[10px] text-emerald-700 uppercase tracking-[0.1em] dark:text-emerald-300"
      >
        <Sparkles className="h-3 w-3" />
        {step === "crawl" ? "Pick a crawl…" : "Pick slot…"}
      </button>

      <div className="absolute top-full right-0 z-50 mt-1 w-80 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
        {success && (
          <div className="flex items-center gap-2 px-3 py-3 text-emerald-700 text-xs dark:text-emerald-300">
            <Sparkles className="h-3.5 w-3.5" />
            <span>
              Promoted <strong>{venueName}</strong> — refresh to see it in the crawl table.
            </span>
          </div>
        )}

        {!success && step === "crawl" && (
          <>
            <p className="px-2 pb-1.5 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
              Promote {venueName} to which crawl?
            </p>
            {crawls.length === 0 ? (
              <p className="px-2 py-2 text-xs text-zinc-500 italic">No crawls yet for this city.</p>
            ) : (
              <ul className="space-y-0.5">
                {crawls.map((c) => (
                  <li key={c.eventId}>
                    <button
                      type="button"
                      onClick={() => pickCrawl(c)}
                      className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-xs transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <span className="font-medium">
                        {DAY_LABEL[c.dayPart]} crawl {c.crawlNumber}
                      </span>
                      <ChevronRight className="h-3 w-3 text-zinc-400" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {!success && step === "role" && selectedCrawl && (
          <>
            <div className="mb-1.5 flex items-baseline justify-between px-2">
              <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
                Which slot in {DAY_LABEL[selectedCrawl.dayPart]} {selectedCrawl.crawlNumber}?
              </p>
              <button
                type="button"
                onClick={() => {
                  setStep("crawl");
                  setError(null);
                }}
                className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em] hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                ← back
              </button>
            </div>
            <ul className="space-y-0.5">
              {ROLE_OPTIONS.map((r) => {
                const filled = selectedCrawl.filledSlots.find(
                  (f) => f.role === r.role && f.slotPosition === r.position,
                );
                const middleDisabledByGroup =
                  r.role === "middle" && !!selectedCrawl.middleVenueGroupId;
                const disabled = middleDisabledByGroup;
                return (
                  <li key={`${r.role}-${r.position}`}>
                    <button
                      type="button"
                      onClick={() => pickRole(r.role, r.position)}
                      disabled={disabled || pending}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors",
                        "hover:bg-zinc-100 dark:hover:bg-zinc-800",
                        disabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
                      )}
                    >
                      <span
                        className={cn(
                          "inline-flex items-center rounded px-1.5 py-0.5 font-medium font-mono text-[10px] uppercase tracking-[0.06em]",
                          r.tone,
                        )}
                      >
                        {r.label}
                      </span>
                      <span className="flex-1 truncate text-zinc-600 dark:text-zinc-400">
                        {middleDisabledByGroup
                          ? "managed by shared group"
                          : filled
                            ? `replaces ${filled.venueName ?? "venue"}`
                            : "empty"}
                      </span>
                      {pending && <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {error && (
          <div className="mt-2 rounded-md bg-rose-50/60 px-2.5 py-2 text-rose-700 text-xs dark:bg-rose-950/30 dark:text-rose-300">
            <div className="flex items-start gap-2">
              <span className="flex-1">{error}</span>
              <button
                type="button"
                onClick={() => setError(null)}
                className="text-rose-500 hover:text-rose-700"
                aria-label="Dismiss"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
