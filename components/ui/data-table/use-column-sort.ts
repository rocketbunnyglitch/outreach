"use client";

/**
 * useColumnSort — URL-synced column sort state for data tables.
 *
 * URL shape:
 *   ?sort=column1:asc,column2:desc
 *
 * Single-column is the common case; multi-column is supported via the
 * comma syntax for power users (Sheets-style: shift-click headers).
 *
 * Why URL-sync (not React state)?
 *   • Shareable links: "look at this view, sorted by status"
 *   • Back/forward navigation works
 *   • Survives page refresh
 *   • Server can read it too (for SSR-rendered initial sort, eventually)
 *
 * Why a hook (not a context)?
 *   • Each table is independent; lifting to context would couple them
 *   • The URL is already the source of truth; no need for another layer
 *
 * Example:
 *   const sort = useColumnSort({
 *     defaultSort: [{ column: "lastContactedAt", direction: "desc" }],
 *     paramKey: "sort",
 *   });
 *   sort.state           // current sort array
 *   sort.toggle("name")  // cycle: none → asc → desc → none
 *   sort.set([...])      // replace entirely
 *   sort.clear()         // reset to default
 *   sort.sortValue("name") // "asc" | "desc" | null
 */

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

export type SortDirection = "asc" | "desc";

export interface ColumnSortEntry {
  column: string;
  direction: SortDirection;
}

export interface UseColumnSortOptions {
  /** Default sort applied when URL has no sort param. */
  defaultSort?: ColumnSortEntry[];
  /** URL search-params key. Default "sort". Override if two tables on one page. */
  paramKey?: string;
  /** When true, only one column can be sorted at a time. Default false (multi). */
  singleColumn?: boolean;
}

export interface UseColumnSortReturn {
  /** Currently-applied sort, in order of precedence. */
  state: ColumnSortEntry[];
  /** Sort direction for a specific column, or null if not sorted. */
  sortValue: (column: string) => SortDirection | null;
  /**
   * Cycle a column's sort: none → asc → desc → none.
   * Pass `additive=true` (Shift-click) to append rather than replace.
   */
  toggle: (column: string, additive?: boolean) => void;
  /** Replace the entire sort spec. */
  set: (entries: ColumnSortEntry[]) => void;
  /** Reset to defaultSort. */
  clear: () => void;
}

const SEPARATOR = ",";
const FIELD_SEP = ":";

export function useColumnSort({
  defaultSort = [],
  paramKey = "sort",
  singleColumn = false,
}: UseColumnSortOptions = {}): UseColumnSortReturn {
  const router = useRouter();
  const params = useSearchParams();

  const state = useMemo<ColumnSortEntry[]>(() => {
    const raw = params.get(paramKey);
    if (!raw) return defaultSort;
    return parseSortParam(raw);
  }, [params, paramKey, defaultSort]);

  const sortValue = useCallback(
    (column: string): SortDirection | null => {
      return state.find((s) => s.column === column)?.direction ?? null;
    },
    [state],
  );

  const writeToUrl = useCallback(
    (next: ColumnSortEntry[]) => {
      const newParams = new URLSearchParams(params.toString());
      const serialized = serializeSortParam(next);
      if (serialized === serializeSortParam(defaultSort)) {
        // Same as default — drop the param from the URL entirely
        newParams.delete(paramKey);
      } else {
        newParams.set(paramKey, serialized);
      }
      router.replace(`?${newParams.toString()}`, { scroll: false });
    },
    [params, paramKey, router, defaultSort],
  );

  const toggle = useCallback(
    (column: string, additive = false) => {
      const current = sortValue(column);
      const nextDirection: SortDirection | null =
        current === null ? "asc" : current === "asc" ? "desc" : null;

      let next: ColumnSortEntry[];
      if (singleColumn) {
        next = nextDirection === null ? [] : [{ column, direction: nextDirection }];
      } else if (additive) {
        // Multi-column: replace this entry's direction, leave others
        const filtered = state.filter((s) => s.column !== column);
        next =
          nextDirection === null ? filtered : [...filtered, { column, direction: nextDirection }];
      } else {
        // Non-additive click: replace whole sort with just this column
        next = nextDirection === null ? [] : [{ column, direction: nextDirection }];
      }
      writeToUrl(next);
    },
    [sortValue, state, singleColumn, writeToUrl],
  );

  const set = useCallback(
    (entries: ColumnSortEntry[]) => {
      writeToUrl(entries);
    },
    [writeToUrl],
  );

  const clear = useCallback(() => {
    writeToUrl(defaultSort);
  }, [writeToUrl, defaultSort]);

  return { state, sortValue, toggle, set, clear };
}

// =========================================================================
// Helpers
// =========================================================================

function parseSortParam(raw: string): ColumnSortEntry[] {
  return raw
    .split(SEPARATOR)
    .map((entry) => {
      const [column, direction] = entry.split(FIELD_SEP);
      if (!column) return null;
      const dir: SortDirection = direction === "desc" ? "desc" : "asc";
      return { column, direction: dir };
    })
    .filter((e): e is ColumnSortEntry => e !== null);
}

function serializeSortParam(entries: ColumnSortEntry[]): string {
  return entries.map((e) => `${e.column}${FIELD_SEP}${e.direction}`).join(SEPARATOR);
}

// =========================================================================
// Server-side helper — for SSR pages that need to read sort from URL
// =========================================================================

/**
 * Parse sort param from a server-side searchParams object (Next.js page props).
 * Use this in `page.tsx` server components when you want to apply the same
 * sort to your Drizzle query.
 */
export function parseSortParams(
  searchParams: Record<string, string | undefined> | URLSearchParams,
  paramKey = "sort",
): ColumnSortEntry[] {
  const raw =
    searchParams instanceof URLSearchParams ? searchParams.get(paramKey) : searchParams[paramKey];
  if (!raw) return [];
  return parseSortParam(raw);
}
