"use client";

import { Button } from "@/components/ui/button";
import type { AllCrawlsRow } from "@/lib/all-crawls-data";
import { cn } from "@/lib/cn";
import { Calendar, ChevronDown, Loader2, RefreshCw, Search, Send, Unlink } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  bulkPushEventbriteDescriptions,
  bulkSyncEventbriteSales,
  bulkUnlinkEventbrite,
} from "../_actions";
import { EventbriteCell } from "./eventbrite-cell";

interface Props {
  campaignId: string;
  rows: AllCrawlsRow[];
}

const DAY_LABEL: Record<string, string> = {
  thursday_night: "Thu",
  friday_night: "Fri",
  saturday_day: "Sat·D",
  saturday_night: "Sat",
  sunday_day: "Sun·D",
  sunday_night: "Sun",
  other: "Other",
};

type SortKey = "city" | "day" | "tickets" | "open";
type SortDir = "asc" | "desc";
type FilterKey = "all" | "needs_venues" | "ready" | "linked" | "unlinked";

const FILTER_LABELS: Record<FilterKey, string> = {
  all: "All",
  needs_venues: "Needs venues",
  ready: "Ready",
  linked: "Linked to EB",
  unlinked: "Not linked",
};

function matchesFilter(row: AllCrawlsRow, filter: FilterKey): boolean {
  switch (filter) {
    case "all":
      return true;
    case "needs_venues":
      return row.openSlots > 0 && row.cityCampaignStatus !== "cancelled";
    case "ready":
      return row.openSlots === 0 && row.totalSlots > 0;
    case "linked":
      return !!row.eventbriteEventId;
    case "unlinked":
      return !row.eventbriteEventId;
  }
}

/**
 * All Crawls flat view — one row per event across every city in the
 * campaign. Each crawl shows city/day/crawl #/tickets/slot counts/
 * status + an inline Eventbrite linkage cell.
 *
 * Operator workflows:
 *   • Search by city name (top-left input, debounced via React state)
 *   • Sort by city / day / tickets / open slots (click column headers)
 *   • Click the city name → drills into the city sheet
 *   • Inline Eventbrite linkage — paste an EB ID, smart-check the
 *     city matches, sync sales, push venue route to EB description
 *
 * Status column uses the same pill palette as the dashboard tracker
 * (Outreach / Need 1 / Need 2 / Need 3+ / Ready / Cancelled) so the
 * operator's mental model stays consistent across surfaces.
 */
