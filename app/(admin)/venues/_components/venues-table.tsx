"use client";

/**
 * VenuesTable — replaces VenuesListClient's card grouping with a single
 * sortable, filterable, inline-editable table.
 *
 * What changed vs the old client:
 *   • Cards → table rows. City moves from a section header to a column
 *     (sortable like everything else).
 *   • Inline edit on Name, Capacity, DNC checkbox. Drilling into the
 *     detail page only needed for richer fields (address, coordinates,
 *     internal notes).
 *   • Sort + filter on every column via URL params (?sort=name:asc,
 *     ?f.city=toronto). Shareable, deep-linkable.
 *   • Bulk select preserved — checkbox column on the left, action bar at
 *     the top once anything's checked.
 *   • Filtered count + "x of y" indicator near the action bar.
 *
 * What stayed:
 *   • Mark/unmark DNC, archive, queue bulk send — exactly as before.
 *   • Optimistic locking via the existing audit log on venues.
 */

import { SavedViewsPicker } from "@/app/(admin)/_components/saved-views-picker";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  DataTableBody,
  DataTableHead,
  FilterCellEmpty,
  FilterChipSet,
  FilterRow,
  FilterTextInput,
  LiveCursorsLayer,
  PresenceAvatarStack,
  SortableHeader,
  applyColumnFilters,
  colorForStaff,
  formatRealtimeAgo,
  useColumnFilter,
  useColumnSort,
  useLiveCursors,
  usePresenceHeartbeat,
  useRealtimeChannel,
} from "@/components/ui/data-table";
import { useGridArrowNav } from "@/components/ui/data-table/use-grid-arrow-nav";
import { InlineCell } from "@/components/ui/inline-cell";
import { cn } from "@/lib/cn";
import { AlertTriangle, Archive, Loader2, Shield, ShieldOff, Sparkles, Wifi } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { bulkUpdateVenues } from "../_actions";
import {
  bulkBackfillVenuesFromGoogle,
  commitVenueListField,
  createVenueFromRow,
} from "../_actions";

interface VenueRow {
  id: string;
  name: string;
  cityName: string;
  address: string | null;
  capacity: number | null;
  doNotContact: boolean;
}

interface Props {
  rows: VenueRow[];
  bulkAction: typeof bulkUpdateVenues;
  /** Distinct city names for the filter dropdown (display + filter value). */
  cityOptions: Array<{ value: string; label: string }>;
  /**
   * Full list of cities with both id and name — used by the "+ Add row"
   * affordance, which needs cityId to insert a new venue. Separate from
   * cityOptions because the filter is name-based for display, but the
   * insert needs the UUID.
   */
  addRowCities: Array<{ id: string; name: string }>;
  /** Used by the realtime hook to suppress self-originated events. */
  currentStaffId: string;
}

