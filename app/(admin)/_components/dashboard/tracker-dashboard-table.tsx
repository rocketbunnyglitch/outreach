"use client";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import {
  type CityNeedSummary,
  type CityStatusPill,
  type CrawlNeed,
  SLOT_PILL_LABEL,
  SLOT_PILL_TONE,
  STATUS_PILL_LABEL,
  STATUS_PILL_TONE,
  type SlotKind,
} from "@/lib/tracker-status-types";
import { Check, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import Link from "next/link";
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
  reassignCityCampaign,
  updateCityCampaignPriority,
  updateCityCampaignStatus,
  updateDashboardNote,
  updateEventStatus,
} from "../../_actions-tracker";

export interface TrackerRow {
  cityCampaignId: string;
  cityId: string;
  cityName: string;
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
}

type SortKey = "priority" | "city" | "status" | "need" | "sales" | "assign" | "notes";

const STATUS_PILL_RANK: Record<CityStatusPill, number> = {
  outreach: 0,
  need_1_venue: 1,
  need_2_venues: 2,
  need_3_venues: 3,
  cancelled: 4,
};

/** Columns that read most naturally ascending (text); the rest default desc. */
const ASC_DEFAULT: ReadonlySet<SortKey> = new Set(["priority", "city", "assign", "notes"]);

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
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: "asc" | "desc" };
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <th className={cn("px-3 py-3", align === "right" && "text-right", className)}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
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
export function TrackerDashboardTable({ rows, staff }: Props) {
  const [query, setQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<"top" | "all">("top");
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

  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = priorityFilter === "top" ? rows.filter((r) => r.priority <= 4) : rows;
    const filtered = q
      ? base.filter((r) => {
          const assignee = r.leadStaffId ? (staffNameById.get(r.leadStaffId) ?? "") : "";
          return (
            r.cityName.toLowerCase().includes(q) ||
            STATUS_PILL_LABEL[r.need.statusPill].toLowerCase().includes(q) ||
            assignee.toLowerCase().includes(q) ||
            (r.dashboardNote ?? "").toLowerCase().includes(q)
          );
        })
      : base;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => compareRows(a, b, sort.key, staffNameById) * dir);
  }, [rows, query, sort, staffNameById, priorityFilter]);

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-sm shadow-zinc-200/40 dark:border-zinc-800/60 dark:bg-zinc-950/60 dark:shadow-none">
      <div className="flex flex-wrap items-center gap-2 border-zinc-200/80 border-b px-3 py-2 dark:border-zinc-800/40">
        <div className="flex items-center gap-1">
          {(
            [
              { key: "top", label: "Priority 1-4" },
              { key: "all", label: "Show all" },
            ] as const
          ).map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => setPriorityFilter(chip.key)}
              className={cn(
                "rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ring-1 ring-inset transition-colors",
                priorityFilter === chip.key
                  ? "bg-zinc-900 text-white ring-zinc-900 dark:bg-white dark:text-zinc-900 dark:ring-white"
                  : "bg-transparent text-zinc-500 ring-zinc-300 hover:bg-zinc-100 dark:ring-zinc-700 dark:hover:bg-zinc-900",
              )}
            >
              {chip.label}
            </button>
          ))}
        </div>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by city, status, assignee, or note…"
          className="h-8 max-w-sm text-sm"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] text-[13px] sm:text-sm">
          <thead>
            <tr className="border-zinc-200/80 border-b bg-zinc-200/60 text-left font-mono text-[10px] text-zinc-600 uppercase tracking-[0.12em] dark:border-zinc-800/40 dark:bg-zinc-900/40 dark:text-zinc-500">
              <th className="w-9 px-2 py-3" />
              <SortableTh
                label="#"
                sortKey="priority"
                sort={sort}
                onSort={toggleSort}
                align="right"
                className="w-10 px-2"
              />
              <SortableTh label="City" sortKey="city" sort={sort} onSort={toggleSort} />
              <SortableTh label="Status" sortKey="status" sort={sort} onSort={toggleSort} />
              <SortableTh label="Need" sortKey="need" sort={sort} onSort={toggleSort} />
              <SortableTh
                label="Sales"
                sortKey="sales"
                sort={sort}
                onSort={toggleSort}
                align="right"
                className="w-24"
              />
              <SortableTh
                label="Assign"
                sortKey="assign"
                sort={sort}
                onSort={toggleSort}
                className="w-32"
              />
              <SortableTh label="Notes" sortKey="notes" sort={sort} onSort={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-16 text-center">
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
                <td colSpan={8} className="px-4 py-12 text-center text-sm text-zinc-500">
                  No cities match that filter.
                </td>
              </tr>
            ) : (
              visibleRows.map((row, i) => (
                <CityRow key={row.cityCampaignId} row={row} staff={staff} stripeIndex={i} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatSales(cents: number): string {
  if (!cents) return "—";
  const dollars = cents / 100;
  return dollars >= 1000
    ? `$${(dollars / 1000).toFixed(1)}k`
    : `$${Math.round(dollars).toLocaleString()}`;
}

/** Inline-editable city priority (1 = highest .. 10 = lowest). */
function PriorityCell({ row }: { row: TrackerRow }) {
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(String(row.priority));

  function handleChange(next: string) {
    setValue(next);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("cityCampaignId", row.cityCampaignId);
      fd.set("priority", next);
      await updateCityCampaignPriority(null, fd);
    });
  }

  return (
    <select
      value={value}
      onChange={(e) => handleChange(e.target.value)}
      disabled={pending}
      aria-label="City priority (1 = highest)"
      title="Priority — 1 is highest, 10 is lowest. Click to change."
      className={cn(
        "w-12 appearance-none rounded-md border border-transparent bg-transparent py-1 text-right font-mono text-xs text-zinc-600 tabular-nums transition-colors dark:text-zinc-300",
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
  );
}

function CityRow({
  row,
  staff,
  stripeIndex,
}: {
  row: TrackerRow;
  staff: StaffOption[];
  stripeIndex: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasBreakdown = row.need.crawlBreakdown.length > 0;

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
  const rowTone =
    stripeIndex % 2 === 0 ? "bg-zinc-50 dark:bg-zinc-900/30" : "bg-zinc-100 dark:bg-zinc-900/70";

  return (
    <>
      <tr
        className={cn(
          rowTone,
          "border-zinc-200/50 border-b transition-colors duration-150",
          "hover:bg-blue-500/[0.04] dark:border-zinc-800/40 dark:hover:bg-blue-400/[0.04]",
        )}
      >
        <td className="px-2 py-2 align-middle sm:py-2.5">
          {hasBreakdown && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 transition-all duration-150 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
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
          )}
        </td>

        <td className="px-2 py-2.5 text-right align-middle">
          <PriorityCell row={row} />
        </td>

        <td className="px-3 py-2 align-middle sm:py-2.5">
          <Link
            href={`/city-campaigns/${row.cityCampaignId}`}
            className="font-medium text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-100"
          >
            {row.cityName}
          </Link>
        </td>

        <td className="px-3 py-2 align-middle sm:py-2.5">
          <StatusOverridePill row={row} />
        </td>

        <td className="px-3 py-2 align-middle sm:py-2.5">
          <SlotPills slots={row.need.slots} />
        </td>

        <td className="px-3 py-2.5 text-right align-middle">
          <span className="font-mono text-xs text-zinc-600 tabular-nums dark:text-zinc-300">
            {formatSales(row.totalSalesCents)}
          </span>
        </td>

        <td className="px-3 py-2 align-middle sm:py-2.5">
          <AssignSelect row={row} staff={staff} />
        </td>

        <td className="px-3 py-2 align-middle sm:py-2.5">
          <NoteInput row={row} />
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
          />
        ))}
    </>
  );
}

