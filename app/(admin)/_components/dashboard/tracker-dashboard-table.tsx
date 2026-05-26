"use client";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import {
  type CityNeedSummary,
  type CrawlNeed,
  SLOT_PILL_LABEL,
  SLOT_PILL_TONE,
  STATUS_PILL_LABEL,
  STATUS_PILL_TONE,
  type SlotKind,
} from "@/lib/tracker-status";
import { Check, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  reassignCityCampaign,
  updateCityCampaignStatus,
  updateDashboardNote,
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
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-sm shadow-zinc-200/40 dark:border-zinc-800/60 dark:bg-zinc-950/60 dark:shadow-none">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-zinc-200/80 border-b bg-zinc-50/60 text-left font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em] dark:border-zinc-800/40 dark:bg-zinc-900/40 dark:text-zinc-500">
            <th className="w-9 px-2 py-3" />
            <th className="w-10 px-2 py-3 text-right">#</th>
            <th className="px-3 py-3">City</th>
            <th className="px-3 py-3 text-right">Sales</th>
            <th className="px-3 py-3">Status</th>
            <th className="px-3 py-3">Need</th>
            <th className="w-32 px-3 py-3">Assign</th>
            <th className="px-3 py-3">Notes</th>
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
          ) : (
            rows.map((row, i) => (
              <CityRow key={row.cityCampaignId} row={row} staff={staff} stripeIndex={i} />
            ))
          )}
        </tbody>
      </table>
    </div>
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

  // Alternating tones — pulled apart enough to read clearly but close
  // enough that the table reads as one surface. Light mode: white +
  // zinc-50/60. Dark mode: zinc-900/30 + zinc-900/60 (the "medium gray
  // / dark gray" pairing the spec asks for).
  const rowTone =
    stripeIndex % 2 === 0 ? "bg-white dark:bg-zinc-900/30" : "bg-zinc-50/70 dark:bg-zinc-900/60";

  return (
    <>
      <tr
        className={cn(
          rowTone,
          "border-zinc-200/50 border-b transition-colors duration-150",
          "hover:bg-blue-500/[0.04] dark:border-zinc-800/40 dark:hover:bg-blue-400/[0.04]",
        )}
      >
        <td className="px-2 py-2.5 align-middle">
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
          <span className="font-mono text-xs text-zinc-500 tabular-nums">{row.priority}</span>
        </td>

        <td className="px-3 py-2.5 align-middle">
          <Link
            href={`/city-campaigns/${row.cityCampaignId}`}
            className="font-medium text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-100"
          >
            {row.cityName}
          </Link>
        </td>

        <td className="px-3 py-2.5 text-right align-middle">
          <span className="font-mono text-xs text-zinc-700 tabular-nums dark:text-zinc-300">
            {formatMoney(row.totalSalesCents)}
          </span>
        </td>

        <td className="px-3 py-2.5 align-middle">
          <StatusOverridePill row={row} />
        </td>

        <td className="px-3 py-2.5 align-middle">
          <SlotPills slots={row.need.slots} />
        </td>

        <td className="px-3 py-2.5 align-middle">
          <AssignSelect row={row} staff={staff} />
        </td>

        <td className="px-3 py-2.5 align-middle">
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

  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
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
      const result = await updateCityCampaignStatus(null, fd);
      if (result.ok) {
        setSaved(true);
        setOpen(false);
        setTimeout(() => setSaved(false), 1200);
      }
    });
  }

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
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

      {open && (
        <div
          role="menu"
          className="absolute top-full left-0 z-50 mt-1 w-48 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
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
        </div>
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
    <div className="inline-flex items-center gap-[3px]">
      {ordered.map((slot) => (
        <span
          key={slot}
          className={cn(
            "inline-flex h-[22px] items-center font-medium font-mono text-[10px] uppercase tracking-[0.08em]",
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
        zebra ? "bg-zinc-100/30 dark:bg-zinc-800/15" : tone,
        "border-zinc-200/30 border-b dark:border-zinc-800/20",
        "animate-[fade-in_180ms_ease-out]",
      )}
    >
      <td className="px-2 py-1.5" />
      <td className="px-2 py-1.5" />
      <td className="px-3 py-1.5">
        <div className="flex items-center gap-2 pl-6">
          <span className="h-1 w-1 rounded-full bg-zinc-400/60" />
          <span className="text-xs text-zinc-600 dark:text-zinc-400">
            {dayLabel(crawl.dayPart)} crawl {crawl.crawlNumber}
          </span>
        </div>
      </td>
      <td className="px-3 py-1.5 text-right">
        <span className="font-mono text-[11px] text-zinc-500 tabular-nums">
          {formatMoney(crawl.salesCents)}
        </span>
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
      <td className="px-3 py-1.5" colSpan={2}>
        {crawl.ticketsSold > 0 && (
          <span className="font-mono text-[10px] text-zinc-500 tabular-nums">
            {crawl.ticketsSold} tickets sold
          </span>
        )}
      </td>
    </tr>
  );
}

function formatMoney(cents: number): string {
  if (!cents) return "—";
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
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