export function VenuesTable({
  rows,
  bulkAction,
  cityOptions,
  addRowCities,
  currentStaffId,
}: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  // -----------------------------------------------------------------
  // Realtime: refresh the page when another operator changes a venue.
  // Self-events are filtered by currentStaffId so we don't refresh on
  // our own optimistic update.
  //
  // Additionally, track recently-edited row ids in a Map of rowId →
  // {expiresAt, byStaffName, color} so we can briefly highlight the row
  // after a teammate's change. The highlight auto-clears after ~3s.
  // -----------------------------------------------------------------
  const [recentEdits, setRecentEdits] = useState<
    Map<
      string,
      { expiresAt: number; byStaffName: string | null; color: ReturnType<typeof colorForStaff> }
    >
  >(() => new Map());
  const realtime = useRealtimeChannel({
    channel: "realtime:venues",
    currentStaffId,
    onEvent: (event) => {
      router.refresh();
      if (event.id && event.byStaffId) {
        setRecentEdits((prev) => {
          const next = new Map(prev);
          next.set(event.id ?? "", {
            expiresAt: Date.now() + 3000,
            byStaffName: event.byStaffName ?? null,
            color: colorForStaff(event.byStaffId ?? ""),
          });
          return next;
        });
      }
    },
  });

  // Clean up expired highlights periodically
  useEffect(() => {
    if (recentEdits.size === 0) return;
    const id = setInterval(() => {
      setRecentEdits((prev) => {
        const now = Date.now();
        let mutated = false;
        const next = new Map(prev);
        for (const [k, v] of next) {
          if (v.expiresAt < now) {
            next.delete(k);
            mutated = true;
          }
        }
        return mutated ? next : prev;
      });
    }, 500);
    return () => clearInterval(id);
  }, [recentEdits.size]);

  // -----------------------------------------------------------------
  // Presence: who else is viewing this page? Shows an avatar stack in
  // the header strip. The meeting-room feature.
  // Local focus state — passed to the heartbeat so peers see what cell
  // we're editing.
  // -----------------------------------------------------------------
  const [myFocusedCell, setMyFocusedCell] = useState<string | null>(null);
  // Row the user is currently hovering. Debounced so we don't write to
  // Redis on every mousemove. 250ms is enough for "they actually stopped
  // on this row" without feeling laggy when scrolling.
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);
  const [debouncedRowId, setDebouncedRowId] = useState<string | null>(null);
  useEffect(() => {
    if (hoveredRowId === debouncedRowId) return;
    const t = setTimeout(() => setDebouncedRowId(hoveredRowId), 250);
    return () => clearTimeout(t);
  }, [hoveredRowId, debouncedRowId]);

  const presence = usePresenceHeartbeat({
    route: "/venues",
    currentStaffId,
    focusedCellId: myFocusedCell ?? undefined,
    focusedRowId: debouncedRowId ?? undefined,
  });

  // -----------------------------------------------------------------
  // Phase 15: live cursors. Renders a small colored arrow + name label
  // wherever a peer's mouse is. Same per-staff color palette as the
  // avatar stack, per-cell focus indicators, and per-row dots.
  //
  // showCursors is per-session; some operators find cursor motion
  // distracting. Toggle is exposed via a small button in the header
  // strip. No persistence in v1 — refresh resets to 'on'.
  // -----------------------------------------------------------------
  const [showCursors, setShowCursors] = useState(true);
  const { cursors } = useLiveCursors({
    route: "/venues",
    currentStaffId,
    enabled: showCursors,
  });

  // Build a lookup of cellId → peer info, so each InlineCell can render
  // a colored ring + corner pill when a teammate is editing it.
  const peerFocusByCell = useMemo(() => {
    const map = new Map<string, { displayName: string; color: ReturnType<typeof colorForStaff> }>();
    for (const v of presence.others) {
      if (!v.focusedCellId) continue;
      map.set(v.focusedCellId, {
        displayName: v.displayName,
        color: colorForStaff(v.staffId),
      });
    }
    return map;
  }, [presence.others]);

  // Phase 13: lookup of rowId → peer[] for the per-row mini avatars on
  // the right edge of each row. A row can have multiple peers near it
  // (one hovering while another is editing a cell), so values are arrays.
  // We also fold focusedCellId → rowId here so 'editing a cell' implies
  // 'present on the row' for free.
  const peersByRow = useMemo(() => {
    const map = new Map<
      string,
      Array<{ staffId: string; displayName: string; color: ReturnType<typeof colorForStaff> }>
    >();
    for (const v of presence.others) {
      const rowId =
        v.focusedRowId ?? (v.focusedCellId ? extractRowIdFromCellId(v.focusedCellId) : undefined);
      if (!rowId) continue;
      const entry = {
        staffId: v.staffId,
        displayName: v.displayName,
        color: colorForStaff(v.staffId),
      };
      const list = map.get(rowId);
      if (list && !list.some((p) => p.staffId === v.staffId)) list.push(entry);
      else if (!list) map.set(rowId, [entry]);
    }
    return map;
  }, [presence.others]);

  // -----------------------------------------------------------------
  // Sort + filter state (URL-synced via the data-table hooks)
  // -----------------------------------------------------------------
  const sort = useColumnSort({
    defaultSort: [
      { column: "cityName", direction: "asc" },
      { column: "name", direction: "asc" },
    ],
  });
  const filter = useColumnFilter();

  // -----------------------------------------------------------------
  // Derived: filtered + sorted rows
  // -----------------------------------------------------------------
  const visibleRows = useMemo(() => {
    // Filter
    const filtered = applyColumnFilters(rows, filter, {
      name: (row, vals) => {
        const q = vals[0]?.toLowerCase() ?? "";
        return row.name.toLowerCase().includes(q);
      },
      cityName: (row, vals) => vals.includes(row.cityName),
      address: (row, vals) => {
        const q = vals[0]?.toLowerCase() ?? "";
        return (row.address ?? "").toLowerCase().includes(q);
      },
      doNotContact: (row, vals) => {
        // values are "true" / "false" strings
        return vals.includes(String(row.doNotContact));
      },
    });

    // Sort
    if (sort.state.length === 0) return filtered;
    return [...filtered].sort((a, b) => {
      for (const { column, direction } of sort.state) {
        const sign = direction === "asc" ? 1 : -1;
        const av = sortKeyFor(a, column);
        const bv = sortKeyFor(b, column);
        if (av < bv) return -1 * sign;
        if (av > bv) return 1 * sign;
      }
      return 0;
    });
  }, [rows, filter, sort.state]);

  // -----------------------------------------------------------------
  // Pagination (render-bounding). The filter + sort above still run over
  // the FULL set so search/sort see every venue; we only ever render one
  // page worth of <tr> at a time. Without this the table painted every
  // matching row at once -- fine for a few hundred venues, janky once a
  // multi-city campaign pushes the list into the thousands.
  // -----------------------------------------------------------------
  const PAGE_SIZE = 100;
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  // Clamp so a shrinking filtered set can never strand us on an empty page.
  const safePage = Math.min(page, pageCount - 1);
  const pagedRows = useMemo(
    () => visibleRows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [visibleRows, safePage],
  );

  const selectedCount = selected.size;
  // Select-all + select-state are scoped to the CURRENT page (bounded set).
  const visibleIds = pagedRows.map((r) => r.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someVisibleSelected = !allVisibleSelected && visibleIds.some((id) => selected.has(id));

  // -----------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------
  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allVisibleSelected || someVisibleSelected) {
      // Some/all selected → clear those
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of visibleIds) next.delete(id);
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of visibleIds) next.add(id);
        return next;
      });
    }
  }

  function clearSelection() {
    setSelected(new Set());
  }

  function applyBulk(operation: "mark_dnc" | "unmark_dnc" | "archive") {
    if (operation === "mark_dnc" && !reason.trim()) {
      setReasonOpen(true);
      return;
    }
    setFeedback(null);
    startTransition(async () => {
      const result = await bulkAction(
        Array.from(selected),
        operation,
        operation === "mark_dnc" ? reason : undefined,
      );
      if (!result.ok) {
        setFeedback(`Failed: ${result.error}`);
        return;
      }
      setFeedback(
        operation === "archive"
          ? `Archived ${result.data.count} venues.`
          : operation === "mark_dnc"
            ? `Marked ${result.data.count} as DNC.`
            : `Unmarked ${result.data.count} from DNC.`,
      );
      setSelected(new Set());
      setReason("");
      setReasonOpen(false);
    });
  }

  // Bulk backfill venues from Google Places. Calls the action with the
  // selection, then renders a per-result summary so the operator sees what
  // actually changed (e.g. "Filled 7 venues. 2 had no Google match.").
  function applyBackfill() {
    setFeedback(null);
    startTransition(async () => {
      const result = await bulkBackfillVenuesFromGoogle({ venueIds: Array.from(selected) });
      const parts: string[] = [];
      if (result.updatedCount > 0) parts.push(`Filled ${result.updatedCount}`);
      if (result.skippedCount > 0) parts.push(`${result.skippedCount} already complete`);
      if (result.errorCount > 0) parts.push(`${result.errorCount} no match / error`);
      setFeedback(parts.join(" · ") || "Nothing to update.");
      setSelected(new Set());
    });
  }

  // -----------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------
  // Arrow-key cell-to-cell nav (Sheets-style). The hook attaches a
  // keydown listener to gridNavRef.current and moves focus between
  // any InlineCell with `data-grid-cell` set. No effect on cells
  // without grid coords — opt-in per cell.
  const gridNavRef = useRef<HTMLDivElement>(null);
  useGridArrowNav(gridNavRef);

  return (
    <div ref={gridNavRef} className="flex flex-col gap-4">
      {/* Live cursors overlay — fixed-positioned, pointer-events:none.
          Renders other peers' mouse positions as colored arrows + labels. */}
      <LiveCursorsLayer cursors={cursors} />

      {/* Bulk action bar — appears when anything is selected */}
      {selectedCount > 0 && (
        <div className="-mx-2 sticky top-14 z-30 flex flex-col gap-3 border-zinc-200 border-b bg-[color:var(--color-canvas)]/95 px-2 py-3 backdrop-blur-md dark:border-zinc-800 dark:bg-[color:var(--color-canvas-dark)]/95">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-sm">
              <span className="font-medium font-mono">{selectedCount} selected</span>
              <button
                type="button"
                onClick={clearSelection}
                className="text-xs text-zinc-500 underline hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                Clear
              </button>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={applyBackfill}
                disabled={isPending}
                title="Use Google to fill missing address, phone, website, location, and Google Place ID"
              >
                <Sparkles className="h-3 w-3" /> Backfill from Google
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => applyBulk("mark_dnc")}
                disabled={isPending}
              >
                <ShieldOff className="h-3 w-3" /> Mark DNC
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => applyBulk("unmark_dnc")}
                disabled={isPending}
              >
                <Shield className="h-3 w-3" /> Unmark DNC
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => applyBulk("archive")}
                disabled={isPending}
              >
                <Archive className="h-3 w-3" /> Archive
              </Button>
            </div>
          </div>
          {/* DNC reason input — only when prompted */}
          {reasonOpen && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 dark:border-rose-900 dark:bg-rose-950">
              <p className="text-rose-800 text-xs dark:text-rose-300">
                Reason for DNC (required, will be saved on each venue):
              </p>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. owner asked to stop contacting"
                className="flex-1 rounded-md border border-rose-300 bg-white px-2 py-1 text-xs dark:border-rose-700 dark:bg-zinc-900"
              />
              <Button
                size="sm"
                variant="default"
                disabled={!reason.trim() || isPending}
                onClick={() => applyBulk("mark_dnc")}
              >
                {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Mark DNC"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={isPending}
                onClick={() => {
                  setReasonOpen(false);
                  setReason("");
                }}
              >
                Cancel
              </Button>
            </div>
          )}
          {feedback && (
            <div
              className={cn(
                "text-xs",
                feedback.startsWith("Failed")
                  ? "text-rose-700 dark:text-rose-400"
                  : "text-emerald-700 dark:text-emerald-400",
              )}
            >
              {feedback}
            </div>
          )}
        </div>
      )}

      {/* Result summary strip */}
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-center gap-3">
          <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
            {visibleRows.length}
            {visibleRows.length !== rows.length && ` of ${rows.length}`} venues
            {filter.activeColumns.length > 0 && (
              <>
                {" "}
                ·{" "}
                <button
                  type="button"
                  onClick={filter.clear}
                  className="underline-offset-2 hover:underline"
                >
                  clear filters
                </button>
              </>
            )}
          </p>
          {pageCount > 1 && (
            <span className="flex items-center gap-1 font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
              <button
                type="button"
                disabled={safePage === 0}
                onClick={() => setPage(safePage - 1)}
                className="rounded border border-zinc-300 px-1.5 py-0.5 disabled:opacity-40 dark:border-zinc-700"
              >
                Prev
              </button>
              <span>
                {safePage + 1}/{pageCount}
              </span>
              <button
                type="button"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage(safePage + 1)}
                className="rounded border border-zinc-300 px-1.5 py-0.5 disabled:opacity-40 dark:border-zinc-700"
              >
                Next
              </button>
            </span>
          )}
          {/* Saved views: ?sort=... + ?f.* params get bundled into named views */}
          <SavedViewsPicker
            surface="venues"
            contextId={null}
            filterKeys={["sort", "f.name", "f.cityName", "f.address", "f.doNotContact"]}
            pathname="/venues"
          />
        </div>
        {/* Realtime indicator + last-edit chip + presence avatars */}
        <div className="flex items-center gap-3">
          <PresenceAvatarStack people={presence.others} />
          {realtime.lastEvent && (
            <span
              className="font-mono text-[10px] text-zinc-500 dark:text-zinc-400"
              title={`last update from another operator at ${realtime.lastEvent.at}`}
            >
              {realtime.lastEvent.byStaffName ?? "Someone"} edited{" "}
              {formatRealtimeAgo(realtime.lastEvent.at)}
            </span>
          )}
          <span
            className={cn(
              "inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.1em]",
              realtime.connected
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-zinc-400 dark:text-zinc-600",
            )}
            title={
              realtime.connected
                ? "Live — changes from teammates appear automatically"
                : "Realtime disconnected"
            }
          >
            <Wifi className="h-2.5 w-2.5" />
            {realtime.connected ? "live" : "offline"}
          </span>
          {/* Cursor opt-out for operators who find peer cursors
              distracting. Per-session; refresh resets. */}
          <button
            type="button"
            onClick={() => setShowCursors((v) => !v)}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] transition-colors",
              showCursors
                ? "text-zinc-500 hover:bg-zinc-200/60 hover:text-zinc-900 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100"
                : "bg-zinc-200 text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700",
            )}
            title={showCursors ? "Hide peer cursors (this session)" : "Show peer cursors"}
          >
            {showCursors ? "cursors on" : "cursors off"}
          </button>
        </div>
      </div>

      {/* The table */}
      <DataTable density="compact">
        <DataTableHead>
          <tr className="border-zinc-200 border-b dark:border-zinc-800">
            <th className="w-9 px-3 py-2.5">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someVisibleSelected;
                }}
                onChange={toggleAll}
                aria-label="Select all visible venues"
                className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-700"
              />
            </th>
            <SortableHeader column="name" sort={sort}>
              Venue
            </SortableHeader>
            <SortableHeader column="cityName" sort={sort} width="w-40">
              City
            </SortableHeader>
            <SortableHeader column="address" sort={sort}>
              Address
            </SortableHeader>
            <SortableHeader column="capacity" sort={sort} width="w-24" align="right">
              Capacity
            </SortableHeader>
            <SortableHeader column="doNotContact" sort={sort} width="w-20" align="center">
              DNC
            </SortableHeader>
          </tr>
          <FilterRow>
            <FilterCellEmpty width="w-9" />
            <FilterTextInput column="name" filter={filter} placeholder="Filter name…" />
            <FilterChipSet column="cityName" filter={filter} options={cityOptions} width="w-40" />
            <FilterTextInput column="address" filter={filter} placeholder="Filter address…" />
            <FilterCellEmpty width="w-24" />
            <FilterChipSet
              column="doNotContact"
              filter={filter}
              options={[
                { value: "true", label: "Yes" },
                { value: "false", label: "No" },
              ]}
              width="w-20"
            />
          </FilterRow>
        </DataTableHead>

        <DataTableBody>
          {pagedRows.map((venue, rowIndex) => (
            <VenueTableRow
              key={venue.id}
              venue={venue}
              rowIndex={rowIndex}
              selected={selected.has(venue.id)}
              onToggle={() => toggle(venue.id)}
              peerFocusByCell={peerFocusByCell}
              onCellFocusChange={setMyFocusedCell}
              rowPeers={peersByRow.get(`venue:${venue.id}`) ?? []}
              onMouseEnter={() => setHoveredRowId(`venue:${venue.id}`)}
              onMouseLeave={() => setHoveredRowId(null)}
              recentEdit={recentEdits.get(venue.id) ?? null}
            />
          ))}
          <AddVenueRow cities={addRowCities} />
        </DataTableBody>
      </DataTable>

      {visibleRows.length === 0 && (
        <div className="rounded-md border border-zinc-200 border-dashed p-8 text-center text-sm text-zinc-500 dark:border-zinc-800">
          {rows.length === 0 ? "No venues yet." : "No venues match the current filters."}
        </div>
      )}
    </div>
  );
}