function StatusOverridePill({ row }: { row: TrackerRow }) {
  const [open, setOpen] = useState(false);
  const [pending, startTx] = useTransition();
  const [saved, setSaved] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // Portaled menu ref — the menu renders into document.body to escape
  // the tracker table's overflow clipping (the operator's "override
  // gets cut off, limited to the table" bug, session 12). Outside-
  // click must check this ref too, otherwise clicking a menu option
  // (which lives in document.body) closes the menu before the option's
  // onClick runs — same class of bug as the venue picker (51ea440).
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const MENU_WIDTH = 192; // w-48

  const recomputePos = useCallback(() => {
    const el = buttonRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // Anchor below-left of the pill, but clamp so the menu never
    // overflows the right edge (8px gutter).
    const maxLeft = window.innerWidth - MENU_WIDTH - 8;
    const left = Math.max(8, Math.min(rect.left, maxLeft));
    setPos({ top: rect.bottom + 4, left });
  }, []);

  // Recompute on open + keep glued on scroll/resize.
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
      const target = e.target as Node;
      const inContainer = containerRef.current?.contains(target) ?? false;
      const inMenu = menuRef.current?.contains(target) ?? false;
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

  function setStatus(status: "planning" | "active" | "confirmed" | "cancelled") {
    if (status === row.status) {
      setOpen(false);
      return;
    }
    const fd = new FormData();
    fd.set("cityCampaignId", row.cityCampaignId);
    fd.set("status", status);
    startTx(async () => {
      try {
        const result = await updateCityCampaignStatus(null, fd);
        if (result.ok) {
          setSaved(true);
          setOpen(false);
          setTimeout(() => setSaved(false), 1200);
        }
      } catch (err) {
        console.error("[status-override] updateCityCampaignStatus failed", err);
      }
    });
  }

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={pending}
        title="Click to override · pill auto-suggests from open slots"
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] ring-1 ring-inset transition-all duration-150",
          "hover:scale-[1.03] hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-zinc-300/40",
          STATUS_PILL_TONE[row.need.statusPill],
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
        {STATUS_PILL_LABEL[row.need.statusPill]}
      </button>

      {open &&
        pos != null &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              width: MENU_WIDTH,
            }}
            className="z-[60] rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
          >
            <p className="px-2.5 pt-1 pb-1.5 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
              Override status
            </p>
            {(["planning", "active", "confirmed", "cancelled"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs transition-colors",
                  "hover:bg-zinc-100 dark:hover:bg-zinc-800",
                  s === row.status && "bg-zinc-50 dark:bg-zinc-800/60",
                )}
              >
                <span className="capitalize">{s}</span>
                {s === row.status && <Check className="h-3 w-3 text-zinc-700 dark:text-zinc-300" />}
              </button>
            ))}
            <p className="border-zinc-200 border-t px-2.5 pt-2 pb-1 text-[10px] text-zinc-500 leading-relaxed dark:border-zinc-800">
              Auto-suggests from open slot count — override sticks until you change it.
            </p>
          </div>,
          document.body,
        )}
    </div>
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
    <div className="flex flex-wrap items-center gap-x-[3px] gap-y-1">
      {ordered.map((slot) => (
        <span
          key={slot}
          className={cn(
            "inline-flex h-[22px] items-center font-medium font-mono text-[10px] uppercase tracking-[0.08em]",
            // whitespace-nowrap: prevents "Middle 1 + 2" from wrapping
            // onto two lines at narrow viewport widths, which made the
            // middle pill taller than its neighbors and broke the
            // continuous-bar visual.
            "whitespace-nowrap",
            SLOT_PILL_TONE[slot],
            // Tight rounding on inner edges to create the continuous bar feel
            slot === "middle_pair" ? "px-3" : "px-2.5",
            "first:rounded-l-md last:rounded-r-md",
            // When standing alone, fully round
            ordered.length === 1 && "rounded-md",
          )}
        >
          {SLOT_PILL_LABEL[slot]}
        </span>
      ))}
    </div>
  );
}

