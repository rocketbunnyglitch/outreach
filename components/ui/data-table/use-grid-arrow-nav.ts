"use client";

/**
 * useGridArrowNav — attach to a container ref to enable arrow-key
 * cell-to-cell navigation through any InlineCell components rendered
 * inside that have `gridRow` + `gridCol` props.
 *
 * Cells advertise themselves by setting `data-grid-cell="r:c"` on their
 * trigger button. This hook listens for arrow keys at the container
 * level, reads the focused element's data-grid-cell, computes the
 * adjacent coord, and focuses the next button.
 *
 * Why DOM-attribute-based, not React-context-based?
 *   - InlineCell is used across many tables, each with its own row
 *     count, sort order, virtualization story. Maintaining a
 *     coordinator object would couple them all to a shared registry.
 *   - data-attributes are cheap, stay in sync with the DOM by
 *     construction, and don't require any imperative ref forest.
 *   - When the table re-sorts or re-renders, the next focus query
 *     just hits whatever's currently in the DOM — no stale refs.
 *
 * Behaviors:
 *   ArrowUp    → row - 1, same col
 *   ArrowDown  → row + 1, same col
 *   ArrowLeft  → same row, col - 1 (only if not in an input)
 *   ArrowRight → same row, col + 1 (only if not in an input)
 *   Home       → first cell in the row (col=0)
 *   End        → last cell in the row (highest col with a data-grid-cell)
 *
 * Left/Right are intentionally suppressed when focus is inside an
 * <input> so the operator can still move the text cursor while editing.
 *
 * Stops at the grid edges (no wrapping). Out-of-range queries simply
 * don't focus anything; the current cell stays focused.
 */

import { type RefObject, useEffect } from "react";

export function useGridArrowNav(containerRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function isInsideInput(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    }

    function focusAt(row: number, col: number): boolean {
      const target = container?.querySelector<HTMLElement>(`[data-grid-cell="${row}:${col}"]`);
      if (target) {
        target.focus();
        // Scroll into view if needed — keep the focused cell visible
        // when navigating through long tables.
        if (typeof target.scrollIntoView === "function") {
          target.scrollIntoView({ block: "nearest", inline: "nearest" });
        }
        return true;
      }
      return false;
    }

    function findMaxColInRow(row: number): number {
      const cells = container?.querySelectorAll<HTMLElement>(`[data-grid-cell^="${row}:"]`);
      if (!cells || cells.length === 0) return -1;
      let max = -1;
      for (const c of cells) {
        const attr = c.getAttribute("data-grid-cell");
        const parts = attr?.split(":");
        if (parts && parts.length === 2 && parts[1]) {
          const n = Number.parseInt(parts[1], 10);
          if (Number.isFinite(n) && n > max) max = n;
        }
      }
      return max;
    }

    function onKeyDown(e: KeyboardEvent) {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;

      // The button that announces its position with data-grid-cell.
      // If the active focus isn't on one, we don't do anything (the
      // table cells fan out into a normal tabbable tree like any
      // other component).
      const cell = target.closest<HTMLElement>("[data-grid-cell]");
      if (!cell) return;
      // If the keystroke originated INSIDE an editing input nested
      // within the cell, leave it alone (the input handles its own
      // Enter/Escape/Tab) — same goes for Left/Right which we want
      // to move the text cursor.
      if (isInsideInput(target)) {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") return;
        // Up/Down inside an input — uncommon but let them through too
        if (e.key === "ArrowUp" || e.key === "ArrowDown") return;
      }

      const attr = cell.getAttribute("data-grid-cell");
      const parts = attr?.split(":");
      if (!parts || parts.length !== 2) return;
      const row = Number.parseInt(parts[0] ?? "", 10);
      const col = Number.parseInt(parts[1] ?? "", 10);
      if (!Number.isFinite(row) || !Number.isFinite(col)) return;

      switch (e.key) {
        case "ArrowUp": {
          e.preventDefault();
          focusAt(row - 1, col);
          return;
        }
        case "ArrowDown": {
          e.preventDefault();
          focusAt(row + 1, col);
          return;
        }
        case "ArrowLeft": {
          e.preventDefault();
          focusAt(row, col - 1);
          return;
        }
        case "ArrowRight": {
          e.preventDefault();
          focusAt(row, col + 1);
          return;
        }
        case "Home": {
          e.preventDefault();
          focusAt(row, 0);
          return;
        }
        case "End": {
          e.preventDefault();
          const maxCol = findMaxColInRow(row);
          if (maxCol >= 0) focusAt(row, maxCol);
          return;
        }
      }
    }

    container.addEventListener("keydown", onKeyDown);
    return () => container.removeEventListener("keydown", onKeyDown);
  }, [containerRef]);
}
