"use client";

/**
 * DataTable — the composable shell.
 *
 * This is intentionally light-weight: it's just <table>, <thead>, <tbody>
 * with sensible defaults for spreadsheet feel — sticky header, zebra rows,
 * tight density, hover highlight. Sorting and filtering are wired via the
 * useColumnSort + useColumnFilter hooks; this component doesn't know about
 * data at all.
 *
 * Why not a "data grid" library (react-table, ag-grid)?
 *   • Bundle size: react-table is fine but ag-grid is huge
 *   • We have very different rendering needs per table (custom cells,
 *     bulk actions, contextual rails). A grid library would fight us
 *   • Our columns are static per-table; no need for dynamic column
 *     definitions
 *
 * Three exports:
 *   • DataTable — the <table> shell with consistent styling
 *   • SortableHeader — a <th> that wires into useColumnSort
 *   • FilterRow — a second <tr> in <thead> for per-column filter inputs
 *
 * Compose them yourself in your table. See cold-outreach-table for the
 * full example once it's migrated.
 */

import { cn } from "@/lib/cn";
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import type { UseColumnFilterReturn } from "./use-column-filter";
import type { UseColumnSortReturn } from "./use-column-sort";

// =========================================================================
// DataTable shell
// =========================================================================

export function DataTable({
  children,
  density = "default",
  className,
}: {
  children: ReactNode;
  /** "compact" = tight rows for high-density tables; "default" = comfortable. */
  density?: "compact" | "default";
  className?: string;
}) {
  return (
    <div className={cn("relative w-full overflow-x-auto", className)}>
      <table
        className={cn(
          "w-full border-collapse text-left text-sm",
          density === "compact" && "[&_td]:py-1.5 [&_th]:py-1.5",
        )}
      >
        {children}
      </table>
    </div>
  );
}

/**
 * Standard table header row. Renders a sticky header by default.
 */
export function DataTableHead({
  children,
  sticky = true,
}: {
  children: ReactNode;
  sticky?: boolean;
}) {
  return (
    <thead
      className={cn(
        "border-zinc-200 border-b bg-zinc-50/95 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/80",
        sticky && "sticky top-0 z-10",
      )}
    >
      {children}
    </thead>
  );
}

export function DataTableBody({ children }: { children: ReactNode }) {
  return (
    <tbody className="[&_tr:hover]:bg-zinc-50/60 dark:[&_tr:hover]:bg-zinc-900/40 [&_tr]:border-zinc-200/60 [&_tr]:border-b dark:[&_tr]:border-zinc-800/40">
      {children}
    </tbody>
  );
}

// =========================================================================
// SortableHeader — clickable column header that toggles sort
// =========================================================================

interface SortableHeaderProps {
  /** Column key used in the sort state (must match between sort + UI). */
  column: string;
  /** Display label. */
  children: ReactNode;
  /** The hook return from useColumnSort. */
  sort: UseColumnSortReturn;
  /** Disable sort interaction (header still renders, no click). */
  disabled?: boolean;
  /** Column width hint as a Tailwind class (w-32, w-48, etc.). */
  width?: string;
  /** Align cell content. Default "left". */
  align?: "left" | "right" | "center";
  /** Visual prominence: "default" or "muted" (smaller, e.g. counter columns). */
  variant?: "default" | "muted";
}

export function SortableHeader({
  column,
  children,
  sort,
  disabled,
  width,
  align = "left",
  variant = "default",
}: SortableHeaderProps) {
  const direction = sort.sortValue(column);
  const isActive = direction !== null;

  const Icon = direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ArrowUpDown;

  return (
    <th
      className={cn(
        "px-3 py-2.5 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]",
        align === "right" && "text-right",
        align === "center" && "text-center",
        variant === "muted" && "text-[9px]",
        width,
      )}
      scope="col"
    >
      {disabled ? (
        <span className={cn(isActive && "text-zinc-700 dark:text-zinc-300")}>{children}</span>
      ) : (
        <button
          type="button"
          onClick={(e) => sort.toggle(column, e.shiftKey)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-sm px-1 py-0.5 transition-colors",
            "hover:bg-zinc-200/60 hover:text-zinc-900 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100",
            isActive && "text-zinc-700 dark:text-zinc-300",
            align === "right" && "flex-row-reverse",
          )}
          title={
            direction === null
              ? "Sort ascending"
              : direction === "asc"
                ? "Sort descending"
                : "Clear sort"
          }
        >
          {children}
          <Icon className={cn("h-3 w-3 shrink-0", !isActive && "opacity-40")} aria-hidden="true" />
        </button>
      )}
    </th>
  );
}

