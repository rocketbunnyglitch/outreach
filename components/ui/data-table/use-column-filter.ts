"use client";

/**
 * useColumnFilter — URL-synced per-column filter state for data tables.
 *
 * URL shape:
 *   ?f.status=lead,interested&f.city=toronto
 *
 * Each column gets its own `f.<column>` param. Multi-value via comma.
 * Text filters use substring match by convention (the consumer applies
 * the filtering — this hook only manages state).
 *
 * Why a separate hook from useColumnSort?
 *   Sort state has one shape ("which column, what direction"). Filter
 *   state has N shapes (per-column predicate config). Bundling them
 *   would make the API muddy. Two hooks, both URL-backed.
 *
 * Example:
 *   const filter = useColumnFilter();
 *   filter.value("status")               // string[] (multi-value)
 *   filter.set("status", ["lead"])       // set values for one column
 *   filter.toggle("status", "lead")      // add or remove a value
 *   filter.clear()                       // clear all column filters
 *   filter.clearColumn("status")         // clear one column's filter
 *   filter.isEmpty                       // true if no filters active
 *   filter.activeColumns                 // list of columns with filters
 *
 * Consumer code applies the filter to its rows:
 *   const visible = rows.filter((r) => {
 *     for (const col of filter.activeColumns) {
 *       const values = filter.value(col);
 *       if (!values.includes(String(r[col]))) return false;
 *     }
 *     return true;
 *   });
 */

import { useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

const PARAM_PREFIX = "f.";
const VALUE_SEP = ",";

export interface UseColumnFilterReturn {
  /** Values for a specific column (multi-value). Empty array = no filter. */
  value: (column: string) => string[];
  /** Whether ANY filter is currently active. */
  isEmpty: boolean;
  /** All columns with at least one filter value. */
  activeColumns: string[];
  /** Replace this column's filter values entirely. Pass [] to clear. */
  set: (column: string, values: string[]) => void;
  /** Toggle a single value on/off for a column (chip-style). */
  toggle: (column: string, value: string) => void;
  /** Clear one column. */
  clearColumn: (column: string) => void;
  /** Clear every filter. */
  clear: () => void;
}

export function useColumnFilter(): UseColumnFilterReturn {
  const params = useSearchParams();
  // IN-MEMORY overlay, authoritative once any filter is touched. The
  // previous version pushed every change through router.replace() -- a full
  // RSC navigation that re-rendered the (often heavy) server page just to
  // filter rows the client ALREADY HAS, making filter bars feel laggy/dead
  // ("super laggy", 2026-06-10). Filtering is now a pure client state
  // update (instant); the URL is kept shareable via history.replaceState,
  // which Next ignores (no server round-trip). Deep links still work: the
  // overlay seeds from the URL params on first write.
  const [overlay, setOverlay] = useState<Record<string, string[]> | null>(null);

  const paramFilters = useMemo<Record<string, string[]>>(() => {
    const out: Record<string, string[]> = {};
    for (const [k, v] of params.entries()) {
      if (k.startsWith(PARAM_PREFIX)) {
        const vals = v.split(VALUE_SEP).filter(Boolean);
        if (vals.length > 0) out[k.slice(PARAM_PREFIX.length)] = vals;
      }
    }
    return out;
  }, [params]);

  const effective = overlay ?? paramFilters;

  const activeColumns = useMemo<string[]>(
    () => Object.keys(effective).filter((c) => (effective[c]?.length ?? 0) > 0),
    [effective],
  );

  const value = useCallback((column: string): string[] => effective[column] ?? [], [effective]);

  /** Mirror the overlay into the address bar WITHOUT a Next navigation. */
  const syncUrl = useCallback((filters: Record<string, string[]>) => {
    if (typeof window === "undefined") return;
    const newParams = new URLSearchParams(window.location.search);
    for (const k of [...newParams.keys()]) {
      if (k.startsWith(PARAM_PREFIX)) newParams.delete(k);
    }
    for (const [col, vals] of Object.entries(filters)) {
      if (vals.length > 0) newParams.set(`${PARAM_PREFIX}${col}`, vals.join(VALUE_SEP));
    }
    const qs = newParams.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, []);

  const writeColumn = useCallback(
    (column: string, values: string[]) => {
      setOverlay((prev) => {
        const next = { ...(prev ?? paramFilters) };
        if (values.length === 0) delete next[column];
        else next[column] = values;
        syncUrl(next);
        return next;
      });
    },
    [paramFilters, syncUrl],
  );

  const set = useCallback(
    (column: string, values: string[]) => {
      writeColumn(column, values);
    },
    [writeColumn],
  );

  const toggle = useCallback(
    (column: string, val: string) => {
      const current = value(column);
      const next = current.includes(val) ? current.filter((v) => v !== val) : [...current, val];
      writeColumn(column, next);
    },
    [value, writeColumn],
  );

  const clearColumn = useCallback(
    (column: string) => {
      writeColumn(column, []);
    },
    [writeColumn],
  );

  const clear = useCallback(() => {
    setOverlay({});
    syncUrl({});
  }, [syncUrl]);

  return {
    value,
    isEmpty: activeColumns.length === 0,
    activeColumns,
    set,
    toggle,
    clearColumn,
    clear,
  };
}

// =========================================================================
// Server-side helper
// =========================================================================

/**
 * Parse filter params from a server-side searchParams object. Returns a
 * map of column → values[].
 */
export function parseFilterParams(
  searchParams: Record<string, string | undefined> | URLSearchParams,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  if (searchParams instanceof URLSearchParams) {
    for (const [k, v] of searchParams.entries()) {
      if (k.startsWith(PARAM_PREFIX) && v) {
        result[k.slice(PARAM_PREFIX.length)] = v.split(VALUE_SEP).filter(Boolean);
      }
    }
  } else {
    for (const [k, v] of Object.entries(searchParams)) {
      if (k.startsWith(PARAM_PREFIX) && v) {
        result[k.slice(PARAM_PREFIX.length)] = v.split(VALUE_SEP).filter(Boolean);
      }
    }
  }
  return result;
}

// =========================================================================
// Client-side filtering helper — apply active filters to a row list
// =========================================================================

/**
 * Default substring-match filter applier. Pass a custom `matchers` map
 * for columns that need typed predicates (date range, number, etc.).
 *
 * Example:
 *   const visible = applyColumnFilters(rows, filter, {
 *     status: (row, vals) => vals.includes(row.status),
 *     city:   (row, vals) => vals.includes(row.cityName),
 *     name:   (row, vals) => vals.some(v => row.name.toLowerCase().includes(v.toLowerCase())),
 *   });
 */
export function applyColumnFilters<T>(
  rows: T[],
  filter: UseColumnFilterReturn,
  matchers: Record<string, (row: T, values: string[]) => boolean>,
): T[] {
  if (filter.isEmpty) return rows;
  return rows.filter((row) => {
    for (const column of filter.activeColumns) {
      const matcher = matchers[column];
      if (!matcher) continue; // column not configured → ignore
      const values = filter.value(column);
      if (!matcher(row, values)) return false;
    }
    return true;
  });
}