function slotOrder(s: SlotKind): number {
  return s === "wristband" ? 0 : s === "final" ? 2 : 1;
}

function AssignSelect({ row, staff }: { row: TrackerRow; staff: StaffOption[] }) {
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(row.leadStaffId ?? "");
  const [saved, setSaved] = useState(false);

  function handleChange(newValue: string) {
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
          "w-full appearance-none rounded-md border border-transparent bg-transparent py-1 pr-6 pl-2 font-medium text-xs text-zinc-700 transition-colors duration-150 dark:text-zinc-300",
          "hover:border-zinc-300 hover:bg-white focus:border-zinc-400 focus:bg-white focus:outline-none",
          "dark:focus:border-zinc-600 dark:focus:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-900",
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

function NoteInput({ row }: { row: TrackerRow }) {
  const [pending, startTransition] = useTransition();
  const [committedValue, setCommittedValue] = useState(row.dashboardNote ?? "");
  const [draft, setDraft] = useState(committedValue);
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the input in sync if the row prop changes (e.g. parent revalidates)
  useEffect(() => {
    setCommittedValue(row.dashboardNote ?? "");
    setDraft(row.dashboardNote ?? "");
  }, [row.dashboardNote]);

  function commit() {
    if (draft === committedValue) return;
    setSaved(false);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("cityCampaignId", row.cityCampaignId);
      fd.set("note", draft);
      const result = await updateDashboardNote(null, fd);
      if (result.ok) {
        setCommittedValue(draft);
        setSaved(true);
        setTimeout(() => setSaved(false), 1200);
      }
    });
  }

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setDraft(committedValue);
            e.currentTarget.blur();
          }
        }}
        disabled={pending}
        placeholder="Add a note…"
        className={cn(
          "h-7 border-transparent bg-transparent pr-6 text-xs transition-colors duration-150",
          "hover:border-zinc-300 hover:bg-white focus:border-zinc-400 focus:bg-white",
          "dark:focus:border-zinc-600 dark:focus:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-900",
          "placeholder:text-zinc-400/60",
        )}
      />
      {(pending || saved) && (
        <div className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-2">
          {pending ? (
            <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />
          ) : (
            <Check className="h-3 w-3 text-emerald-500" />
          )}
        </div>
      )}
    </div>
  );
}