export function AllCrawlsTable({ campaignId, rows }: Props) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sortKey, setSortKey] = useState<SortKey>("city");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  // Precompute counts for filter chips so they show live totals
  const filterCounts = useMemo(() => {
    const counts: Record<FilterKey, number> = {
      all: rows.length,
      needs_venues: 0,
      ready: 0,
      linked: 0,
      unlinked: 0,
    };
    for (const r of rows) {
      if (matchesFilter(r, "needs_venues")) counts.needs_venues++;
      if (matchesFilter(r, "ready")) counts.ready++;
      if (matchesFilter(r, "linked")) counts.linked++;
      if (matchesFilter(r, "unlinked")) counts.unlinked++;
    }
    return counts;
  }, [rows]);

  const filtered = useMemo(() => {
    let result = rows.filter((r) => matchesFilter(r, filter));
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (r) =>
          r.cityName.toLowerCase().includes(q) ||
          (r.cityRegion?.toLowerCase().includes(q) ?? false) ||
          (r.eventbriteEventId?.toLowerCase().includes(q) ?? false),
      );
    }
    const sorted = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "city") cmp = a.cityName.localeCompare(b.cityName);
      else if (sortKey === "day")
        cmp = a.dayPart.localeCompare(b.dayPart) || (a.crawlNumber ?? 0) - (b.crawlNumber ?? 0);
      else if (sortKey === "tickets") cmp = a.ticketsSold - b.ticketsSold;
      else if (sortKey === "open") cmp = a.openSlots - b.openSlots;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [rows, search, filter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function toggleAll() {
    if (selected.size === filtered.length && filtered.length > 0) {
      clearSelection();
    } else {
      setSelected(new Set(filtered.map((r) => r.eventId)));
    }
  }

  const allSelected = filtered.length > 0 && selected.size === filtered.length;
  const someSelected = selected.size > 0 && selected.size < filtered.length;

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-sm shadow-zinc-200/40 dark:border-zinc-800/60 dark:bg-zinc-950/60 dark:shadow-none">
      <header className="flex flex-col gap-3 border-zinc-200/60 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800/40">
        <div>
          <h2 className="font-semibold text-lg tracking-tight">All crawls</h2>
          <p className="mt-0.5 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
            {rows.length} crawl{rows.length === 1 ? "" : "s"} across{" "}
            {new Set(rows.map((r) => r.cityId)).size} cit
            {new Set(rows.map((r) => r.cityId)).size === 1 ? "y" : "ies"}
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 text-zinc-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search city, region, EB ID…"
            className="h-8 w-full rounded-md border border-zinc-200 bg-white pr-2 pl-7 text-xs transition-colors focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900"
          />
        </div>
      </header>

      {/* Filter chips — visible only when there's enough data to filter */}
      {rows.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 border-zinc-200/40 border-b px-5 py-2.5 dark:border-zinc-800/30">
          {(Object.keys(FILTER_LABELS) as FilterKey[]).map((key) => {
            const count = filterCounts[key];
            const active = filter === key;
            const disabled = key !== "all" && count === 0;
            return (
              <button
                key={key}
                type="button"
                onClick={() => !disabled && setFilter(key)}
                disabled={disabled}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] transition-all duration-150",
                  active
                    ? "bg-zinc-900 text-zinc-50 shadow-sm dark:bg-zinc-100 dark:text-zinc-900"
                    : disabled
                      ? "cursor-not-allowed text-zinc-400 dark:text-zinc-600"
                      : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900 dark:bg-zinc-800/60 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100",
                )}
              >
                {FILTER_LABELS[key]}
                <span className={cn("tabular-nums", active ? "opacity-90" : "opacity-60")}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="px-5 py-16 text-center">
          <Calendar className="mx-auto h-6 w-6 text-zinc-400" />
          <h3 className="mt-3 font-semibold text-sm tracking-tight">No crawls yet</h3>
          <p className="mt-1 text-xs text-zinc-500">
            Add cities to this campaign and crawl rows will appear here.
          </p>
        </div>
      ) : (
        <>
          {selected.size > 0 && (
            <BulkActionBar
              selectedIds={Array.from(selected)}
              campaignId={campaignId}
              onComplete={clearSelection}
            />
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-zinc-200/60 border-b text-left font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em] dark:border-zinc-800/40">
                  <th className="w-9 px-3 py-2.5">
                    <SelectAllCheckbox
                      checked={allSelected}
                      indeterminate={someSelected}
                      onChange={toggleAll}
                    />
                  </th>
                  <SortHeader
                    label="City"
                    sortKey="city"
                    current={sortKey}
                    dir={sortDir}
                    onClick={() => toggleSort("city")}
                    width="w-44"
                  />
                  <SortHeader
                    label="Day"
                    sortKey="day"
                    current={sortKey}
                    dir={sortDir}
                    onClick={() => toggleSort("day")}
                    width="w-20"
                  />
                  <th className="w-12 px-2 py-2.5">#</th>
                  <th className="w-28 px-2 py-2.5">Date</th>
                  <SortHeader
                    label="Tickets"
                    sortKey="tickets"
                    current={sortKey}
                    dir={sortDir}
                    onClick={() => toggleSort("tickets")}
                    width="w-20"
                  />
                  <SortHeader
                    label="Open"
                    sortKey="open"
                    current={sortKey}
                    dir={sortDir}
                    onClick={() => toggleSort("open")}
                    width="w-16"
                  />
                  <th className="w-24 px-2 py-2.5">Status</th>
                  <th className="w-56 px-2 py-2.5">Eventbrite</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => (
                  <CrawlRow
                    key={row.eventId}
                    row={row}
                    campaignId={campaignId}
                    zebra={i % 2 === 1}
                    selected={selected.has(row.eventId)}
                    onToggleSelect={() => toggleOne(row.eventId)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function SortHeader({
  label,
  sortKey,
  current,
  dir,
  onClick,
  width,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onClick: () => void;
  width: string;
}) {
  const active = current === sortKey;
  return (
    <th className={cn(width, "px-2 py-2.5")}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100",
          active && "text-zinc-900 dark:text-zinc-100",
        )}
      >
        {label}
        {active && (
          <ChevronDown
            className={cn("h-3 w-3 transition-transform", dir === "asc" && "rotate-180")}
          />
        )}
      </button>
    </th>
  );
}

function CrawlRow({
  row,
  campaignId,
  zebra,
  selected,
  onToggleSelect,
}: {
  row: AllCrawlsRow;
  campaignId: string;
  zebra: boolean;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const tone = zebra ? "bg-zinc-50/60 dark:bg-zinc-900/30" : "bg-white dark:bg-zinc-900/10";

  // Status pill mirrors the dashboard tracker
  const statusPill = computeStatusPill(row);
  return (
    <tr
      className={cn(
        tone,
        "border-zinc-200/40 border-b transition-colors duration-150 hover:bg-blue-500/[0.03] dark:border-zinc-800/30",
        selected && "bg-blue-500/[0.05] dark:bg-blue-400/[0.06]",
      )}
    >
      <td className="px-3 py-2 align-middle">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="h-3.5 w-3.5 cursor-pointer rounded border-zinc-300 text-blue-600 transition-colors focus:ring-2 focus:ring-blue-500/30 dark:border-zinc-700"
          aria-label={`Select ${row.cityName} ${row.dayPart} crawl ${row.crawlNumber}`}
        />
      </td>
      <td className="px-3 py-2 align-middle">
        <Link
          href={`/city-campaigns/${row.cityCampaignId}`}
          className="font-medium text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-100"
        >
          {row.cityName}
        </Link>
        {row.cityRegion && (
          <span className="ml-1.5 font-mono text-[10px] text-zinc-500">{row.cityRegion}</span>
        )}
      </td>
      <td className="px-2 py-2 align-middle font-mono text-[11px] text-zinc-700 dark:text-zinc-300">
        {DAY_LABEL[row.dayPart] ?? row.dayPart}
      </td>
      <td className="px-2 py-2 align-middle font-mono text-[11px] tabular-nums">
        {row.crawlNumber}
      </td>
      <td className="px-2 py-2 align-middle font-mono text-[11px] text-zinc-600 tabular-nums dark:text-zinc-400">
        {row.eventDate ?? "—"}
      </td>
      <td className="px-2 py-2 text-right align-middle font-mono text-[11px] tabular-nums">
        {row.ticketsSold > 0 ? (
          <span className="font-semibold text-zinc-900 dark:text-zinc-100">{row.ticketsSold}</span>
        ) : (
          <span className="text-zinc-400">—</span>
        )}
      </td>
      <td className="px-2 py-2 text-right align-middle font-mono text-[11px] tabular-nums">
        {row.openSlots > 0 ? (
          <span
            className={cn(
              row.openSlots >= 3
                ? "text-rose-600 dark:text-rose-400"
                : row.openSlots === 2
                  ? "text-orange-600 dark:text-orange-400"
                  : "text-amber-600 dark:text-amber-400",
            )}
          >
            {row.openSlots}
          </span>
        ) : (
          <span className="text-emerald-600 dark:text-emerald-400">0</span>
        )}
      </td>
      <td className="px-2 py-2 align-middle">
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 font-medium font-mono text-[10px] uppercase tracking-[0.08em] ring-1 ring-inset",
            statusPill.tone,
          )}
        >
          {statusPill.label}
        </span>
      </td>
      <td className="px-2 py-2 align-middle">
        <EventbriteCell
          eventId={row.eventId}
          campaignId={campaignId}
          currentEbId={row.eventbriteEventId}
          currentEbUrl={row.eventbriteUrl}
          ticketsSold={row.ticketsSold}
        />
      </td>
    </tr>
  );
}

function computeStatusPill(row: AllCrawlsRow): { label: string; tone: string } {
  if (row.cityCampaignStatus === "cancelled")
    return {
      label: "Cancelled",
      tone: "bg-zinc-500/10 text-zinc-500 ring-zinc-500/20",
    };
  if (row.openSlots === 0 && row.totalSlots > 0)
    return {
      label: "Ready",
      tone: "bg-emerald-500/15 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300",
    };
  if (row.openSlots >= 3)
    return {
      label: `Need ${row.openSlots}`,
      tone: "bg-rose-500/15 text-rose-700 ring-rose-500/25 dark:text-rose-300",
    };
  if (row.openSlots === 2)
    return {
      label: "Need 2",
      tone: "bg-orange-500/15 text-orange-700 ring-orange-500/25 dark:text-orange-300",
    };
  if (row.openSlots === 1)
    return {
      label: "Need 1",
      tone: "bg-amber-500/15 text-amber-700 ring-amber-500/25 dark:text-amber-300",
    };
  return {
    label: "Outreach",
    tone: "bg-blue-500/10 text-blue-700 ring-blue-500/20 dark:text-blue-300",
  };
}

// =========================================================================
// Bulk action bar — appears below the header when ≥1 row selected.
// Three actions: bulk Eventbrite sync, bulk push descriptions, bulk unlink.
// =========================================================================

function BulkActionBar({
  selectedIds,
  campaignId,
  onComplete,
}: {
  selectedIds: string[];
  campaignId: string;
  onComplete: () => void;
}) {
  const [pendingSync, startSync] = useTransition();
  const [pendingPush, startPush] = useTransition();
  const [pendingUnlink, startUnlink] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  async function runSync() {
    setError(null);
    const fd = new FormData();
    fd.set("campaignId", campaignId);
    fd.set("eventIds", selectedIds.join(","));
    startSync(async () => {
      const result = await bulkSyncEventbriteSales(null, fd);
      if (!result.ok) {
        setError(result.error ?? "Sync failed.");
        return;
      }
      if (result.data && "notConfigured" in result.data) {
        setError("Eventbrite not configured — set EVENTBRITE_PRIVATE_TOKEN on the server.");
        return;
      }
      const { synced, failed, ticketsTotal } = result.data;
      setToast(
        `Synced ${synced} crawl${synced === 1 ? "" : "s"}${failed > 0 ? ` · ${failed} failed` : ""} · ${ticketsTotal} total tickets sold`,
      );
      onComplete();
    });
  }

  async function runPush() {
    setError(null);
    const fd = new FormData();
    fd.set("campaignId", campaignId);
    fd.set("eventIds", selectedIds.join(","));
    startPush(async () => {
      const result = await bulkPushEventbriteDescriptions(null, fd);
      if (!result.ok) {
        setError(result.error ?? "Push failed.");
        return;
      }
      if (result.data && "notConfigured" in result.data) {
        setError("Eventbrite not configured.");
        return;
      }
      const { pushed, failed, skipped } = result.data;
      setToast(
        `Pushed ${pushed} description${pushed === 1 ? "" : "s"}${failed > 0 ? ` · ${failed} failed` : ""}${skipped > 0 ? ` · ${skipped} not linked to EB` : ""}`,
      );
      onComplete();
    });
  }

  async function runUnlink() {
    if (
      !confirm(
        `Clear Eventbrite linkage from ${selectedIds.length} crawl${selectedIds.length === 1 ? "" : "s"}? They'll lose their EB id + URL; the EB events themselves remain untouched.`,
      )
    )
      return;
    setError(null);
    const fd = new FormData();
    fd.set("campaignId", campaignId);
    fd.set("eventIds", selectedIds.join(","));
    startUnlink(async () => {
      const result = await bulkUnlinkEventbrite(null, fd);
      if (!result.ok) {
        setError(result.error ?? "Unlink failed.");
        return;
      }
      setToast(`Unlinked ${result.data.unlinked} crawl${result.data.unlinked === 1 ? "" : "s"}`);
      onComplete();
    });
  }

  const busy = pendingSync || pendingPush || pendingUnlink;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-blue-200/60 border-b bg-blue-50/60 px-5 py-2.5 dark:border-blue-900/40 dark:bg-blue-950/30">
      <div className="flex items-center gap-2">
        <span className="font-medium font-mono text-[11px] text-blue-700 uppercase tracking-[0.08em] dark:text-blue-300">
          {selectedIds.length} selected
        </span>
        <button
          type="button"
          onClick={onComplete}
          className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em] underline-offset-4 hover:text-zinc-900 hover:underline dark:hover:text-zinc-100"
        >
          clear
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={runSync} disabled={busy}>
          {pendingSync ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" /> Syncing…
            </>
          ) : (
            <>
              <RefreshCw className="h-3 w-3" /> Sync EB sales
            </>
          )}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={runPush} disabled={busy}>
          {pendingPush ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" /> Pushing…
            </>
          ) : (
            <>
              <Send className="h-3 w-3" /> Push descriptions
            </>
          )}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={runUnlink}
          disabled={busy}
          className="text-rose-600 hover:bg-rose-500/10 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300"
        >
          {pendingUnlink ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" /> Unlinking…
            </>
          ) : (
            <>
              <Unlink className="h-3 w-3" /> Unlink EB
            </>
          )}
        </Button>
      </div>

      {error && (
        <p className="w-full font-mono text-[10px] text-rose-600 dark:text-rose-400">{error}</p>
      )}
      {toast && !error && (
        <p className="w-full font-mono text-[10px] text-emerald-700 dark:text-emerald-400">
          {toast}
        </p>
      )}
    </div>
  );
}

function SelectAllCheckbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked;
  }, [indeterminate, checked]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      className="h-3.5 w-3.5 cursor-pointer rounded border-zinc-300 text-blue-600 transition-colors focus:ring-2 focus:ring-blue-500/30 dark:border-zinc-700"
      aria-label="Select all crawls"
    />
  );
}
