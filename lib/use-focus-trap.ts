"use client";

import { useEffect, useRef } from "react";

/**
 * Minimal focus trap for hand-rolled modal dialogs.
 *
 * Several dialogs in this app are plain `<div role="dialog">` overlays
 * rather than Radix `<Dialog>`, so they don't trap focus: pressing Tab
 * from the last button walks into the page behind the scrim, and a
 * keyboard / screen-reader user can drive controls they can't see. This
 * hook fixes that for any such dialog without a Radix migration:
 *
 *   - Moves focus into the dialog on mount (first focusable, else the
 *     container itself — make it focusable with tabIndex={-1}).
 *   - Cycles Tab / Shift+Tab within the dialog's focusable elements.
 *   - Restores focus to whatever was focused before the dialog opened
 *     when it unmounts.
 *
 * Returns a ref to spread onto the dialog's content container.
 */
export function useFocusTrap<T extends HTMLElement>(active = true) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const getFocusable = (): HTMLElement[] =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);

    // Initial focus: first focusable child, else the container.
    const initial = getFocusable();
    (initial[0] ?? node).focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = getFocusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        // Nothing tabbable inside — keep focus pinned to the container.
        e.preventDefault();
        node.focus();
        return;
      }
      const activeEl = document.activeElement as HTMLElement | null;
      const outside = !node.contains(activeEl);
      if (e.shiftKey) {
        if (outside || activeEl === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (outside || activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      // Only restore if the previously-focused element is still in the DOM.
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [active]);

  return ref;
}
