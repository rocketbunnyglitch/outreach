"use client";

/**
 * ComposerHost — mount point for every open composer. Renders the
 * bottom-right stack via createPortal so the composer is anchored to
 * the viewport (not to whatever route currently owns the page).
 *
 * Layout choice:
 *   Multiple composers stack right-to-left along the bottom. We cap
 *   at MAX_DOCKED_COMPOSERS visible at once; anything beyond that
 *   gets force-minimized to keep the screen usable. Gmail does
 *   something similar at 3 composers.
 *
 * Mobile:
 *   On viewports < 640px the floating layout breaks down (the
 *   composer is wider than the screen). For narrow screens we render
 *   ONE composer as a full-screen bottom sheet; additional opens go
 *   into minimized state until the active one closes.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useComposer } from "./composer-store";
import { ComposerWindow } from "./composer-window";
import { useDraftHydration } from "./use-draft-hydration";

const MAX_DOCKED_COMPOSERS = 3;
const MOBILE_BREAKPOINT_PX = 640;

export function ComposerHost() {
  const { composers, setMode } = useComposer();
  const [isMobile, setIsMobile] = useState(false);

  // Hydrate any not-yet-sent drafts from the server on first mount
  // so a tab refresh doesn't lose in-progress work.
  useDraftHydration();

  // Track viewport width for mobile-vs-desktop layout switch.
  useEffect(() => {
    function check() {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT_PX);
    }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Cap docked composers — anything beyond gets minimized.
  useEffect(() => {
    const docked = Array.from(composers.values()).filter(
      (c) => c.mode === "docked" || c.mode === "expanded",
    );
    if (docked.length > MAX_DOCKED_COMPOSERS) {
      // Minimize the OLDEST docked one to make room.
      const toMin = docked[0];
      if (toMin) setMode(toMin.id, "minimized");
    }
  }, [composers, setMode]);

  if (typeof document === "undefined") return null;
  if (composers.size === 0) return null;

  const list = Array.from(composers.values());

  return createPortal(
    <div
      // Container is a non-interactive overlay layer; individual
      // composer windows each have pointer-events: auto. This way
      // the page beneath the unused space stays clickable.
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[150] flex flex-row-reverse items-end gap-3 px-3 pb-3"
      aria-live="polite"
    >
      {list.map((c, i) => (
        <ComposerWindow key={c.id} instance={c} index={i} isMobile={isMobile} />
      ))}
    </div>,
    document.body,
  );
}