// =========================================================================
// FilterRow — second <tr> in thead with per-column quick-filter inputs
// =========================================================================

interface FilterRowProps {
  /** Children should be <th> cells aligned to the sortable header columns. */
  children: ReactNode;
}

export function FilterRow({ children }: FilterRowProps) {
  return (
    <tr className="border-zinc-200/60 border-b bg-white/60 dark:border-zinc-800/40 dark:bg-zinc-950/40">
      {children}
    </tr>
  );
}

/**
 * Text filter input. Use inside a <th> in a FilterRow.
 * Filters by substring; the consumer applies the actual matching via
 * applyColumnFilters().
 */
export function FilterTextInput({
  column,
  filter,
  placeholder = "Filter…",
  width,
}: {
  column: string;
  filter: UseColumnFilterReturn;
  placeholder?: string;
  width?: string;
}) {
  const urlValue = filter.value(column)[0] ?? "";
  // Locally-controlled draft + debounced URL commit. The previous version
  // bound the input DIRECTLY to the URL param and router.replace()d on every
  // keystroke -- on a heavy page each keystroke kicked a server re-render and
  // the controlled value snapped back to the old param mid-flight, eating
  // keypresses ("the filter bar isn't working", 2026-06-10). Typing now hits
  // local state instantly; the URL (and the actual filtering) follows 300ms
  // after the operator pauses.
  const [draft, setDraft] = useState(urlValue);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCommittedRef = useRef(urlValue);
  // Sync back/forward navigation and external clears into the box -- but
  // ONLY genuinely external changes. Our own commit echoing back through the
  // URL must not clobber keystrokes typed during the round-trip.
  useEffect(() => {
    if (urlValue !== lastCommittedRef.current) {
      lastCommittedRef.current = urlValue;
      setDraft(urlValue);
    }
  }, [urlValue]);
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);
  return (
    <th className={cn("px-2 py-1.5", width)}>
      <div className="relative">
        <Search
          className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-1.5 h-3 w-3 text-zinc-400"
          aria-hidden="true"
        />
        <input
          type="text"
          value={draft}
          onChange={(e) => {
            const v = e.target.value;
            setDraft(v);
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => {
              lastCommittedRef.current = v;
              filter.set(column, v ? [v] : []);
            }, 300);
          }}
          placeholder={placeholder}
          className={cn(
            "w-full rounded-sm border border-zinc-200 bg-white py-0.5 pr-1.5 pl-5 font-normal text-xs",
            "placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30",
            "dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100",
          )}
        />
      </div>
    </th>
  );
}

/**
 * Multi-value chip filter. For enum columns: shows the active values as
 * removable chips; clicking the column header opens a select dialog
 * (lightweight version below).
 */
export function FilterChipSet({
  column,
  filter,
  options,
  width,
}: {
  column: string;
  filter: UseColumnFilterReturn;
  options: Array<{ value: string; label: string }>;
  width?: string;
}) {
  const active = filter.value(column);
  return (
    <th className={cn("px-2 py-1.5", width)}>
      <select
        value=""
        onChange={(e) => {
          if (e.target.value) filter.toggle(column, e.target.value);
        }}
        className={cn(
          "w-full appearance-none rounded-sm border border-zinc-200 bg-white px-1.5 py-0.5 font-normal text-xs",
          "focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30",
          "dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100",
        )}
      >
        <option value="">{active.length === 0 ? "All" : `${active.length} active`}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {active.includes(o.value) ? "✓ " : ""}
            {o.label}
          </option>
        ))}
      </select>
    </th>
  );
}

/**
 * Empty cell for non-filterable columns in the FilterRow (e.g. action buttons,
 * checkbox column). Keeps alignment.
 */
export function FilterCellEmpty({ width }: { width?: string }) {
  return <th className={cn("px-2 py-1.5", width)} />;
}