// Event-status (per-crawl) lifecycle values + display tones. Distinct
// from the city-campaign status pill — these are the events.status
// enum (planned → confirmed → contract_signed → completed; cancelled).
const EVENT_STATUS_OPTIONS = [
  "planned",
  "confirmed",
  "contract_signed",
  "completed",
  "cancelled",
] as const;
type EventStatus = (typeof EVENT_STATUS_OPTIONS)[number];

const EVENT_STATUS_LABEL: Record<EventStatus, string> = {
  planned: "Planned",
  confirmed: "Confirmed",
  contract_signed: "Signed",
  completed: "Completed",
  cancelled: "Cancelled",
};

const EVENT_STATUS_TONE: Record<EventStatus, string> = {
  planned: "bg-zinc-500/10 text-zinc-600 ring-zinc-500/20 dark:text-zinc-300",
  confirmed:
    "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:bg-emerald-500/15 dark:text-emerald-300",
  contract_signed:
    "bg-blue-500/10 text-blue-700 ring-blue-500/20 dark:bg-blue-500/15 dark:text-blue-300",
  completed:
    "bg-violet-500/10 text-violet-700 ring-violet-500/20 dark:bg-violet-500/15 dark:text-violet-300",
  cancelled: "bg-zinc-500/8 text-zinc-500 ring-zinc-500/15 line-through dark:text-zinc-500",
};

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

  function setStatus(status: EventStatus) {
    if (status === crawl.status) {
      setOpen(false);
      return;
    }
    const fd = new FormData();
    fd.set("eventId", crawl.eventId);
    fd.set("status", status);
    startTx(async () => {
      try {
        const result = await updateEventStatus(null, fd);
        if (result.ok) {
          setSaved(true);
          setOpen(false);
          setTimeout(() => setSaved(false), 1200);
        }
      } catch (err) {
        console.error("[crawl-status] updateEventStatus failed", err);
      }
    });
  }

  const currentTone = EVENT_STATUS_TONE[crawl.status] ?? EVENT_STATUS_TONE.planned;

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={pending}
        title="Override this crawl's status"
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] ring-1 ring-inset transition-all duration-150",
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
        {EVENT_STATUS_LABEL[crawl.status] ?? crawl.status}
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
            {EVENT_STATUS_OPTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs transition-colors",
                  "hover:bg-zinc-100 dark:hover:bg-zinc-800",
                  s === crawl.status && "bg-zinc-50 dark:bg-zinc-800/60",
                )}
              >
                <span>{EVENT_STATUS_LABEL[s]}</span>
                {s === crawl.status && (
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

function CrawlBreakdownRow({
  crawl,
  tone,
  zebra,
}: {
  crawl: CrawlNeed;
  tone: string;
  zebra: boolean;
}) {
  const open =
    (crawl.needsWristband ? 1 : 0) +
    (crawl.needsMiddle1 ? 1 : 0) +
    (crawl.needsMiddle2 ? 1 : 0) +
    (crawl.needsFinal ? 1 : 0);
  const statusLabel = open === 0 ? "Outreach" : open === 1 ? "Need 1" : `Need ${open}`;
  const statusTone =
    open === 0
      ? STATUS_PILL_TONE.outreach
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
        zebra ? "bg-zinc-200/40 dark:bg-zinc-800/15" : tone,
        "border-zinc-200/30 border-b dark:border-zinc-800/20",
        "animate-[fade-in_180ms_ease-out]",
      )}
    >
      <td className="px-2 py-1.5" />
      <td className="px-2 py-1.5" />
      <td className="px-3 py-1.5">
        <div className="flex items-center gap-2 pl-6">
          <WristbandIcon status={crawl.wristbandStatus} />
          <span className="h-1 w-1 rounded-full bg-zinc-400/60" />
          <span className="text-xs text-zinc-600 dark:text-zinc-400">
            {dayLabel(crawl.dayPart)} crawl {crawl.crawlNumber}
          </span>
          <CrawlStatusOverride crawl={crawl} />
        </div>
      </td>
      <td className="px-3 py-1.5">
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] ring-1 ring-inset",
            statusTone,
          )}
        >
          {statusLabel}
        </span>
      </td>
      <td className="px-3 py-1.5">
        <SlotPills slots={slots} />
      </td>
      <td className="px-3 py-1.5" colSpan={3}>
        {crawl.ticketsSold > 0 && (
          <span className="font-mono text-[10px] text-zinc-500 tabular-nums">
            {crawl.ticketsSold} tickets sold
          </span>
        )}
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
