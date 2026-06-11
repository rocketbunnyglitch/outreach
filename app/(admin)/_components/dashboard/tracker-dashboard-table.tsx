"use client";

import { useGridArrowNav } from "@/components/ui/data-table/use-grid-arrow-nav";
import { InlineCell } from "@/components/ui/inline-cell";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import {
  type CityNeedSummary,
  type CityStatusPill,
  type CrawlNeed,
  SLOT_PILL_LABEL,
  SLOT_PILL_LABEL_LONG,
  SLOT_PILL_TONE,
  STATUS_PILL_LABEL,
  STATUS_PILL_TONE,
  type SlotKind,
  formatCountryAbbrev,
} from "@/lib/tracker-status-types";
import { Check, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { createPortal } from "react-dom";
import {
  bulkUpdateCityCampaigns,
  reassignCityCampaign,
  updateCityCampaignPriority,
  updateCrawlNote,
  updateDashboardNote,
  updateEventStatus,
} from "../../_actions-tracker";
import { CityStatusGrid, CrawlSlotNeedGrid } from "./crawl-slot-need-grid";

export interface TrackerRow {
  cityCampaignId: string;
  cityId: string;
  cityName: string;
  /**
   * 2-letter ISO 3166-1 alpha-2 country code (e.g. "CA", "US",
   * "GB"). Mapped to a user-friendly display abbrev by
   * formatCountryAbbrev() in tracker-status-types.ts — e.g.
   * GB → UK, US → USA, CA → CAN. Rendered as a quiet small-font
   * badge beside the city name to disambiguate "London CAN" vs
   * "London UK" per operator feedback. Optional for forward-
   * compat with seed data that predates the field; renderer
   * omits the badge when null.
   */
  countryCode?: string | null;
  /** IANA timezone of the city, for the operating-hours dot beside the name.
   *  Falls back to America/Toronto upstream when a city has none recorded. */
  cityTimezone?: string | null;
  priority: number;
  totalSalesCents: number;
  status: "planning" | "active" | "confirmed" | "cancelled";
  leadStaffId: string | null;
  dashboardNote: string | null;
  need: CityNeedSummary;
}

export interface StaffOption {
  id: string;
  displayName: string;
}

interface Props {
  rows: TrackerRow[];
  staff: StaffOption[];
  /** Initial priority chip — dashboard defaults to top (1-4); the dedicated
   *  /tracker page passes "all" to show every city by default.
   *  Operators on the dedicated page can switch to multi-select via the
   *  individual P1 / P2 / P3 chips. */
  defaultPriorityFilter?: "top" | "all";
}

type SortKey = "priority" | "city" | "status" | "need" | "sales" | "assign" | "notes";

const STATUS_PILL_RANK: Record<CityStatusPill, number> = {
  // complete = fully booked, lowest urgency (sorts before outreach when
  // sorting by status). to_be_cancelled sits just above cancelled.
  complete: -1,
  outreach: 0,
  need_1_venue: 1,
  need_2_venues: 2,
  need_3_venues: 3,
  to_be_cancelled: 4,
  cancelled: 5,
};

/** Columns that read most naturally ascending (text); the rest default desc. */
const ASC_DEFAULT: ReadonlySet<SortKey> = new Set(["priority", "city", "assign", "notes"]);

/**
 * Frozen-left column classes. During horizontal scroll on narrow viewports
 * (below lg, where overflow-x-auto kicks in), the leading cells stay locked
 * to the left edge so the row identifier (checkbox, expand, #, city) is
 * always visible. Each frozen cell carries its own OPAQUE background so the
 * scrolling cells underneath can't bleed through. Header cells layer on
 * z-30 (top-left corner of the sticky thead/sticky-left intersection),
 * body cells on z-10 (above scrolling siblings, below the sticky header).
 *
 * left offsets — combined first column packs checkbox + chevron + #
 * tightly (was 32 + 36 + 40 = 108px; now ~80px) so the scrolling
 * cells start sooner and Notes / Sales get more room. City column
 * starts at left-[80px].
 *
 *   col 1 select+expand+#  = w-20 (80px) -> left-0
 *   col 2 city                          -> left-[80px]
 *
 * Background opacity is raised vs the row default (dark-mode zebras are
 * 30/70 alpha so the canvas blur shows; sticky cells need solid).
 */
const FROZEN_BASE = "lg:static lg:bg-transparent lg:dark:bg-transparent";
const FROZEN_LEFT_OFFSETS = ["left-0", "left-[80px]"] as const;
const FROZEN_HEAD_BG = "sticky z-30 bg-zinc-200 dark:bg-zinc-900";
function frozenBodyBg(stripeIndex: number, complete?: boolean): string {
  // Mirror rowTone but force full opacity so the column is opaque.
  // When the city is complete, the frozen cells need the same emerald
  // wash as the scrolling cells — otherwise the green tint would only
  // show in the right half of the row and the frozen left cells would
  // remain zinc, which reads as a half-painted row. The dark-mode
  // variant uses emerald-900 (not 950) at high opacity — 950 is
  // nearly indistinguishable from black, so the row failed the
  // "actually looks green" test in dark mode.
  if (complete) return "sticky z-10 bg-emerald-100 dark:bg-emerald-900/40";
  return stripeIndex % 2 === 0
    ? "sticky z-10 bg-zinc-50 dark:bg-zinc-900"
    : "sticky z-10 bg-zinc-100 dark:bg-zinc-800";
}
function frozenBreakdownBg(zebra: boolean, evenParent: boolean): string {
  // Crawl breakdown rows use lighter toners. Keep them opaque enough to
  // hide scrolling cells underneath without breaking the parent visual.
  if (zebra) return "sticky z-10 bg-zinc-200 dark:bg-zinc-800";
  return evenParent
    ? "sticky z-10 bg-zinc-50/95 dark:bg-zinc-900"
    : "sticky z-10 bg-zinc-100/95 dark:bg-zinc-900";
}

function compareRows(
  a: TrackerRow,
  b: TrackerRow,
  key: SortKey,
  staffNameById: Map<string, string>,
): number {
  switch (key) {
    case "priority":
      return a.priority - b.priority;
    case "city":
      return a.cityName.localeCompare(b.cityName);
    case "status":
      return STATUS_PILL_RANK[a.need.statusPill] - STATUS_PILL_RANK[b.need.statusPill];
    case "need":
      return a.need.openSlotCount - b.need.openSlotCount;
    case "sales":
      return a.totalSalesCents - b.totalSalesCents;
    case "assign": {
      const an = a.leadStaffId ? (staffNameById.get(a.leadStaffId) ?? "") : "";
      const bn = b.leadStaffId ? (staffNameById.get(b.leadStaffId) ?? "") : "";
      if (!an && bn) return 1; // unassigned sinks to the bottom when ascending
      if (an && !bn) return -1;
      return an.localeCompare(bn);
    }
    case "notes": {
      const an = a.dashboardNote ?? "";
      const bn = b.dashboardNote ?? "";
      if (!an && bn) return 1;
      if (an && !bn) return -1;
      return an.localeCompare(bn);
    }
  }
}

/** Clickable, sort-aware <th>. Preserves per-column width/alignment classes. */
function SortableTh({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
  className,
  tooltip,
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: "asc" | "desc" };
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
  className?: string;
  tooltip?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <th className={cn("px-3 py-3", align === "right" && "text-right", className)}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        title={tooltip}
        className={cn(
          "inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors hover:text-zinc-900 dark:hover:text-zinc-200",
          active ? "text-zinc-900 dark:text-zinc-100" : "text-inherit",
          align === "right" && "flex-row-reverse",
        )}
        aria-label={`Sort by ${label}`}
      >
        <span>{label}</span>
        <span className="w-2 text-[8px] leading-none">
          {active ? (sort.dir === "asc" ? "▲" : "▼") : ""}
        </span>
      </button>
    </th>
  );
}

/**
 * Tracker dashboard table — the centerpiece per-campaign view.
 *
 * Design intent: spreadsheet-fast but premium. Editing should feel
 * direct (click a cell, change it, blur to save) with subtle motion
 * confirming every action. No modal popups for routine edits.
 *
 * Layout: 8-column dense table.
 *   ▸  Expander (chevron, motion: 90° rotate on expand)
 *   #  Priority (mono, tabular)
 *   City (medium-weight, links to /city-campaigns/[id])
 *   Sales (mono, right-aligned)
 *   Status (color-coded pill)
 *   Need (slot pills: amber → orange → red gradient)
 *   Assign (inline select; commits on change)
 *   Notes (inline input; commits on blur or Enter)
 *
 * Rows alternate between two tonal stripes that read as one continuous
 * surface in both light and dark mode. Hover crossfades to a cool tint
 * to mark the active row without flashing. Accordion expansion uses a
 * smooth max-height transition (200ms ease-out).
 */
