"use client";

/**
 * Companion visualizations to CrawlGlowGrid for the dashboard
 * tracker's parent city row.
 *
 *   CrawlSlotNeedGrid       Same layout as CrawlGlowGrid, but each
 *                           pill is split into 4 colored segments
 *                           (wristband / middle1 / middle2 / final).
 *                           A segment is grey by default; it glows
 *                           the slot's pill color (yellow / orange
 *                           / red) when that slot is still open for
 *                           that crawl.
 *
 *   CityStatusGrid          Wraps CrawlGlowGrid + a tiny Active /
 *                           Cancelled popover. Clicking the grid
 *                           opens the picker. Replaces the old
 *                           multi-option StatusOverridePill on the
 *                           city row — operators only really need
 *                           the binary at the city level.
 */

import { cn } from "@/lib/cn";
import type { CrawlNeed } from "@/lib/tracker-status-types";
import { Check, Loader2 } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { updateCityCampaignStatus } from "../../_actions-tracker";
import { CrawlGlowGrid } from "./crawl-glow-grid";

// =========================================================================
// Day-label helpers (kept private to this file — the GlowGrid has
// its own copies to keep components decoupled)
// =========================================================================

const DAY_LABEL: Record<string, string> = {
  thursday_night: "Thu",
  friday_night: "Fri",
  saturday_day: "Sat",
  saturday_night: "Sat",
  sunday_day: "Sun",
  sunday_night: "Sun",
  other: "Oth",
};

const DAY_LABEL_LONG: Record<string, string> = {
  thursday_night: "Thursday night",
  friday_night: "Friday night",
  saturday_day: "Saturday day",
  saturday_night: "Saturday night",
  sunday_day: "Sunday day",
  sunday_night: "Sunday night",
  other: "Other",
};

const DAY_ORDER: string[] = [
  "thursday_night",
  "friday_night",
  "saturday_day",
  "saturday_night",
  "sunday_day",
  "sunday_night",
  "other",
];

// =========================================================================
// CrawlSlotNeedGrid — segmented per-slot need visualization
// =========================================================================

type SlotKey = "wristband" | "middle1" | "middle2" | "final";

/** Per-slot tone classes. Match SLOT_PILL_TONE from
 *  tracker-status-types so the grid and the legacy W / M1+2 / F
 *  pills share a color language. */
const SLOT_LIT: Record<SlotKey, string> = {
  wristband: "bg-amber-400 shadow-[0_0_5px_rgba(251,191,36,0.65)]",
  middle1: "bg-orange-500 shadow-[0_0_5px_rgba(249,115,22,0.65)]",
  middle2: "bg-orange-500 shadow-[0_0_5px_rgba(249,115,22,0.65)]",
  final: "bg-red-500 shadow-[0_0_5px_rgba(239,68,68,0.7)]",
};

const SLOT_DARK = "bg-zinc-400/30 dark:bg-zinc-700/40";

const SLOT_LABEL: Record<SlotKey, string> = {
  wristband: "Wristband venue needed",
  middle1: "Middle venue 1 needed",
  middle2: "Middle venue 2 needed",
  final: "Final venue needed",
};