// =========================================================================
// Row
// =========================================================================

function VenueTableRow({
  venue,
  rowIndex,
  selected,
  onToggle,
  peerFocusByCell,
  onCellFocusChange,
  rowPeers,
  onMouseEnter,
  onMouseLeave,
  recentEdit,
}: {
  venue: VenueRow;
  /** 0-indexed row position; powers arrow-key cell-to-cell nav via
      the data-grid-cell attribute on each inline cell's button. */
  rowIndex: number;
  selected: boolean;
  onToggle: () => void;
  peerFocusByCell: Map<string, { displayName: string; color: ReturnType<typeof colorForStaff> }>;
  onCellFocusChange: (cellId: string | null) => void;
  /** Peers currently focused on this row (hover or editing a cell here). */
  rowPeers: Array<{
    staffId: string;
    displayName: string;
    color: ReturnType<typeof colorForStaff>;
  }>;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  /** Highlight info if this row was recently edited by a teammate. */
  recentEdit: {
    expiresAt: number;
    byStaffName: string | null;
    color: ReturnType<typeof colorForStaff>;
  } | null;
}) {
  const nameCellId = `venue:${venue.id}:name`;
  const addressCellId = `venue:${venue.id}:address`;
  const capacityCellId = `venue:${venue.id}:capacity`;
  return (
    <tr
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(
        "group/row relative transition-colors duration-700",
        selected && "bg-blue-50/50 dark:bg-blue-950/20",
        // Brief background flash when a teammate just changed this row.
        // The recentEdit prop is provided for ~3s then cleared by the parent's
        // expiry timer; the transition-colors above smooths the fade-out.
        recentEdit && "bg-rose-50/60 dark:bg-rose-950/30",
      )}
    >
      <td className="w-9 px-3 py-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          onClick={(e) => e.stopPropagation()}
          className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-700"
          aria-label={`Select ${venue.name}`}
        />
      </td>

      {/* Name — inline-editable, also links to detail page via icon */}
      <td className="px-2 py-2">
        <div className="flex items-center gap-2">
          <InlineCell
            cellId={nameCellId}
            gridRow={rowIndex}
            gridCol={0}
            onFocusChange={onCellFocusChange}
            peerFocus={peerFocusByCell.get(nameCellId) ?? null}
            value={venue.name}
            placeholder="(unnamed)"
            label="Venue name"
            onCommit={async (next) => {
              const fd = new FormData();
              fd.set("venueId", venue.id);
              fd.set("field", "name");
              fd.set("value", next);
              const result = await commitVenueListField(null, fd);
              return result.ok ? { ok: true } : { ok: false, error: result.error };
            }}
          />
          <Link
            href={`/venues/${venue.id}`}
            className="shrink-0 font-mono text-[10px] text-zinc-400 opacity-0 transition-opacity hover:text-zinc-700 group-hover/row:opacity-100 dark:hover:text-zinc-300"
            title="Open venue detail"
          >
            ↗
          </Link>
        </div>
      </td>

      {/* City — not editable from here (would require cityId join with all cities) */}
      <td className="w-40 px-2 py-2 text-xs text-zinc-600 dark:text-zinc-400">{venue.cityName}</td>

      {/* Address — inline-editable. Editing here does NOT re-geocode
          coordinates; that still happens on the detail page's address
          autocomplete. Empty input clears the address. */}
      <td className="px-2 py-2 text-xs text-zinc-600 dark:text-zinc-400">
        <InlineCell
          cellId={addressCellId}
          gridRow={rowIndex}
          gridCol={1}
          onFocusChange={onCellFocusChange}
          peerFocus={peerFocusByCell.get(addressCellId) ?? null}
          value={venue.address ?? ""}
          placeholder="—"
          label="Address"
          onCommit={async (next) => {
            const fd = new FormData();
            fd.set("venueId", venue.id);
            fd.set("field", "address");
            fd.set("value", next);
            const result = await commitVenueListField(null, fd);
            return result.ok ? { ok: true } : { ok: false, error: result.error };
          }}
        />
      </td>

      {/* Capacity — inline-editable number */}
      <td className="w-24 px-2 py-2 text-right">
        <InlineCell
          cellId={capacityCellId}
          gridRow={rowIndex}
          gridCol={2}
          onFocusChange={onCellFocusChange}
          peerFocus={peerFocusByCell.get(capacityCellId) ?? null}
          value={venue.capacity == null ? "" : String(venue.capacity)}
          placeholder="—"
          label="Capacity"
          variant="mono"
          inputType="text"
          validate={(next) => {
            if (next.trim() === "") return null;
            const n = Number.parseInt(next.trim(), 10);
            if (!Number.isFinite(n) || n < 0) return "Must be a non-negative number.";
            if (n > 1_000_000) return "Too large.";
            return null;
          }}
          onCommit={async (next) => {
            const fd = new FormData();
            fd.set("venueId", venue.id);
            fd.set("field", "capacity");
            fd.set("value", next);
            const result = await commitVenueListField(null, fd);
            return result.ok ? { ok: true } : { ok: false, error: result.error };
          }}
        />
      </td>

      {/* DNC toggle + per-row peer dots (Phase 13) */}
      <td className="relative w-20 px-2 py-2 text-center">
        <DncToggle venue={venue} />
        {rowPeers.length > 0 && (
          <div
            className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-0 flex items-center gap-0.5"
            aria-hidden="true"
          >
            {rowPeers.slice(0, 3).map((p) => (
              <span
                key={p.staffId}
                className={cn(
                  "h-1.5 w-1.5 rounded-full border border-white dark:border-zinc-900",
                  p.color.bg,
                )}
                title={`${p.displayName} is on this row`}
              />
            ))}
            {rowPeers.length > 3 && (
              <span
                className="font-mono text-[8px] text-zinc-400"
                title={`+${rowPeers.length - 3} more`}
              >
                +{rowPeers.length - 3}
              </span>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

function DncToggle({ venue }: { venue: VenueRow }) {
  const [pending, startTx] = useTransition();
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const current = optimistic ?? venue.doNotContact;

  function flip() {
    const next = !current;
    setOptimistic(next);
    startTx(async () => {
      const fd = new FormData();
      fd.set("venueId", venue.id);
      fd.set("field", "doNotContact");
      fd.set("value", String(next));
      const result = await commitVenueListField(null, fd);
      if (!result.ok) {
        setOptimistic(null);
      }
      // On success leave optimistic until the server-driven re-render
      // arrives via revalidatePath.
    });
  }

  return (
    <button
      type="button"
      onClick={flip}
      disabled={pending}
      aria-label={current ? "Unmark DNC" : "Mark as do-not-contact"}
      className={cn(
        "inline-flex h-5 w-5 items-center justify-center rounded-md transition-colors",
        current
          ? "bg-rose-100 text-rose-700 hover:bg-rose-200 dark:bg-rose-950 dark:text-rose-400 dark:hover:bg-rose-900"
          : "bg-zinc-100 text-zinc-400 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-800",
        pending && "opacity-60",
      )}
    >
      {current ? <AlertTriangle className="h-3 w-3" /> : null}
    </button>
  );
}

// =========================================================================
// Sort key resolver — maps column id to comparable value
// =========================================================================

function sortKeyFor(row: VenueRow, column: string): string | number {
  switch (column) {
    case "name":
      return row.name.toLowerCase();
    case "cityName":
      return row.cityName.toLowerCase();
    case "address":
      return (row.address ?? "").toLowerCase();
    case "capacity":
      // null sorts to the end regardless of asc/desc — use Infinity for asc,
      // we re-multiply by the direction sign downstream. Simpler: treat null
      // as 0 for now (consistent with how the cards displayed it).
      return row.capacity ?? -1;
    case "doNotContact":
      return row.doNotContact ? 1 : 0;
    default:
      return "";
  }
}

// =========================================================================
// AddVenueRow — Sheets-style "+ Add row" footer row that becomes a new
// venue on Enter. Skips the /venues/new form entirely for the common
// case (just need name + city; everything else can be set inline or on
// the detail page).
// =========================================================================

function AddVenueRow({ cities }: { cities: Array<{ id: string; name: string }> }) {
  const [name, setName] = useState("");
  const [cityId, setCityId] = useState<string>(cities[0]?.id ?? "");
  const [pending, startTx] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function commit() {
    setError(null);
    if (!name.trim()) {
      setError("Enter a venue name first.");
      return;
    }
    if (!cityId) {
      setError("Pick a city first.");
      return;
    }
    startTx(async () => {
      const fd = new FormData();
      fd.set("cityId", cityId);
      fd.set("name", name.trim());
      const result = await createVenueFromRow(null, fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setName("");
      router.refresh();
    });
  }

  return (
    <tr className="group/add border-zinc-200/60 border-t bg-zinc-50/40 dark:border-zinc-800/40 dark:bg-zinc-900/20">
      <td className="w-9 px-3 py-2 text-center font-mono text-[10px] text-zinc-400">+</td>
      <td className="px-2 py-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          placeholder="+ Add a venue…"
          className={cn(
            "w-full rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-sm transition-colors",
            "hover:border-zinc-300 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20",
            "dark:focus:border-blue-400 dark:focus:bg-zinc-900 dark:hover:border-zinc-700",
            "placeholder:text-zinc-400",
          )}
          aria-label="New venue name"
          disabled={pending}
        />
      </td>
      <td className="w-40 px-2 py-2">
        <select
          value={cityId}
          onChange={(e) => setCityId(e.target.value)}
          disabled={pending}
          className={cn(
            "w-full appearance-none rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-xs transition-colors",
            "hover:border-zinc-300 focus:border-blue-500 focus:outline-none",
            "dark:focus:border-blue-400 dark:hover:border-zinc-700",
          )}
          aria-label="New venue city"
        >
          {cities.length === 0 && <option value="">No cities yet</option>}
          {cities.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-2 text-xs text-zinc-400">—</td>
      <td className="w-24 px-2 py-2 text-right text-xs text-zinc-400">—</td>
      <td className="w-20 px-2 py-2 text-center">
        {pending ? (
          <Loader2 className="mx-auto h-3 w-3 animate-spin text-blue-500" />
        ) : (
          <button
            type="button"
            onClick={commit}
            disabled={!name.trim()}
            className="font-mono text-[10px] text-zinc-400 uppercase tracking-[0.08em] transition-colors hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:text-zinc-100"
            title="Press Enter to add"
          >
            add
          </button>
        )}
        {error && (
          <p
            className="mt-1 text-[10px] text-rose-600 dark:text-rose-400"
            role="alert"
            title={error}
          >
            {error.length > 32 ? `${error.slice(0, 32)}…` : error}
          </p>
        )}
      </td>
    </tr>
  );
}

// =========================================================================
// Helpers
// =========================================================================

/**
 * Cell IDs look like 'venue:<uuid>:<field>'. Extract the rowId (the
 * 'venue:<uuid>' prefix) so cell focus also lights up the containing row
 * for Phase 13's per-row peer dots.
 */
function extractRowIdFromCellId(cellId: string): string | undefined {
  const parts = cellId.split(":");
  if (parts.length < 2) return undefined;
  return `${parts[0]}:${parts[1]}`;
}