export function TrackerDashboardTable({ rows, staff, defaultPriorityFilter = "top" }: Props) {
  const [query, setQuery] = useState("");
  const tableToast = useToast();
  // Spreadsheet-style arrow-key navigation between editable cells. Cells that
  // opt in carry data-grid-cell="r:c" (currently the Notes column); the hook
  // moves focus on Arrow/Home/End and InlineCell handles Enter-moves-down.
  const gridNavRef = useRef<HTMLDivElement>(null);
  useGridArrowNav(gridNavRef);
  // Priority filter state. The legacy "top" preset is a shortcut for
  // {1,2,3,4}. "all" is represented as an empty Set (no filter applied).
  // Operators can also click individual priority chips below for true
  // multi-select. The dashboard defaults to top-4; the dedicated tracker
  // page defaults to no filter.
  const [priorityFilter, setPriorityFilter] = useState<Set<number>>(() => {
    if (defaultPriorityFilter === "top") return new Set([1, 2, 3, 4]);
    return new Set();
  });
  const togglePriority = useCallback((p: number) => {
    setPriorityFilter((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }, []);
  const clearPriorityFilter = useCallback(() => {
    setPriorityFilter(new Set());
  }, []);
  // Synthesized "top" preset matches {1,2,3,4} exactly.
  const isTopPreset = useMemo(() => {
    if (priorityFilter.size !== 4) return false;
    return [1, 2, 3, 4].every((p) => priorityFilter.has(p));
  }, [priorityFilter]);

  // Per-crawl KPI filter — when set, the table shows only cities that
  // satisfy a specific predicate (e.g. "Saturday crawl 1 complete"). The
  // value is a stringified key like "complete:saturday_night:1" or
  // "complete:all:1" for the all-day-parts variant. null = no KPI filter.
  const [kpiFilter, setKpiFilter] = useState<string | null>(null);
  // Independent (stackable) row hides. Cancelled cities clutter the view once
  // they're dead; 0-sales rows are noise when triaging where tickets are
  // moving. Both can be on at once.
  const [hideCancelled, setHideCancelled] = useState(false);
  const [hideZeroSales, setHideZeroSales] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "priority",
    dir: "asc",
  });

  const staffNameById = useMemo(() => new Map(staff.map((s) => [s.id, s.displayName])), [staff]);

  const toggleSort = useCallback((key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: ASC_DEFAULT.has(key) ? "asc" : "desc" },
    );
  }, []);

  // KPI predicates — used both by the bottom cards (counts) AND the
  // table filter when the operator clicks a card. The shape is:
  //   key = "complete:<dayPart>:<crawlNumber>"  for a specific day part
  //   key = "complete:all:<crawlNumber>"        for "every day part"
  // A crawl is "complete" when none of its needs* flags are true. The
  // "all" variant requires every crawl with that number across day
  // parts in the city to be complete.
  const matchesKpi = useCallback((row: TrackerRow, key: string): boolean => {
    const [kind, dpKey, numStr] = key.split(":");
    if (kind !== "complete") return true;
    const num = Number(numStr);
    if (!Number.isInteger(num)) return true;
    const crawls = row.need.crawlBreakdown.filter((c) => c.crawlNumber === num);
    if (crawls.length === 0) return false;
    const isComplete = (c: (typeof crawls)[number]) =>
      !c.needsWristband && !c.needsMiddle1 && !c.needsMiddle2 && !c.needsFinal;
    if (dpKey === "all") {
      return crawls.every(isComplete);
    }
    return crawls.some((c) => c.dayPart === dpKey && isComplete(c));
  }, []);

  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base =
      priorityFilter.size === 0 ? rows : rows.filter((r) => priorityFilter.has(r.priority));
    const afterKpi = kpiFilter ? base.filter((r) => matchesKpi(r, kpiFilter)) : base;
    const afterHides = afterKpi.filter((r) => {
      if (hideCancelled && (r.status === "cancelled" || r.need.statusPill === "cancelled"))
        return false;
      if (hideZeroSales && r.totalSalesCents <= 0) return false;
      return true;
    });
    const filtered = q
      ? afterHides.filter((r) => {
          const assignee = r.leadStaffId ? (staffNameById.get(r.leadStaffId) ?? "") : "";
          return (
            r.cityName.toLowerCase().includes(q) ||
            STATUS_PILL_LABEL[r.need.statusPill].toLowerCase().includes(q) ||
            assignee.toLowerCase().includes(q) ||
            (r.dashboardNote ?? "").toLowerCase().includes(q)
          );
        })
      : afterHides;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => compareRows(a, b, sort.key, staffNameById) * dir);
  }, [
    rows,
    query,
    sort,
    staffNameById,
    priorityFilter,
    kpiFilter,
    matchesKpi,
    hideCancelled,
    hideZeroSales,
  ]);

  // Distinct priorities present in the data, sorted ascending. Drives
  // the chip row — only render chips for priorities that actually
  // exist in the campaign so the filter doesn't show empty buckets.
  const availablePriorities = useMemo(() => {
    const set = new Set<number>();
    for (const r of rows) set.add(r.priority);
    return [...set].sort((a, b) => a - b);
  }, [rows]);

  // KPI card data — per-day-part counts of cities whose crawl-N is
  // complete. We only compute crawl number 1 since that's what
  // operators asked for; trivially extendable to crawls 2/3/etc. if
  // they ever want richer KPIs. Day parts that don't exist in the
  // data are skipped — the card simply isn't rendered.
  const kpiCards = useMemo(() => {
    const dayPartCounts = new Map<string, number>();
    let allCompleteCount = 0;
    let citiesWithCrawl1 = 0;
    for (const r of rows) {
      const c1Rows = r.need.crawlBreakdown.filter((c) => c.crawlNumber === 1);
      if (c1Rows.length === 0) continue;
      citiesWithCrawl1++;
      let everyOneComplete = true;
      for (const c of c1Rows) {
        const isComplete = !c.needsWristband && !c.needsMiddle1 && !c.needsMiddle2 && !c.needsFinal;
        if (isComplete) {
          dayPartCounts.set(c.dayPart, (dayPartCounts.get(c.dayPart) ?? 0) + 1);
        } else {
          everyOneComplete = false;
        }
      }
      if (everyOneComplete) allCompleteCount++;
    }
    type Card = { key: string; label: string; count: number };
    const cards: Card[] = [];
    // Order day parts intentionally: Thu → Fri → Sat (Sun rare).
    const dayPartOrder: Array<{ key: string; label: string }> = [
      { key: "thursday_night", label: "Thu crawl 1 complete" },
      { key: "friday_night", label: "Fri crawl 1 complete" },
      { key: "saturday_day", label: "Sat day crawl 1 complete" },
      { key: "saturday_night", label: "Sat night crawl 1 complete" },
      { key: "sunday_day", label: "Sun day crawl 1 complete" },
      { key: "sunday_night", label: "Sun night crawl 1 complete" },
      { key: "other", label: "Other crawl 1 complete" },
    ];
    for (const dp of dayPartOrder) {
      const count = dayPartCounts.get(dp.key) ?? 0;
      // Skip cards whose day part has no completed crawls AND no crawls
      // of any kind to potentially complete (i.e. the day part doesn't
      // exist in this campaign).
      const hasDayPart = rows.some((r) =>
        r.need.crawlBreakdown.some((c) => c.crawlNumber === 1 && c.dayPart === dp.key),
      );
      if (!hasDayPart) continue;
      cards.push({ key: `complete:${dp.key}:1`, label: dp.label, count });
    }
    if (citiesWithCrawl1 > 0) {
      cards.push({
        key: "complete:all:1",
        label: "All crawl 1's complete",
        count: allCompleteCount,
      });
    }
    return { cards, citiesWithCrawl1 };
  }, [rows]);

  // Multi-row selection for bulk "fill-down" edits (set priority / assign for
  // many cities at once). We only ever act on currently-visible selected rows.
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPending, startBulkTx] = useTransition();
  const visibleIds = useMemo(() => visibleRows.map((r) => r.cityCampaignId), [visibleRows]);
  const selectedVisible = useMemo(
    () => visibleIds.filter((id) => selected.has(id)),
    [visibleIds, selected],
  );
  const allVisibleSelected = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;

  // Anchor for shift-click range select. When the operator clicks a
  // checkbox with shift held, every row between this anchor and the
  // clicked row (inclusive, in visible order) joins the selection.
  // Tracks the LAST clicked checkbox — same behavior as Gmail / Sheets.
  const lastClickedRef = useRef<string | null>(null);

  function toggleSelect(id: string, shift?: boolean) {
    if (shift && lastClickedRef.current && lastClickedRef.current !== id) {
      // Range select. Find both ids in the current visible order and
      // ADD every row between them to the selection (we don't unselect
      // on shift-click — that matches Sheets' "extend selection" model
      // and avoids losing context when the operator is bulk-picking).
      const anchor = lastClickedRef.current;
      const anchorIdx = visibleIds.indexOf(anchor);
      const endIdx = visibleIds.indexOf(id);
      if (anchorIdx >= 0 && endIdx >= 0) {
        const [lo, hi] = anchorIdx <= endIdx ? [anchorIdx, endIdx] : [endIdx, anchorIdx];
        setSelected((prev) => {
          const next = new Set(prev);
          for (let i = lo; i <= hi; i++) {
            const rid = visibleIds[i];
            if (rid) next.add(rid);
          }
          return next;
        });
        // Don't move the anchor on shift-click — successive shift-clicks
        // extend from the same origin (matches Sheets).
        return;
      }
    }
    // Plain toggle. Update anchor so the NEXT shift-click bases off
    // this row.
    lastClickedRef.current = id;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) for (const id of visibleIds) next.delete(id);
      else for (const id of visibleIds) next.add(id);
      return next;
    });
  }
  function applyBulk(opts: { priority?: number; leadStaffId?: string | null }) {
    if (selectedVisible.length === 0) return;
    const count = selectedVisible.length;
    startBulkTx(async () => {
      const res = await bulkUpdateCityCampaigns({ ids: selectedVisible, ...opts });
      if (res.ok) {
        setSelected(new Set());
        // Build a precise success message: "Updated priority for 18 cities."
        // / "Reassigned 18 cities." / "Unassigned 18 cities."
        const verb =
          opts.priority !== undefined
            ? `priority for ${count} ${count === 1 ? "city" : "cities"}`
            : opts.leadStaffId === "" || opts.leadStaffId === null
              ? `${count} ${count === 1 ? "city" : "cities"} (unassigned)`
              : `${count} ${count === 1 ? "city" : "cities"}`;
        tableToast.show({ kind: "success", message: `Updated ${verb}.` });
        router.refresh();
      } else {
        tableToast.show({
          kind: "error",
          message: res.error ?? "Couldn't apply bulk change.",
        });
      }
    });
  }

  return (
    <div className="card-surface overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-zinc-200/80 border-b px-3 py-2 dark:border-zinc-800/40">
        <div className="flex flex-wrap items-center gap-1">
          {/* Legacy "top 4" + "all" shortcut chips. Single-click presets
              for the two most common operator scopes. */}
          <button
            type="button"
            onClick={() => setPriorityFilter(new Set([1, 2, 3, 4]))}
            className={cn(
              "rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ring-1 ring-inset transition-colors",
              isTopPreset
                ? "bg-zinc-900 text-white ring-zinc-900 dark:bg-white dark:text-zinc-900 dark:ring-white"
                : "bg-transparent text-zinc-500 ring-zinc-300 hover:bg-zinc-100 dark:text-zinc-400 dark:ring-zinc-700 dark:hover:bg-zinc-900",
            )}
          >
            Priority 1-4
          </button>
          <button
            type="button"
            onClick={clearPriorityFilter}
            className={cn(
              "rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ring-1 ring-inset transition-colors",
              priorityFilter.size === 0
                ? "bg-zinc-900 text-white ring-zinc-900 dark:bg-white dark:text-zinc-900 dark:ring-white"
                : "bg-transparent text-zinc-500 ring-zinc-300 hover:bg-zinc-100 dark:text-zinc-400 dark:ring-zinc-700 dark:hover:bg-zinc-900",
            )}
          >
            Show all
          </button>
          <span className="mx-1 hidden h-3 w-px shrink-0 bg-zinc-300 sm:inline-block dark:bg-zinc-700" />
          {/* Per-priority multi-select. Click any combination — P1+P3,
              P2+P4, etc. The chip is active when in the filter set;
              the order of clicks doesn't matter. */}
          {availablePriorities.map((p) => {
            const active = priorityFilter.has(p);
            const count = rows.filter((r) => r.priority === p).length;
            return (
              <button
                key={`pri-${p}`}
                type="button"
                onClick={() => togglePriority(p)}
                title={`Toggle priority ${p} (${count} ${count === 1 ? "city" : "cities"})`}
                className={cn(
                  "rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ring-1 ring-inset transition-colors",
                  active
                    ? "bg-indigo-600 text-white ring-indigo-600 dark:bg-indigo-500 dark:ring-indigo-500"
                    : "bg-transparent text-zinc-500 ring-zinc-300 hover:bg-zinc-100 dark:text-zinc-400 dark:ring-zinc-700 dark:hover:bg-zinc-900",
                )}
              >
                P{p}
              </button>
            );
          })}
        </div>
        {/* Stackable row hides -- cancelled cities + zero-sales cities. Both
            toggle independently; either or both can be on. */}
        <div className="flex flex-wrap items-center gap-1">
          <span className="mx-1 hidden h-3 w-px shrink-0 bg-zinc-300 sm:inline-block dark:bg-zinc-700" />
          <button
            type="button"
            onClick={() => setHideCancelled((v) => !v)}
            title="Hide cancelled cities"
            className={cn(
              "rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ring-1 ring-inset transition-colors",
              hideCancelled
                ? "bg-zinc-900 text-white ring-zinc-900 dark:bg-white dark:text-zinc-900 dark:ring-white"
                : "bg-transparent text-zinc-500 ring-zinc-300 hover:bg-zinc-100 dark:text-zinc-400 dark:ring-zinc-700 dark:hover:bg-zinc-900",
            )}
          >
            Hide cancelled
          </button>
          <button
            type="button"
            onClick={() => setHideZeroSales((v) => !v)}
            title="Hide cities with no ticket sales yet"
            className={cn(
              "rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ring-1 ring-inset transition-colors",
              hideZeroSales
                ? "bg-zinc-900 text-white ring-zinc-900 dark:bg-white dark:text-zinc-900 dark:ring-white"
                : "bg-transparent text-zinc-500 ring-zinc-300 hover:bg-zinc-100 dark:text-zinc-400 dark:ring-zinc-700 dark:hover:bg-zinc-900",
            )}
          >
            Hide 0 sales
          </button>
        </div>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by city, status, assignee, or note…"
          className="h-8 max-w-sm text-sm"
        />
        {/* Live count — Google Sheets style. Always shows "showing N
            of M cities" so operators can see at a glance how their
            filter is narrowing the view. When a KPI card is the
            active filter, surface its label too with an X to clear. */}
        <span className="ml-auto inline-flex items-center gap-2 font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
          <span>
            <span className="text-zinc-900 dark:text-zinc-100">{visibleRows.length}</span>
            {visibleRows.length !== rows.length && (
              <>
                <span className="mx-0.5 text-zinc-300 dark:text-zinc-600">/</span>
                <span>{rows.length}</span>
              </>
            )}
            <span className="ml-1">{visibleRows.length === 1 ? "city" : "cities"}</span>
          </span>
          {kpiFilter && (
            <button
              type="button"
              onClick={() => setKpiFilter(null)}
              className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950/60"
              title="Clear KPI filter"
            >
              {(() => {
                const card = kpiCards.cards.find((c) => c.key === kpiFilter);
                return card ? `${card.label} ×` : "Clear ×";
              })()}
            </button>
          )}
        </span>
      </div>
      {selectedVisible.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-zinc-200/80 border-b bg-blue-50/60 px-3 py-2 dark:border-zinc-800/40 dark:bg-blue-950/20">
          <span className="font-medium text-sm text-zinc-700 dark:text-zinc-200">
            {selectedVisible.length} selected
          </span>
          {/* Live aggregate of selected rows — Google Sheets style.
              Sums every crawl and every sales total across the
              selected cities so operators see scope at a glance. */}
          {(() => {
            const selSet = new Set(selectedVisible);
            const sel = rows.filter((r) => selSet.has(r.cityCampaignId));
            const crawls = sel.reduce((s, r) => s + r.need.crawlBreakdown.length, 0);
            const sales = sel.reduce((s, r) => s + r.totalSalesCents, 0);
            return (
              <span className="inline-flex items-center gap-2 font-mono text-[10px] text-zinc-600 uppercase tracking-widest dark:text-zinc-300">
                <span>
                  <span className="text-zinc-900 dark:text-zinc-100">{crawls}</span>{" "}
                  {crawls === 1 ? "crawl" : "crawls"}
                </span>
                <span className="text-zinc-300 dark:text-zinc-600">·</span>
                <span>
                  <span className="text-zinc-900 dark:text-zinc-100">{formatSales(sales)}</span>{" "}
                  sales
                </span>
              </span>
            );
          })()}
          <label className="flex items-center gap-1.5 text-xs text-zinc-500">
            Priority
            <select
              value=""
              disabled={bulkPending}
              onChange={(e) => {
                if (e.target.value) applyBulk({ priority: Number(e.target.value) });
              }}
              title="Set priority for all selected cities"
              className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="">Set…</option>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-zinc-500">
            Assign
            <select
              value=""
              disabled={bulkPending}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "__none__") return;
                applyBulk({ leadStaffId: v === "__unassign__" ? "" : v });
              }}
              title="Assign all selected cities to one staffer"
              className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="__none__">Set…</option>
              <option value="__unassign__">Unassigned</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName}
                </option>
              ))}
            </select>
          </label>
          {bulkPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />}
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ml-auto text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            Clear
          </button>
        </div>
      )}
      {/* Mobile (<sm): card-per-city layout. The table view would force
          horizontal scroll past the frozen city column and shrink every
          control below comfortable tap target. Cards stack the same
          editable cells vertically so everything is reachable with a
          thumb. */}
      <ul className="divide-y divide-zinc-200/60 sm:hidden dark:divide-zinc-800/60">
        {rows.length === 0 ? (
          <li className="px-4 py-12 text-center text-sm text-zinc-500">
            No cities in this campaign yet.
          </li>
        ) : visibleRows.length === 0 ? (
          <li className="px-4 py-10 text-center text-sm text-zinc-500">
            No cities match that filter.
          </li>
        ) : (
          visibleRows.map((row, i) => (
            <CityCard
              key={row.cityCampaignId}
              row={row}
              staff={staff}
              gridRow={i}
              selected={selected.has(row.cityCampaignId)}
              onToggleSelect={(e) =>
                toggleSelect(row.cityCampaignId, !!e && (e.shiftKey || e.metaKey))
              }
            />
          ))
        )}
      </ul>

      <div className="hidden overflow-x-auto sm:block lg:overflow-x-visible" ref={gridNavRef}>
        <table className="w-full min-w-[600px] text-[13px] sm:text-sm">
          <thead className="sticky top-14 z-20">
            <tr className="border-zinc-200/80 border-b bg-zinc-200 text-left font-mono text-[10px] text-zinc-600 uppercase tracking-[0.12em] dark:border-zinc-800/40 dark:bg-zinc-900 dark:text-zinc-400">
              {/* Combined select + expander + priority — one tight cell.
                  Previously three separate frozen columns wasted ~108px
                  of width before the city name appeared. Now packed
                  into w-20 (80px), freeing column real estate for
                  Sales and Notes. The select-all checkbox sits in the
                  header; the priority column is still sort-clickable
                  via the small "#" affordance. */}
              <th
                className={cn(
                  "w-20 px-1 py-3 pl-2",
                  FROZEN_HEAD_BG,
                  FROZEN_LEFT_OFFSETS[0],
                  FROZEN_BASE,
                )}
              >
                <div className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAll}
                    aria-label="Select all visible cities"
                    title="Select all visible rows for a bulk edit"
                    className="h-3.5 w-3.5 cursor-pointer rounded border-zinc-300 align-middle accent-zinc-700 dark:border-zinc-600"
                  />
                  <button
                    type="button"
                    onClick={() => toggleSort("priority")}
                    className="flex-1 text-right text-zinc-600 tabular-nums hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                    title="Priority rank — 1 is highest. Click a number in a row to change it. Sort to bring the most important cities to the top."
                  >
                    {sort.key === "priority" ? (sort.dir === "asc" ? "▲ #" : "▼ #") : "#"}
                  </button>
                </div>
              </th>
              <SortableTh
                label="City"
                sortKey="city"
                sort={sort}
                onSort={toggleSort}
                className={cn(FROZEN_HEAD_BG, FROZEN_LEFT_OFFSETS[1], FROZEN_BASE)}
                tooltip="The city + campaign. Click the city name to open its full sheet; click the arrow on the left of each row to expand its crawls."
              />
              <SortableTh
                label="Sales"
                sortKey="sales"
                sort={sort}
                onSort={toggleSort}
                align="right"
                tooltip="Tickets sold across all of this city's crawls, shown as a dollar/k figure."
              />
              <SortableTh
                label="Status"
                sortKey="status"
                sort={sort}
                onSort={toggleSort}
                tooltip="Where this city stands (e.g. on track, behind, at risk). Computed from crawl progress; click the pill to override it."
              />
              <SortableTh
                label="Need"
                sortKey="need"
                sort={sort}
                onSort={toggleSort}
                tooltip="What's still missing to lock the crawls — open venue slots per crawl. Fewer filled dots means more to book."
              />
              <SortableTh
                label="Assign"
                sortKey="assign"
                sort={sort}
                onSort={toggleSort}
                tooltip="The lead staffer responsible for this city. Click to reassign."
              />
              <SortableTh
                label="Notes"
                sortKey="notes"
                sort={sort}
                onSort={toggleSort}
                // Notes gets a generous min-width (so it's the widest column)
                // but NOT w-full -- w-full made it grab ALL leftover space and
                // cramped the rest. Without it, table-auto shares slack so
                // nothing is cramped and Notes still stays comfortably wide.
                className="min-w-[18rem]"
                tooltip="A quick dashboard note for this city. Click the cell to edit inline."
              />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-16 text-center">
                  <div className="mx-auto max-w-sm">
                    <p className="font-medium text-base text-zinc-700 dark:text-zinc-300">
                      No cities in this campaign yet
                    </p>
                    <p className="mt-1.5 text-xs text-zinc-500">
                      Add cities from{" "}
                      <Link
                        href="/admin"
                        className="font-medium text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-300"
                      >
                        Admin
                      </Link>{" "}
                      or upload a CSV with priority, city, day, and crawl number.
                    </p>
                  </div>
                </td>
              </tr>
            ) : visibleRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-sm text-zinc-500">
                  No cities match that filter.
                </td>
              </tr>
            ) : (
              visibleRows.map((row, i) => (
                <CityRow
                  key={row.cityCampaignId}
                  row={row}
                  staff={staff}
                  stripeIndex={i}
                  selected={selected.has(row.cityCampaignId)}
                  onToggleSelect={(e) =>
                    toggleSelect(row.cityCampaignId, !!e && (e.shiftKey || e.metaKey))
                  }
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Bottom KPI cards — per-day-part crawl-1-complete counts.
          Click any card to filter the table to those cities. Only
          rendered when there's at least one card to show (i.e.
          the campaign has at least one crawl-1 to score). */}
      {kpiCards.cards.length > 0 && (
        <div className="border-zinc-200/80 border-t bg-zinc-50/30 px-3 py-3 dark:border-zinc-800/40 dark:bg-zinc-900/20">
          <div className="mb-2 flex items-baseline gap-2">
            <h3 className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
              Crawl 1 completion
            </h3>
            <span className="text-[10px] text-zinc-400">click a card to filter the table</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {kpiCards.cards.map((card) => {
              const active = kpiFilter === card.key;
              const pct =
                kpiCards.citiesWithCrawl1 > 0
                  ? Math.round((card.count / kpiCards.citiesWithCrawl1) * 100)
                  : 0;
              return (
                <button
                  key={card.key}
                  type="button"
                  onClick={() => setKpiFilter(active ? null : card.key)}
                  className={cn(
                    "flex flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-all",
                    active
                      ? "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-500/30 dark:border-emerald-500 dark:bg-emerald-950/40 dark:ring-emerald-500/30"
                      : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700 dark:hover:bg-zinc-900",
                  )}
                >
                  <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-widest">
                    {card.label}
                  </span>
                  <span className="flex items-baseline gap-1.5">
                    <span
                      className={cn(
                        "font-semibold text-2xl tabular-nums tracking-tight",
                        active
                          ? "text-emerald-700 dark:text-emerald-300"
                          : "text-zinc-900 dark:text-zinc-100",
                      )}
                    >
                      {card.count}
                    </span>
                    <span className="text-xs text-zinc-500">/ {kpiCards.citiesWithCrawl1}</span>
                    <span className="ml-auto font-mono text-[10px] text-zinc-400">{pct}%</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function formatSales(cents: number): string {
  if (!cents) return "—";
  const dollars = cents / 100;
  return dollars >= 1000
    ? `$${(dollars / 1000).toFixed(1)}k`
    : `$${Math.round(dollars).toLocaleString("en-US")}`;
}

/** Inline-editable city priority (1 = highest .. 10 = lowest). */
function PriorityCell({ row }: { row: TrackerRow }) {
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(String(row.priority));
  const toast = useToast();

  function handleChange(next: string) {
    const previous = value;
    setValue(next);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("cityCampaignId", row.cityCampaignId);
      fd.set("priority", next);
      const result = await updateCityCampaignPriority(null, fd);
      // Optimistic UI with error-only toast: success is silent because
      // operators flip priorities in rapid succession; failure
      // SHOULD be loud because the row visibly stayed on its old
      // value but the operator's screen now shows the wrong number.
      if (result && !result.ok) {
        setValue(previous);
        toast.show({
          kind: "error",
          message: result.error ?? "Couldn't update priority.",
        });
      }
    });
  }

  return (
    <div className="group/cell relative inline-block">
      <select
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        disabled={pending}
        aria-label="City priority (1 = highest)"
        title="Priority — 1 is highest, 10 is lowest. Click to change."
        className={cn(
          "w-12 appearance-none rounded-md border border-transparent bg-transparent py-1 pr-4 text-right font-mono text-xs text-zinc-600 tabular-nums transition-colors dark:text-zinc-300",
          "hover:border-zinc-300 hover:bg-white focus:border-zinc-400 focus:bg-white focus:outline-none dark:hover:border-zinc-700 dark:hover:bg-zinc-900",
          pending && "opacity-50",
        )}
      >
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-1 h-2.5 w-2.5 text-zinc-400/60 transition-opacity duration-150 group-hover/cell:text-zinc-500 dark:text-zinc-500/60 dark:group-hover/cell:text-zinc-400"
      />
    </div>
  );
}

/**
 * CityHoursDot — a small glowing dot beside a city name signaling whether it's
 * within outreach/operating hours in THAT city's local time. Green + pulse
 * when it's a good time to reach out (9-21 local), amber at the edges
 * (7-9 / 21-22), grey otherwise. Hover shows the city's exact local time.
 * Clock read is deferred to an effect so SSR and first paint match.
 */
function CityHoursDot({ cityName, timezone }: { cityName: string; timezone: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  if (!now) {
    return (
      <span
        className="inline-block h-2 w-2 shrink-0 rounded-full bg-zinc-300 align-middle dark:bg-zinc-700"
        aria-hidden="true"
      />
    );
  }
  const hour = Number.parseInt(
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hour12: false }).format(
      now,
    ),
    10,
  );
  const localTime = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(now);
  let cls = "bg-zinc-300 dark:bg-zinc-700";
  let label = "outside outreach hours";
  if (hour >= 9 && hour < 21) {
    cls = "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.25)] animate-pulse";
    label = "outreach hours";
  } else if ((hour >= 7 && hour < 9) || (hour >= 21 && hour < 22)) {
    cls = "bg-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,0.2)]";
    label = "borderline outreach time";
  }
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full align-middle ${cls}`}
      title={`${cityName}: ${localTime} local - ${label}`}
      aria-hidden="true"
    />
  );
}

/**
 * Mobile (<sm) variant of CityRow — one card per city. Same editable
 * controls as the table cells, stacked vertically. Tap targets sized
 * up (checkbox is h-5 w-5 inside a p-2 hit area; chevron is h-9 w-9).
 * The crawl breakdown expands inline as a flat list of mini-cards
 * rather than fake table rows.
 */
function CityCard({
  row,
  staff,
  gridRow,
  selected,
  onToggleSelect,
}: {
  row: TrackerRow;
  staff: StaffOption[];
  gridRow: number;
  selected: boolean;
  /** Receives the mouse event so the parent can detect shift / meta
   *  modifier for range-select. Optional to make the parent's call
   *  site terser when the event isn't needed. */
  onToggleSelect: (e?: React.MouseEvent) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasBreakdown = row.need.crawlBreakdown.length > 0;
  // Mirror the desktop CityRow's cityComplete calc — see comments there.
  // "City complete" — every crawl under this city has reached a
  // terminal status: confirmed, contract_signed, completed, or
  // cancelled. The earlier rule (every slot filled OR cancelled)
  // was confusing for crawls that had explicit "confirmed" status
  // but hadn't yet locked all 4 venue assignments — those would
  // never read as complete even when operators considered them
  // done. Status-driven is the operator's mental model.
  //
  // Cities with no crawl breakdown at all (rare — usually a
  // freshly added city before crawl rows exist) are NOT considered
  // complete; they shouldn't read as "done" just because they're
  // empty.
  // Operator mental model: a crawl is "done" when EITHER
  //   - all 4 venue slots are confirmed (the COMPLETE pill —
  //     "we booked it"), OR
  //   - the crawl is explicitly cancelled
  //
  // A city is complete when city.status != 'cancelled' AND
  // every crawl is done AND at least one crawl actually
  // succeeded (booked). Mirrors lib/dashboard-queries.ts.
  const cityComplete =
    hasBreakdown &&
    row.status !== "cancelled" &&
    row.need.crawlBreakdown.every((c) => c.status === "cancelled" || c.confirmedVenueCount >= 4) &&
    row.need.crawlBreakdown.some((c) => c.status !== "cancelled" && c.confirmedVenueCount >= 4);
  // Cancelled cities read as "killed" -- near-black card in light mode, purple
  // in dark (matches the desktop row). Takes precedence over complete + select.
  const isCancelledCity = row.status === "cancelled" || row.need.statusPill === "cancelled";
  return (
    <li
      className={cn(
        "px-3 py-3",
        isCancelledCity
          ? "bg-zinc-800 text-zinc-300 dark:bg-purple-950/70 dark:text-purple-200"
          : cityComplete
            ? "bg-emerald-500/[0.10] dark:bg-emerald-500/[0.14]"
            : "bg-white dark:bg-zinc-950",
        selected && !cityComplete && !isCancelledCity && "bg-blue-50/40 dark:bg-blue-950/15",
      )}
    >
      <div className="flex items-start gap-2">
        <label
          aria-label={`Select ${row.cityName}`}
          className="-m-1 inline-flex shrink-0 cursor-pointer p-1"
        >
          <input
            type="checkbox"
            checked={selected}
            onClick={(e) => onToggleSelect(e)}
            onChange={() => {
              /* handled by onClick above so we can read shiftKey/metaKey */
            }}
            className="h-5 w-5 cursor-pointer rounded border-zinc-300 accent-zinc-700 dark:border-zinc-600"
          />
        </label>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <PriorityCell row={row} />
            <CityHoursDot
              cityName={row.cityName}
              timezone={row.cityTimezone ?? "America/Toronto"}
            />
            <Link
              href={`/city-campaigns/${row.cityCampaignId}`}
              className="min-w-0 flex-1 truncate font-medium text-base text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-100"
            >
              {row.cityName}
              {/* Country abbrev — small quiet badge to disambiguate
                  cities with the same name across countries
                  ("London CAN" vs "London UK"). Operator feedback. */}
              {row.countryCode && (
                <span className="ml-1.5 font-mono text-[10px] text-zinc-400 tracking-wider">
                  {formatCountryAbbrev(row.countryCode)}
                </span>
              )}
            </Link>
            <span className="font-mono text-xs text-zinc-500 tabular-nums">
              {formatSales(row.totalSalesCents)}
            </span>
          </div>
          {row.need.crawlBreakdown.length > 0 ? (
            <div className="mt-2 flex flex-col gap-2">
              <CityStatusGrid
                cityCampaignId={row.cityCampaignId}
                crawls={row.need.crawlBreakdown}
                status={row.status}
              />
              <CrawlSlotNeedGrid crawls={row.need.crawlBreakdown} />
            </div>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <SlotPills slots={row.need.slots} />
            </div>
          )}
          <div className="mt-2 grid grid-cols-[minmax(0,9rem)_1fr] gap-2">
            <AssignSelect row={row} staff={staff} />
            <NoteInput row={row} gridRow={gridRow} />
          </div>
          {hasBreakdown && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              aria-expanded={expanded}
              className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-md px-2 font-mono text-[11px] text-zinc-500 uppercase tracking-wider transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
            >
              <ChevronRight
                className={cn(
                  "h-3.5 w-3.5 transition-transform duration-200 ease-out",
                  expanded && "rotate-90",
                )}
              />
              {expanded ? "Hide crawls" : `${row.need.crawlBreakdown.length} crawls`}
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <ul className="mt-3 ml-8 space-y-2 border-zinc-200/60 border-l pl-3 dark:border-zinc-800/60">
          {row.need.crawlBreakdown.map((crawl) => (
            <CrawlBreakdownCard
              key={`${row.cityCampaignId}-${crawl.dayPart}-${crawl.crawlNumber}`}
              crawl={crawl}
              cityCampaignId={row.cityCampaignId}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function CityRow({
  row,
  staff,
  stripeIndex,
  selected,
  onToggleSelect,
}: {
  row: TrackerRow;
  staff: StaffOption[];
  stripeIndex: number;
  selected: boolean;
  /** Receives the mouse event so the parent can detect shift / meta
   *  modifier for range-select. Optional to make the parent's call
   *  site terser when the event isn't needed. */
  onToggleSelect: (e?: React.MouseEvent) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasBreakdown = row.need.crawlBreakdown.length > 0;

  // "City complete" — every crawl under this city is either:
  //   - fully booked (zero open needs, equivalent to the per-crawl
  //     "Complete" pill), OR
  //   - cancelled (events.status === 'cancelled')
  // Both states mean "we're done with this city; nothing more to do
  // here." The whole row picks up a soft emerald tint as a visible
  // signal so the operator can see at-a-glance which cities are
  // resolved without expanding them.
  //
  // Cities with no crawl breakdown at all (rare — usually a freshly
  // added city before crawl rows exist) are NOT considered complete;
  // they shouldn't read as "done" just because they're empty.
  // "City complete" — every crawl under this city has reached a
  // terminal status: confirmed, contract_signed, completed, or
  // cancelled. The earlier rule (every slot filled OR cancelled)
  // was confusing for crawls that had explicit "confirmed" status
  // but hadn't yet locked all 4 venue assignments — those would
  // never read as complete even when operators considered them
  // done. Status-driven is the operator's mental model.
  //
  // Cities with no crawl breakdown at all (rare — usually a
  // freshly added city before crawl rows exist) are NOT considered
  // complete; they shouldn't read as "done" just because they're
  // empty.
  // Operator mental model: a crawl is "done" when EITHER
  //   - all 4 venue slots are confirmed (the COMPLETE pill —
  //     "we booked it"), OR
  //   - the crawl is explicitly cancelled
  //
  // A city is complete when city.status != 'cancelled' AND
  // every crawl is done AND at least one crawl actually
  // succeeded (booked). Mirrors lib/dashboard-queries.ts.
  const cityComplete =
    hasBreakdown &&
    row.status !== "cancelled" &&
    row.need.crawlBreakdown.every((c) => c.status === "cancelled" || c.confirmedVenueCount >= 4) &&
    row.need.crawlBreakdown.some((c) => c.status !== "cancelled" && c.confirmedVenueCount >= 4);

  // Alternating tones — operators flagged the prior light-mode tones
  // (white + zinc-50/70 ≈ 90% white) as "too light", washing out the
  // table on bright displays. New pairing pushes BOTH stripes into
  // the visible-gray range so the table reads as a distinct surface.
  //   Light mode: zinc-50 (solid) + zinc-100 (solid) — both have full
  //               opacity so backdrop-blur from the canvas can't bleed
  //               through.
  //   Dark mode:  zinc-900/40 + zinc-900/80 — kept similar to before
  //               since the dark canvas already gives plenty of
  //               contrast.
  // When the city is complete, both stripes are replaced by an
  // emerald tint that overrides the zebra — same intent as the
  // per-crawl complete row, scaled up to the city level. In dark
  // mode the wash needs to be noticeably brighter than the
  // per-crawl row's because the city row spans the full width of
  // the table and a subtle 8% emerald reads as "almost zinc" on a
  // black canvas. Bumped to 14% so the row reliably reads as
  // "this is green" without going neon.
  // Cancelled cities read as "killed" -- a near-black row in light mode, a
  // purple row in dark mode (operator's pick). Light text on the dark fill
  // stays readable; takes precedence over the zebra + complete tints.
  const isCancelledCity = row.status === "cancelled" || row.need.statusPill === "cancelled";
  const rowTone = isCancelledCity
    ? "bg-zinc-800 text-zinc-300 dark:bg-purple-950/70 dark:text-purple-200"
    : cityComplete
      ? "bg-emerald-500/[0.10] dark:bg-emerald-500/[0.14]"
      : stripeIndex % 2 === 0
        ? "bg-zinc-50 dark:bg-zinc-900/30"
        : "bg-zinc-100 dark:bg-zinc-900/70";

  return (
    <>
      <tr
        className={cn(
          rowTone,
          "border-zinc-200/50 border-b transition-colors duration-150",
          "hover:bg-blue-500/[0.04] dark:border-zinc-800/40 dark:hover:bg-blue-400/[0.04]",
        )}
      >
        {/* Combined select + expand + priority cell. The three former
            columns sit packed into one w-20 (80px) cell to free space
            for the data columns to the right. Spacing inside the cell
            is tight (gap-1) since each control is small. */}
        <td
          className={cn(
            "w-20 px-1 py-2 pl-2 align-middle sm:py-2.5",
            frozenBodyBg(stripeIndex, cityComplete),
            FROZEN_LEFT_OFFSETS[0],
            FROZEN_BASE,
          )}
        >
          <div className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={selected}
              onClick={(e) => onToggleSelect(e)}
              onChange={() => {
                /* handled by onClick above so we can read shiftKey/metaKey */
              }}
              aria-label={`Select ${row.cityName}`}
              className="h-3.5 w-3.5 cursor-pointer rounded border-zinc-300 align-middle accent-zinc-700 dark:border-zinc-600"
            />
            {hasBreakdown ? (
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                className="flex h-5 w-5 items-center justify-center rounded-md text-zinc-400 transition-all duration-150 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                aria-label={expanded ? "Collapse city breakdown" : "Expand city breakdown"}
                aria-expanded={expanded}
              >
                <ChevronRight
                  className={cn(
                    "h-3.5 w-3.5 transition-transform duration-200 ease-out",
                    expanded && "rotate-90",
                  )}
                />
              </button>
            ) : (
              <span className="inline-block w-5" />
            )}
            <div className="flex-1 text-right">
              <PriorityCell row={row} />
            </div>
          </div>
        </td>

        <td
          className={cn(
            "px-2 py-2 align-middle sm:py-2.5",
            frozenBodyBg(stripeIndex, cityComplete),
            FROZEN_LEFT_OFFSETS[1],
            FROZEN_BASE,
          )}
        >
          <CityHoursDot cityName={row.cityName} timezone={row.cityTimezone ?? "America/Toronto"} />
          <Link
            href={`/city-campaigns/${row.cityCampaignId}`}
            className="font-medium text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-100"
          >
            {row.cityName}
            {/* Country abbrev — small quiet badge for cross-country
                disambiguation. Same affordance as the expanded card
                view above. */}
            {row.countryCode && (
              <span className="ml-1.5 font-mono text-[10px] text-zinc-400 tracking-wider">
                {formatCountryAbbrev(row.countryCode)}
              </span>
            )}
          </Link>
        </td>

        <td className="px-2 py-2 text-right align-middle sm:py-2.5">
          <span className="font-mono text-xs text-zinc-600 tabular-nums dark:text-zinc-300">
            {formatSales(row.totalSalesCents)}
          </span>
        </td>

        <td className="px-2 py-2 align-middle sm:py-2.5">
          {/* Per-crawl × per-day status visualization. Doubles as
              the click target for the Active / Cancelled picker
              on the city row — operators only ever set the city
              status as a binary; the prior multi-state pill never
              earned its keep, so it's been retired in favor of
              clicking the grid directly. Falls back to a small
              dash when the city has no crawl breakdown yet
              (newly added cities pre-crawl). */}
          {row.need.crawlBreakdown.length > 0 ? (
            <CityStatusGrid
              cityCampaignId={row.cityCampaignId}
              crawls={row.need.crawlBreakdown}
              status={row.status}
            />
          ) : (
            <span className="font-mono text-xs text-zinc-400">—</span>
          )}
        </td>

        <td className="px-2 py-2 align-middle sm:py-2.5">
          {/* Per-crawl × per-day venue-need visualization. Same
              dayPart × crawlNumber layout as the status grid, but
              each pill is split into 4 colored sub-segments —
              one per slot (wristband / middle1 / middle2 / final).
              A segment glows the slot's pill color (yellow /
              orange / red) when that slot is still open. Replaces
              the city-level SlotPills aggregate since this gives
              the operator the same info plus per-crawl
              attribution. */}
          {row.need.crawlBreakdown.length > 0 ? (
            <CrawlSlotNeedGrid crawls={row.need.crawlBreakdown} />
          ) : (
            <SlotPills slots={row.need.slots} />
          )}
        </td>

        <td className="px-2 py-2 align-middle sm:py-2.5">
          <AssignSelect row={row} staff={staff} />
        </td>

        <td className="px-2 py-2 align-middle text-xs sm:py-2.5">
          <NoteInput row={row} gridRow={stripeIndex} />
        </td>
      </tr>

      {expanded &&
        row.need.crawlBreakdown.map((crawl, idx) => (
          <CrawlBreakdownRow
            key={`${row.cityCampaignId}-${crawl.dayPart}-${crawl.crawlNumber}`}
            crawl={crawl}
            tone={
              stripeIndex % 2 === 0
                ? "bg-white/40 dark:bg-zinc-900/20"
                : "bg-zinc-50/40 dark:bg-zinc-900/40"
            }
            zebra={idx % 2 === 1}
            parentEven={stripeIndex % 2 === 0}
            cityCampaignId={row.cityCampaignId}
          />
        ))}
    </>
  );
}

function SlotPills({ slots }: { slots: SlotKind[] }) {
  if (slots.length === 0) {
    return (
      <span className="font-mono text-[10px] text-zinc-400 uppercase tracking-[0.1em]">
        all set
      </span>
    );
  }
  // Render in fixed order so the gradient effect is reliable:
  // wristband → middle (or pair) → final
  const ordered = [...slots].sort((a, b) => slotOrder(a) - slotOrder(b));
  return (
    // @container — Tailwind v4 container query root. Children below
    // use `@[<min>]:` modifiers to size themselves according to the
    // WIDTH THIS WRAPPER IS GIVEN, not the viewport. Three responsive
    // tiers, controlled by container width (not screen width) because
    // SlotPills sits inside cells whose width depends on the parent
    // layout, not the page:
    //
    //   < 170px container  → short labels (W / M1 / M2 / M1+2 / F),
    //                        text-[9px], compact padding. The "really
    //                        small" case where abbreviations are the
    //                        only thing that fits without truncation.
    //   170 - 260px        → FULL labels at the same compact size
    //                        (text-[9px], h-[18px]). Still single
    //                        line, just slightly smaller text.
    //   ≥ 260px            → FULL labels at the original size
    //                        (text-[10px], h-[20px], looser padding).
    //
    // Long-form label always available as title + aria-label on every
    // pill so the meaning is preserved when the abbreviation shows.
    <div className="@container flex flex-nowrap items-center gap-x-[2px]">
      {ordered.map((slot) => (
        <span
          key={slot}
          title={SLOT_PILL_LABEL_LONG[slot]}
          aria-label={SLOT_PILL_LABEL_LONG[slot]}
          className={cn(
            // Base pill — sized for the narrow tier. Wider tiers
            // override via @container queries below.
            "inline-flex h-[18px] items-center whitespace-nowrap font-medium font-mono text-[9px] uppercase tabular-nums tracking-[0.06em]",
            // Padding scales with container width. middle_pair gets a
            // touch more inner space at every tier because it carries
            // the widest content ("Middle 1 + 2" / "M1+2").
            slot === "middle_pair"
              ? "@[170px]:px-2.5 @[260px]:px-3 px-2"
              : "@[170px]:px-2 @[260px]:px-2.5 px-1.5",
            // Bigger text + slightly taller pill on the widest tier.
            "@[260px]:h-[20px] @[260px]:text-[10px] @[260px]:tracking-[0.08em]",
            SLOT_PILL_TONE[slot],
            // Tight rounding on inner edges to create the continuous
            // bar feel; outer edges fully round at the ends.
            "first:rounded-l-md last:rounded-r-md",
            ordered.length === 1 && "rounded-md",
          )}
        >
          {/* Short label — visible only when the container is too
              narrow for the full text (< 170px). At every wider tier
              it's hidden in favor of the long label. */}
          <span className="@[170px]:hidden">{SLOT_PILL_LABEL[slot]}</span>
          {/* Long label — hidden by default; visible from 170px up. */}
          <span className="@[170px]:inline hidden">{SLOT_PILL_LABEL_LONG[slot]}</span>
        </span>
      ))}
    </div>
  );
}

function slotOrder(s: SlotKind): number {
  return s === "wristband" ? 0 : s === "final" ? 2 : 1;
}

/** Deterministic pastel pill per staffer so assignments scan at a
 *  glance (operator request 2026-06-11: "coloured pills for assigned
 *  user on tracker sheet"). Hash of the staff id picks a stable
 *  palette slot — same staffer gets the same colour on every row
 *  with zero configuration. */
const ASSIGN_PILL_PALETTE = [
  "bg-sky-500/15 text-sky-700 ring-sky-500/30 dark:text-sky-300",
  "bg-emerald-500/15 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300",
  "bg-amber-500/15 text-amber-700 ring-amber-500/30 dark:text-amber-300",
  "bg-violet-500/15 text-violet-700 ring-violet-500/30 dark:text-violet-300",
  "bg-rose-500/15 text-rose-700 ring-rose-500/30 dark:text-rose-300",
  "bg-teal-500/15 text-teal-700 ring-teal-500/30 dark:text-teal-300",
  "bg-indigo-500/15 text-indigo-700 ring-indigo-500/30 dark:text-indigo-300",
  "bg-orange-500/15 text-orange-700 ring-orange-500/30 dark:text-orange-300",
  "bg-fuchsia-500/15 text-fuchsia-700 ring-fuchsia-500/30 dark:text-fuchsia-300",
  "bg-cyan-500/15 text-cyan-700 ring-cyan-500/30 dark:text-cyan-300",
] as const;

function assignPillClass(staffId: string): string {
  let h = 0;
  for (let i = 0; i < staffId.length; i++) h = (h * 31 + staffId.charCodeAt(i)) >>> 0;
  return ASSIGN_PILL_PALETTE[h % ASSIGN_PILL_PALETTE.length] ?? ASSIGN_PILL_PALETTE[0];
}

function AssignSelect({ row, staff }: { row: TrackerRow; staff: StaffOption[] }) {
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(row.leadStaffId ?? "");
  const [saved, setSaved] = useState(false);
  const toast = useToast();

  function handleChange(newValue: string) {
    const previous = value;
    setValue(newValue);
    setSaved(false);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("cityCampaignId", row.cityCampaignId);
      fd.set("leadStaffId", newValue);
      const result = await reassignCityCampaign(null, fd);
      if (result.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 1200);
      } else {
        // Revert + surface error — the row visually flipped to the
        // new value but the save failed, which would otherwise be
        // silent.
        setValue(previous);
        toast.show({
          kind: "error",
          message: result.error ?? "Couldn't reassign.",
        });
      }
    });
  }

  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        disabled={pending}
        aria-label="Assign lead staffer"
        className={cn(
          "w-full appearance-none border border-transparent py-1 pr-6 pl-2 font-medium text-xs transition-colors duration-150",
          value
            ? cn("rounded-full ring-1 ring-inset", assignPillClass(value))
            : "rounded-md bg-transparent text-zinc-700 hover:bg-white focus:bg-white dark:text-zinc-300 dark:focus:bg-zinc-900 dark:hover:bg-zinc-900",
          "hover:border-zinc-300 focus:border-zinc-400 focus:outline-none",
          "dark:focus:border-zinc-600 dark:hover:border-zinc-700",
          pending && "opacity-50",
        )}
      >
        <option value="">— unassigned —</option>
        {staff.map((s) => (
          <option key={s.id} value={s.id}>
            {firstName(s.displayName)}
          </option>
        ))}
      </select>
      <div className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-1.5 text-zinc-400">
        {pending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : saved ? (
          <Check className="h-3 w-3 text-emerald-500 transition-opacity duration-300" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )}
      </div>
    </div>
  );
}

/** Notes column = the Sheets-grade InlineCell: click to edit, Enter commits +
 *  moves down a row, Esc cancels, optimistic. gridRow lets arrow keys move
 *  between note cells; NOTES_COL is the column coordinate. */
const NOTES_COL = 6;

function NoteInput({ row, gridRow }: { row: TrackerRow; gridRow: number }) {
  const toast = useToast();
  return (
    <InlineCell
      value={row.dashboardNote ?? ""}
      placeholder="Add a note…"
      label={`Dashboard note for ${row.cityName}`}
      cellId={`citycampaign:${row.cityCampaignId}:note`}
      gridRow={gridRow}
      gridCol={NOTES_COL}
      onCommit={async (next) => {
        const fd = new FormData();
        fd.set("cityCampaignId", row.cityCampaignId);
        fd.set("note", next);
        const result = await updateDashboardNote(null, fd);
        if (!result.ok) {
          // InlineCell renders error inline AND we toast it
          // globally — the inline view is great when the operator's
          // looking at the cell; the toast catches the case where
          // they've tabbed away or scrolled past.
          toast.show({
            kind: "error",
            message: result.error ?? "Couldn't save note.",
          });
          return { ok: false, error: result.error };
        }
        return { ok: true };
      }}
    />
  );
}

/**
 * Per-crawl inline note for sub-rows in the expanded breakdown.
 * Distinct from NoteInput (which writes city_campaigns.dashboard_note)
 * — this writes events.notes via updateCrawlNote.
 *
 * Same InlineCell affordance, no grid-nav coords (sub-rows aren't part
 * of the parent grid, so arrow-key navigation doesn't include them).
 */
function CrawlNoteInput({ eventId, initial }: { eventId: string; initial: string }) {
  const toast = useToast();
  return (
    <InlineCell
      value={initial}
      placeholder="Note…"
      variant="subtle"
      label="Crawl note"
      cellId={`event:${eventId}:note`}
      onCommit={async (next) => {
        const fd = new FormData();
        fd.set("eventId", eventId);
        fd.set("note", next);
        const result = await updateCrawlNote(null, fd);
        if (!result.ok) {
          toast.show({
            kind: "error",
            message: result.error ?? "Couldn't save crawl note.",
          });
          return { ok: false, error: result.error };
        }
        return { ok: true };
      }}
    />
  );
}

// Per-crawl status override values. Operator request (session 19):
// the override dropdown should be a simple binary — Active (the
// default everyday state) or Cancelled — not the full lifecycle
// (planned/confirmed/contract_signed/completed/cancelled). The
// lifecycle enum is still what's stored in events.status, but the
// dashboard's override surface maps to it like this:
//   - "Active"    → events.status = "planned"   (the operating default;
//                                                 if a crawl was previously
//                                                 confirmed/contract_signed/
//                                                 completed, picking Active
//                                                 here drops it back to
//                                                 planned, which is what
//                                                 operators want when they
//                                                 untoggle Cancelled)
//   - "Cancelled" → events.status = "cancelled"
// Full lifecycle progression (planned → confirmed → contract_signed →
// completed) happens elsewhere as venues are booked and contracts
// signed — it's NOT the operator's job to flip it manually on the
// dashboard. The override exists only to mark a crawl Cancelled
// without leaving the dashboard.
const OVERRIDE_OPTIONS = ["active", "cancelled"] as const;
type OverrideValue = (typeof OVERRIDE_OPTIONS)[number];

const OVERRIDE_LABEL: Record<OverrideValue, string> = {
  active: "Active",
  cancelled: "Cancelled",
};

const OVERRIDE_TONE: Record<OverrideValue, string> = {
  active:
    "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:bg-emerald-500/15 dark:text-emerald-300",
  cancelled: "bg-zinc-500/8 text-zinc-500 ring-zinc-500/15 line-through dark:text-zinc-500",
};

// Map an events.status enum value (whatever the DB has) to the binary
// override surface. Anything that isn't 'cancelled' reads as Active.
function eventStatusToOverride(s: EventStatus): OverrideValue {
  return s === "cancelled" ? "cancelled" : "active";
}

// Map a binary override surface value back to an events.status value
// for writing. Active → planned (the lifecycle's default starting
// point); Cancelled → cancelled.
function overrideToEventStatus(v: OverrideValue): EventStatus {
  return v === "cancelled" ? "cancelled" : "planned";
}

// Event-status (per-crawl) lifecycle values. The full enum lives here
// because the override mapping helpers (eventStatusToOverride /
// overrideToEventStatus) need to know what's possible. The display
// tone + label tables were dropped — the dashboard's override surface
// uses the binary OVERRIDE_LABEL / OVERRIDE_TONE tables instead.
const EVENT_STATUS_OPTIONS = [
  "planned",
  "confirmed",
  "contract_signed",
  "completed",
  "cancelled",
] as const;
type EventStatus = (typeof EVENT_STATUS_OPTIONS)[number];

/**
 * Per-crawl status override on the expanded tracker row. Mirrors the
 * city-level StatusOverridePill (portaled menu, same outside-click +
 * clamp + glue-on-scroll handling) but targets an event via
 * updateEventStatus. Operators flagged (session 12) that the override
 * should apply to each crawl under a city, per day.
 */
function CrawlStatusOverride({ crawl }: { crawl: CrawlNeed }) {
  const [open, setOpen] = useState(false);
  const [pending, startTx] = useTransition();
  const [saved, setSaved] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const MENU_WIDTH = 176;
  const toast = useToast();

  const recomputePos = useCallback(() => {
    const el = buttonRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const maxLeft = window.innerWidth - MENU_WIDTH - 8;
    const left = Math.max(8, Math.min(rect.left, maxLeft));
    setPos({ top: rect.bottom + 4, left });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    recomputePos();
    function onScrollOrResize() {
      recomputePos();
    }
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, recomputePos]);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      const t = e.target as Node;
      const inContainer = containerRef.current?.contains(t) ?? false;
      const inMenu = menuRef.current?.contains(t) ?? false;
      if (!inContainer && !inMenu) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function setStatus(value: OverrideValue) {
    const next = overrideToEventStatus(value);
    if (next === crawl.status) {
      setOpen(false);
      return;
    }
    const fd = new FormData();
    fd.set("eventId", crawl.eventId);
    fd.set("status", next);
    startTx(async () => {
      try {
        const result = await updateEventStatus(null, fd);
        if (result.ok) {
          setSaved(true);
          setOpen(false);
          setTimeout(() => setSaved(false), 1200);
          // Quiet success: the checkmark animation IS the
          // confirmation. Only surface a toast on the cancellation
          // path because that's the destructive direction operators
          // sometimes regret. (We don't toast Active because flipping
          // back to active is the cheap-to-fix direction.)
          if (value === "cancelled") {
            toast.show({ kind: "success", message: "Crawl marked cancelled." });
          }
        } else {
          // Loud failure — the dropdown closes optimistically but
          // the DB write failed. Without a toast the operator would
          // see the pill flip back to its old value with no
          // explanation.
          toast.show({
            kind: "error",
            message: result.error ?? "Couldn't update crawl status.",
          });
        }
      } catch (err) {
        console.error("[crawl-status] updateEventStatus failed", err);
        toast.show({ kind: "error", message: "Couldn't update crawl status — try again." });
      }
    });
  }

  // The override surface is the binary view of events.status. The
  // underlying enum can be planned/confirmed/contract_signed/completed
  // — all of those collapse to "active" here; only "cancelled" reads
  // as "cancelled". Picking Active when the DB is already on a
  // lifecycle status > planned would regress it to planned, which is
  // arguably wrong, so we DON'T fire a write when the user picks the
  // option that already matches the override surface (the setStatus
  // guard handles that — current override == picked override → no-op).
  const currentOverride = eventStatusToOverride(crawl.status);
  const currentTone = OVERRIDE_TONE[currentOverride];

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={pending}
        title="Override this crawl's status"
        className={cn(
          "group/pill inline-flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2 font-mono text-[10px] uppercase tracking-[0.1em] ring-1 ring-inset transition-all duration-150",
          "hover:scale-[1.03] focus:outline-none focus:ring-2 focus:ring-zinc-300/40",
          currentTone,
          pending && "opacity-50",
        )}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {pending ? (
          <Loader2 className="h-2.5 w-2.5 animate-spin" />
        ) : saved ? (
          <Check className="h-2.5 w-2.5" />
        ) : null}
        {OVERRIDE_LABEL[currentOverride]}
        <ChevronDown
          aria-hidden="true"
          className="-mr-0.5 h-2.5 w-2.5 opacity-50 transition-opacity duration-150 group-hover/pill:opacity-90"
        />
      </button>

      {open &&
        pos != null &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: "fixed", top: pos.top, left: pos.left, width: MENU_WIDTH }}
            className="z-[60] rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
          >
            <p className="px-2.5 pt-1 pb-1.5 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
              Crawl status
            </p>
            {OVERRIDE_OPTIONS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setStatus(v)}
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs transition-colors",
                  "hover:bg-zinc-100 dark:hover:bg-zinc-800",
                  v === currentOverride && "bg-zinc-50 dark:bg-zinc-800/60",
                )}
              >
                <span>{OVERRIDE_LABEL[v]}</span>
                {v === currentOverride && (
                  <Check className="h-3 w-3 text-zinc-700 dark:text-zinc-300" />
                )}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

/** Per-crawl wristband shipping indicator. Red = not shipped yet
    (pending/ready_to_ship/issue/none), amber = shipped, green = received
    (delivered). Only shown beside individual crawls, never beside a city. */
function WristbandIcon({ status }: { status: CrawlNeed["wristbandStatus"] }) {
  const { tone, label } =
    status === "delivered"
      ? { tone: "text-green-500 dark:text-green-400", label: "Wristbands received" }
      : status === "shipped"
        ? { tone: "text-amber-500 dark:text-amber-400", label: "Wristbands shipped" }
        : {
            tone: "text-red-500 dark:text-red-400",
            label: status === "issue" ? "Wristband issue" : "Wristbands not shipped",
          };
  return (
    <span className={cn("inline-flex shrink-0", tone)} title={label} aria-label={label}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="2.5" y="8.5" width="19" height="7" rx="3.5" fill="currentColor" opacity="0.2" />
        <rect
          x="2.5"
          y="8.5"
          width="19"
          height="7"
          rx="3.5"
          stroke="currentColor"
          strokeWidth="2"
        />
        <circle cx="12" cy="12" r="1.7" fill="currentColor" />
      </svg>
    </span>
  );
}

/**
 * Per-crawl host indicator. Sits beside the WristbandIcon in the
 * breakdown row's leading area.
 *
 *   - "internal" → blue person-in-circle with a small down-arrow
 *                  badge ("our staff coming in to host")
 *   - "external" → orange person-in-circle with a small out-arrow
 *                  badge ("third-party host going out to the venue")
 *   - "none"     → grey person-in-circle with a strike-through
 *                  ("no host needed / not yet assigned")
 *
 * All three icons share the same 14×14 footprint so they align with
 * the WristbandIcon row. Tooltips spell out the meaning.
 */
function HostIcon({ hostType }: { hostType: CrawlNeed["hostType"] }) {
  const { tone, label, accent } =
    hostType === "internal"
      ? {
          tone: "text-blue-500 dark:text-blue-400",
          label: "Internal host assigned",
          accent: "internal" as const,
        }
      : hostType === "external"
        ? {
            tone: "text-orange-500 dark:text-orange-400",
            label: "External host assigned",
            accent: "external" as const,
          }
        : {
            tone: "text-zinc-400 dark:text-zinc-500",
            label: "No host needed",
            accent: "none" as const,
          };
  return (
    <span className={cn("inline-flex shrink-0", tone)} title={label} aria-label={label}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {/* Outer circle */}
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="1.8"
          fill="currentColor"
          fillOpacity="0.15"
        />
        {/* Head */}
        <circle cx="12" cy="9.5" r="2.4" fill="currentColor" />
        {/* Shoulders */}
        <path
          d="M5.5 18.5c1.2-3.2 4-4.6 6.5-4.6s5.3 1.4 6.5 4.6"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          fill="none"
        />
        {accent === "none" && (
          // Diagonal strike-through across the whole icon
          <line
            x1="4"
            y1="20"
            x2="20"
            y2="4"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        )}
        {accent === "internal" && (
          // Small down-arrow badge in the bottom-right (incoming = our
          // staff coming IN to host)
          <>
            <circle cx="18.5" cy="18.5" r="3.6" fill="currentColor" />
            <path
              d="M18.5 16.5v3.6m0 0l-1.4-1.4m1.4 1.4l1.4-1.4"
              stroke="white"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </>
        )}
        {accent === "external" && (
          // Small out-arrow badge in the bottom-right (outgoing =
          // third-party host going OUT to the venue)
          <>
            <circle cx="18.5" cy="18.5" r="3.6" fill="currentColor" />
            <path
              d="M16.7 20.3l3.6-3.6m0 0h-2m2 0v2"
              stroke="white"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </>
        )}
      </svg>
    </span>
  );
}

/** Mobile (<sm) breakdown — flat list inside the parent CityCard. */
function CrawlBreakdownCard({
  crawl,
  cityCampaignId,
}: {
  crawl: CrawlNeed;
  cityCampaignId: string;
}) {
  const slots: SlotKind[] = [];
  if (crawl.needsWristband) slots.push("wristband");
  if (crawl.needsMiddle1 && crawl.needsMiddle2) slots.push("middle_pair");
  else if (crawl.needsMiddle1) slots.push("middle_1");
  else if (crawl.needsMiddle2) slots.push("middle_2");
  if (crawl.needsFinal) slots.push("final");

  const allConfirmed =
    !crawl.needsWristband && !crawl.needsMiddle1 && !crawl.needsMiddle2 && !crawl.needsFinal;

  return (
    <li
      className={cn(
        "flex flex-col gap-1 rounded-md py-1",
        allConfirmed && "bg-emerald-500/[0.06] px-2 dark:bg-emerald-500/[0.07]",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <WristbandIcon status={crawl.wristbandStatus} />
        <HostIcon hostType={crawl.hostType} />
        <Link
          href={`/city-campaigns/${cityCampaignId}#crawl-${crawl.eventId}`}
          title="Open this crawl on the city sheet"
          className="text-xs text-zinc-600 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          {dayLabel(crawl.dayPart)} crawl {crawl.crawlNumber}
        </Link>
        {crawl.salesCents > 0 && (
          <span className="font-mono text-[10px] text-zinc-500 tabular-nums">
            {formatSales(crawl.salesCents)}
          </span>
        )}
        <CrawlStatusOverride crawl={crawl} />
        {allConfirmed && (
          <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 font-mono text-[10px] text-emerald-700 uppercase tracking-[0.1em] ring-1 ring-emerald-500/30 ring-inset dark:text-emerald-300">
            Complete
          </span>
        )}
        <div className="ml-auto">
          <SlotPills slots={slots} />
        </div>
      </div>
      <CrawlNoteInput eventId={crawl.eventId} initial={crawl.notes} />
    </li>
  );
}

function CrawlBreakdownRow({
  crawl,
  tone,
  zebra,
  parentEven,
  cityCampaignId,
}: {
  crawl: CrawlNeed;
  tone: string;
  zebra: boolean;
  parentEven: boolean;
  cityCampaignId: string;
}) {
  const open =
    (crawl.needsWristband ? 1 : 0) +
    (crawl.needsMiddle1 ? 1 : 0) +
    (crawl.needsMiddle2 ? 1 : 0) +
    (crawl.needsFinal ? 1 : 0);
  const allConfirmed = open === 0;
  // Per operator feedback (session 19): when all 4 venues are
  // confirmed the row was showing "Outreach" — that's wrong; this
  // crawl is fully booked and should read as Complete in green. The
  // city-level pill mapping still uses STATUS_PILL_TONE.outreach for
  // "no slots open across the whole city" since that surface has its
  // own semantics (some cities legitimately are still in outreach
  // mode with zero needs), but per-crawl Complete is unambiguous.
  const statusLabel = allConfirmed ? "Complete" : open === 1 ? "Need 1" : `Need ${open}`;
  const COMPLETE_TONE =
    "bg-emerald-500/15 text-emerald-700 ring-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300";
  const statusTone = allConfirmed
    ? COMPLETE_TONE
    : open === 1
      ? STATUS_PILL_TONE.need_1_venue
      : open === 2
        ? STATUS_PILL_TONE.need_2_venues
        : STATUS_PILL_TONE.need_3_venues;

  const slots: SlotKind[] = [];
  if (crawl.needsWristband) slots.push("wristband");
  if (crawl.needsMiddle1 && crawl.needsMiddle2) slots.push("middle_pair");
  else if (crawl.needsMiddle1) slots.push("middle_1");
  else if (crawl.needsMiddle2) slots.push("middle_2");
  if (crawl.needsFinal) slots.push("final");

  return (
    <tr
      className={cn(
        // Complete crawls get a subtle green wash that overrides the
        // zebra striping — it's the same intent as the rose tint on
        // a Cancelled row would be: a row-level signal, not a cell.
        allConfirmed
          ? "bg-emerald-500/[0.06] dark:bg-emerald-500/[0.07]"
          : zebra
            ? "bg-zinc-200/40 dark:bg-zinc-800/15"
            : tone,
        "border-zinc-200/30 border-b dark:border-zinc-800/20",
        "animate-[fade-in_180ms_ease-out]",
      )}
    >
      {/* Empty leading cell mirroring the parent row's combined
          checkbox/expand/# column. Just frozen-background filler so
          the breakdown row aligns under the parent. */}
      <td
        className={cn(
          "w-20 px-1 py-1.5 pl-2",
          frozenBreakdownBg(zebra, parentEven),
          FROZEN_LEFT_OFFSETS[0],
          FROZEN_BASE,
        )}
      />
      {/* City column slot — shows the crawl label + wristband icon +
          status override. Indented (pl-6) so it visually sits inside
          its parent. */}
      <td
        className={cn(
          "px-2 py-1.5",
          frozenBreakdownBg(zebra, parentEven),
          FROZEN_LEFT_OFFSETS[1],
          FROZEN_BASE,
        )}
      >
        <div className="flex items-center gap-2 pl-6">
          <WristbandIcon status={crawl.wristbandStatus} />
          <HostIcon hostType={crawl.hostType} />
          <span className="h-1 w-1 rounded-full bg-zinc-400/60" />
          <Link
            href={`/city-campaigns/${cityCampaignId}#crawl-${crawl.eventId}`}
            title="Open this crawl on the city sheet"
            className="text-xs text-zinc-600 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            {dayLabel(crawl.dayPart)} crawl {crawl.crawlNumber}
          </Link>
          <CrawlStatusOverride crawl={crawl} />
        </div>
      </td>
      {/* Per-crawl Sales — mirrors the parent's Sales column. Computed
          as tickets × $30 in lib/tracker-status.ts; will be replaced
          with real Eventbrite numbers when that integration lands. */}
      <td className="px-2 py-1.5 text-right">
        {crawl.salesCents > 0 ? (
          <span className="font-mono text-[11px] text-zinc-600 tabular-nums dark:text-zinc-300">
            {formatSales(crawl.salesCents)}
          </span>
        ) : (
          <span className="font-mono text-[11px] text-zinc-400">—</span>
        )}
      </td>
      <td className="px-2 py-1.5">
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] ring-1 ring-inset",
            statusTone,
          )}
        >
          {statusLabel}
        </span>
      </td>
      <td className="px-2 py-1.5">
        <SlotPills slots={slots} />
      </td>
      {/* Assign slot — empty for sub-crawls (lead assignment is per
          city). Kept as a placeholder cell so the column grid stays
          aligned with the parent row. */}
      <td className="px-2 py-1.5" />
      {/* Per-crawl note — independent of the city-level dashboard
          note. events.notes column; edited inline via
          updateCrawlNote. */}
      <td className="px-2 py-1.5">
        <CrawlNoteInput eventId={crawl.eventId} initial={crawl.notes} />
      </td>
    </tr>
  );
}

function firstName(name: string): string {
  return name.split(" ")[0] ?? name;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function dayLabel(dayPart: string): string {
  // day_part enum values are like "thursday_night" / "friday_night";
  // tracker rows show the simpler day name.
  const day = dayPart.split("_")[0] ?? dayPart;
  return capitalize(day);
}