export function CrawlSlotNeedGrid({ crawls }: { crawls: CrawlNeed[] }) {
  const byDay = new Map<string, CrawlNeed[]>();
  for (const c of crawls) {
    const list = byDay.get(c.dayPart) ?? [];
    list.push(c);
    byDay.set(c.dayPart, list);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => a.crawlNumber - b.crawlNumber);
  }
  const days = DAY_ORDER.filter((d) => byDay.has(d));
  if (days.length === 0) return null;

  return (
    <div className="flex flex-col gap-0.5">
      {days.map((d) => {
        const list = byDay.get(d) ?? [];
        return (
          <div key={d} className="flex items-center gap-1.5" title={DAY_LABEL_LONG[d] ?? d}>
            <span className="w-7 shrink-0 font-mono text-[8.5px] text-zinc-500 uppercase tracking-widest">
              {DAY_LABEL[d] ?? d.slice(0, 3)}
            </span>
            <div className="flex flex-wrap items-center gap-1">
              {list.map((c) => {
                const cancelled = c.status === "cancelled";
                const segs: Array<{ key: SlotKey; needed: boolean }> = [
                  { key: "wristband", needed: !cancelled && c.needsWristband },
                  { key: "middle1", needed: !cancelled && c.needsMiddle1 },
                  { key: "middle2", needed: !cancelled && c.needsMiddle2 },
                  { key: "final", needed: !cancelled && c.needsFinal },
                ];
                const neededLabels = segs.filter((s) => s.needed).map((s) => SLOT_LABEL[s.key]);
                const labelText = cancelled
                  ? `Crawl ${c.crawlNumber}: cancelled`
                  : neededLabels.length === 0
                    ? `Crawl ${c.crawlNumber}: all venues confirmed`
                    : `Crawl ${c.crawlNumber}: ${neededLabels.join(", ")}`;
                return (
                  <span
                    key={`${c.dayPart}-${c.crawlNumber}`}
                    aria-label={labelText}
                    title={labelText}
                    className="inline-flex items-center gap-px"
                  >
                    {segs.map((s) => (
                      <span
                        key={s.key}
                        className={cn(
                          // Each sub-bar is 1/4 the parent pill
                          // width (4px) at the same height (1px)
                          // and not rounded so the four read as
                          // one continuous segmented bar.
                          "inline-block h-1 w-1",
                          s.needed ? SLOT_LIT[s.key] : SLOT_DARK,
                        )}
                      />
                    ))}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// =========================================================================
// CityStatusGrid — clickable glow grid that opens the active /
// cancelled picker
// =========================================================================

type CityStatus = "planning" | "active" | "confirmed" | "cancelled";

export function CityStatusGrid({
  cityCampaignId,
  crawls,
  status,
}: {
  cityCampaignId: string;
  crawls: CrawlNeed[];
  status: CityStatus;
}) {
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  return (
    <div ref={triggerRef} className="relative inline-block">
      <CrawlGlowGrid crawls={crawls} status={status} onClick={() => setOpen((o) => !o)} />
      <CityStatusPicker
        cityCampaignId={cityCampaignId}
        current={status}
        isOpen={open}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
      />
    </div>
  );
}

// =========================================================================
// CityStatusPicker — floating Active / Cancelled popover
// =========================================================================

type CityPickerState = "active" | "cancelled";

function CityStatusPicker({
  cityCampaignId,
  current,
  isOpen,
  onClose,
  anchorRef,
}: {
  cityCampaignId: string;
  current: CityStatus;
  isOpen: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pending, startTx] = useTransition();
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const selected: CityPickerState = current === "cancelled" ? "cancelled" : "active";

  useEffect(() => {
    if (!isOpen) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (ref.current.contains(e.target as Node)) return;
      if (anchorRef.current?.contains(e.target as Node)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [isOpen, onClose, anchorRef]);

  useEffect(() => {
    if (!isOpen) {
      setPos(null);
      return;
    }
    const a = anchorRef.current;
    if (!a) return;
    const rect = a.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: rect.left });
  }, [isOpen, anchorRef]);

  function pick(next: CityPickerState) {
    startTx(async () => {
      const fd = new FormData();
      fd.set("cityCampaignId", cityCampaignId);
      fd.set("status", next);
      const res = await updateCityCampaignStatus(null, fd);
      if (res.ok) onClose();
    });
  }

  if (!isOpen || !pos) return null;

  return (
    <div
      ref={ref}
      role="menu"
      style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 60 }}
      className="min-w-[140px] rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-950"
    >
      <PickerRow
        label="Active"
        selected={selected === "active"}
        pending={pending && selected !== "active"}
        onClick={() => pick("active")}
        tone="active"
      />
      <PickerRow
        label="Cancelled"
        selected={selected === "cancelled"}
        pending={pending && selected !== "cancelled"}
        onClick={() => pick("cancelled")}
        tone="cancelled"
      />
    </div>
  );
}

function PickerRow({
  label,
  selected,
  pending,
  onClick,
  tone,
}: {
  label: string;
  selected: boolean;
  pending: boolean;
  onClick: () => void;
  tone: "active" | "cancelled";
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={pending}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        "hover:bg-zinc-100 dark:hover:bg-zinc-900",
        selected && "bg-zinc-100 dark:bg-zinc-900",
      )}
    >
      <span className="inline-flex items-center gap-2">
        <span
          className={cn(
            "inline-block h-1.5 w-1.5 rounded-full",
            tone === "active"
              ? "bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.7)]"
              : "bg-rose-500 shadow-[0_0_4px_rgba(244,63,94,0.7)]",
          )}
        />
        {label}
      </span>
      {pending ? (
        <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />
      ) : selected ? (
        <Check className="h-3 w-3 text-zinc-500" />
      ) : null}
    </button>
  );
}
