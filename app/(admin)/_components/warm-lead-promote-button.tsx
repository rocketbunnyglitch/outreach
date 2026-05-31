"use client";
import { cn } from "@/lib/cn";
import { ChevronRight, Loader2, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { assignSlotVenue } from "../city-campaigns/_slot-actions";

import { formatDayPart } from "@/lib/tracker-status-types";

type SlotRole = "wristband" | "middle" | "final" | "alt_final";

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

// DAY_LABEL was previously a hard-coded 3-value object that broke
// silently for saturday_day / sunday_day / sunday_night / other / null.
// Now centralized in formatDayPart() from tracker-status-types.

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
    // Modal closing is handled by the backdrop's onClick (in the
    // render below) and by Escape on the modal's onKeyDown. We still
    // listen for document-level Escape here because focus may live
    // inside an InlineCell or other widget that swallows the keydown
    // bubble — this is the global fallback.
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    return () => {
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

  // Modal renders into document.body via createPortal so it escapes
  // the cold-outreach table's overflow-hidden — previously the
  // dropdown was clipped by the table's section wrapper and the
  // bottom rows of the picker were unreachable. Centered + backdrop
  // matches the rest of the admin app's modal pattern (escalation
  // popover etc.).
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/40 px-4 pt-[10vh] pb-10 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Promote ${venueName} to a crawl slot`}
      onClick={(e) => {
        // Close when the backdrop itself is clicked (not when clicks
        // bubble up from inside the modal).
        if (e.target === e.currentTarget) close();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") close();
      }}
    >
      <div
        ref={containerRef}
        className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-4 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        {/* Header */}
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
              Promote warm lead
            </p>
            <h2 className="mt-1 font-semibold text-lg tracking-tight">{venueName}</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              {step === "crawl"
                ? "Pick a crawl below; you'll then pick the slot role."
                : selectedCrawl
                  ? `Picking a slot in ${formatDayPart(selectedCrawl.dayPart)} crawl ${selectedCrawl.crawlNumber}.`
                  : "Pick a slot role."}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {success && (
          <div className="flex items-center gap-2 rounded-md bg-emerald-500/10 px-3 py-3 text-emerald-700 text-sm dark:bg-emerald-500/15 dark:text-emerald-300">
            <Sparkles className="h-4 w-4" />
            <span>
              Promoted <strong>{venueName}</strong> — refresh to see it in the crawl table.
            </span>
          </div>
        )}

        {!success &&
          step === "crawl" &&
          (crawls.length === 0 ? (
            <p className="rounded-md bg-zinc-50 px-3 py-3 text-sm text-zinc-500 italic dark:bg-zinc-900">
              No crawls yet for this city. Add crawls first, then come back to promote.
            </p>
          ) : (
            <ul className="space-y-1">
              {crawls.map((c) => (
                <li key={c.eventId}>
                  <button
                    type="button"
                    onClick={() => pickCrawl(c)}
                    className="flex w-full items-center justify-between gap-2 rounded-md border border-zinc-200/60 bg-white px-3 py-2.5 text-left text-sm transition-colors hover:border-emerald-300 hover:bg-emerald-500/[0.04] dark:border-zinc-800/60 dark:bg-zinc-950 dark:hover:border-emerald-700 dark:hover:bg-emerald-500/[0.06]"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {formatDayPart(c.dayPart)} crawl {c.crawlNumber}
                      </span>
                      <span className="mt-0.5 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
                        {c.filledSlots.length} of 4 slots filled
                      </span>
                    </div>
                    <ChevronRight className="h-4 w-4 text-zinc-400" />
                  </button>
                </li>
              ))}
            </ul>
          ))}

        {!success && step === "role" && selectedCrawl && (
          <>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
                Which slot?
              </span>
              <button
                type="button"
                onClick={() => {
                  setStep("crawl");
                  setError(null);
                }}
                className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em] hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                ← back to crawls
              </button>
            </div>
            <ul className="space-y-1">
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
                        "flex w-full items-center gap-3 rounded-md border border-zinc-200/60 bg-white px-3 py-2.5 text-left text-sm transition-colors hover:border-emerald-300 hover:bg-emerald-500/[0.04] dark:border-zinc-800/60 dark:bg-zinc-950 dark:hover:border-emerald-700 dark:hover:bg-emerald-500/[0.06]",
                        disabled &&
                          "cursor-not-allowed opacity-40 hover:border-zinc-200/60 hover:bg-white dark:hover:border-zinc-800/60 dark:hover:bg-zinc-950",
                      )}
                    >
                      <span
                        className={cn(
                          "inline-flex items-center rounded px-2 py-0.5 font-medium font-mono text-[10px] uppercase tracking-[0.06em]",
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
                            : "empty slot"}
                      </span>
                      {pending && <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {error && (
          <div className="mt-3 rounded-md bg-rose-50/60 px-3 py-2.5 text-rose-700 text-sm dark:bg-rose-950/30 dark:text-rose-300">
            <div className="flex items-start gap-2">
              <span className="flex-1">{error}</span>
              <button
                type="button"
                onClick={() => setError(null)}
                className="text-rose-500 hover:text-rose-700"
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
