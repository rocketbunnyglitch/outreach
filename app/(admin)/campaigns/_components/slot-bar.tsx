"use client";

/**
 * SlotBar — one crawl's row of segments. Apple-style pill container
 * with internal segments separated by hairline gaps. Each segment
 * colored by its slot state.
 *
 * Wristband (1) | Middle (1..N) | Final (1)
 *
 * Sizing has three flavours:
 *   - 'sm': used in the collapsed city row (stacked N-deep, scannable)
 *   - 'md': used when a city is expanded — same shape, larger
 *
 * The bar is purely visual — clicks bubble up to the parent card.
 * Hover surfaces a tooltip per segment when venueName is set.
 */

import type { CitySlot, SlotState } from "@/lib/city-progress";
import { cn } from "@/lib/cn";

interface Props {
  slots: CitySlot[];
  /** Header line above the bar — e.g. "Fri Sep 12 · Crawl 1". Hidden when not provided. */
  label?: string;
  size?: "sm" | "md";
  /** Tiny status pill on the right of the bar. */
  trailingHint?: string;
}

// Tailwind utility lookups for slot state. The Apple aesthetic prefers
// muted colour stops — these aren't the saturated tailwind defaults.
const STATE_CLASSES: Record<SlotState, string> = {
  // Empty: thin dashed fill on a neutral canvas. Mirrors Felix Health's
  // "unvisited step" affordance.
  empty: "bg-zinc-200/70 dark:bg-zinc-800/60",
  // Cold (lead): pale slate, signals "we know about them, no progress"
  cold: "bg-slate-300/80 dark:bg-slate-700/70",
  // Warm (contacted): muted blue tone — touching but not committed
  warm: "bg-sky-400/80 dark:bg-sky-600/60",
  // Verbal (interested/negotiating): amber, almost there
  verbal: "bg-amber-400 dark:bg-amber-500/80",
  // Confirmed/contract_signed: emerald
  confirmed: "bg-emerald-500 dark:bg-emerald-500/90",
  // Declined: rose, but de-saturated so it doesn't dominate
  declined: "bg-rose-300/70 dark:bg-rose-900/60",
};

const STATE_LABELS: Record<SlotState, string> = {
  empty: "open slot",
  cold: "cold outreach",
  warm: "contacted",
  verbal: "verbal interest",
  confirmed: "confirmed",
  declined: "declined",
};

const ROLE_INITIAL: Record<CitySlot["role"], string> = {
  wristband: "W",
  middle: "M",
  final: "F",
};

export function SlotBar({ slots, label, size = "sm", trailingHint }: Props) {
  if (slots.length === 0) return null;

  const heightClass = size === "sm" ? "h-2" : "h-3.5";
  const gapClass = size === "sm" ? "gap-[2px]" : "gap-[3px]";

  return (
    <div className="flex flex-col gap-1">
      {(label || trailingHint) && (
        <div className="flex items-baseline justify-between gap-2">
          {label && (
            <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-[0.1em]">
              {label}
            </span>
          )}
          {trailingHint && (
            <span className="font-mono text-[9px] text-zinc-400 tabular-nums">{trailingHint}</span>
          )}
        </div>
      )}
      <div
        className={cn(
          "flex w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900",
          gapClass,
        )}
        role="img"
        aria-label={`Slot states: ${slots.map((s) => `${s.role} ${s.position} ${s.state}`).join(", ")}`}
      >
        {slots.map((s) => (
          <div
            key={`${s.role}-${s.position}`}
            className={cn("flex-1 transition-colors", heightClass, STATE_CLASSES[s.state])}
            title={
              s.venueName
                ? `${roleLabel(s)} · ${s.venueName} · ${STATE_LABELS[s.state]}`
                : `${roleLabel(s)} · ${STATE_LABELS[s.state]}`
            }
          >
            {size === "md" && (
              <span className="block h-full w-full text-center font-mono text-[8px] text-white/80 uppercase tabular-nums leading-[14px]">
                {ROLE_INITIAL[s.role]}
                {s.role === "middle" ? s.position : ""}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function roleLabel(s: CitySlot): string {
  if (s.role === "middle") return `Middle ${s.position}`;
  if (s.role === "wristband") return "Wristband";
  return "Final";
}
