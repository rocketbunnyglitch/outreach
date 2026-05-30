"use client";

/**
 * InboxDensityToggle — operator-side density preference for the
 * inbox. Persists to localStorage (key `inbox-density`) and applies
 * a data-attribute on the inbox shell which the row CSS targets to
 * tighten or loosen padding.
 *
 * Three densities (Gmail uses the same three):
 *   default      — current spacing (py-3 on rows, py-5 on messages)
 *   comfortable  — extra breathing room (py-4 / py-6)
 *   compact      — denser (py-1.5 / py-3)
 *
 * No DB round trip: the preference is per-device per-browser, same
 * as Gmail's surface. A future server-side preferences table can
 * back this up if cross-device sync becomes a need.
 */

import { Rows3, Rows4, Settings, Sidebar } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type InboxDensity = "compact" | "default" | "comfortable";
export type ReadingPanePosition = "right" | "bottom" | "none";

const DENSITY_KEY = "inbox-density";
const READING_PANE_KEY = "inbox-reading-pane";

export function InboxDensityToggle() {
  const [open, setOpen] = useState(false);
  const [density, setDensity] = useState<InboxDensity>("default");
  const [readingPane, setReadingPane] = useState<ReadingPanePosition>("right");
  const popRef = useRef<HTMLDivElement>(null);

  // Hydrate from localStorage on mount.
  useEffect(() => {
    const stored = (localStorage.getItem(DENSITY_KEY) ?? "default") as InboxDensity;
    if (stored === "compact" || stored === "comfortable" || stored === "default") {
      setDensity(stored);
      applyDensity(stored);
    }
    const pane = (localStorage.getItem(READING_PANE_KEY) ?? "right") as ReadingPanePosition;
    if (pane === "right" || pane === "bottom" || pane === "none") {
      setReadingPane(pane);
      applyReadingPane(pane);
    }
  }, []);

  // Click-outside close.
  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  function pickDensity(d: InboxDensity) {
    setDensity(d);
    localStorage.setItem(DENSITY_KEY, d);
    applyDensity(d);
  }

  function pickReadingPane(p: ReadingPanePosition) {
    setReadingPane(p);
    localStorage.setItem(READING_PANE_KEY, p);
    applyReadingPane(p);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Display settings"
        aria-label="Display settings"
        className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      >
        <Settings className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div
          ref={popRef}
          className="absolute top-full right-0 z-30 mt-1 w-56 rounded-lg border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
          role="menu"
        >
          <div className="mb-1 px-1 font-mono text-[9px] text-zinc-500 uppercase tracking-widest">
            Density
          </div>
          <ul className="flex flex-col gap-0.5">
            {(
              [
                { value: "comfortable", label: "Comfortable", icon: Rows3 },
                { value: "default", label: "Default", icon: Rows4 },
                { value: "compact", label: "Compact", icon: Rows4 },
              ] as const
            ).map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  onClick={() => pickDensity(o.value)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                    density === o.value ? "bg-zinc-100 font-medium dark:bg-zinc-800" : ""
                  }`}
                >
                  <o.icon className="h-3 w-3 text-zinc-500" />
                  {o.label}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 mb-1 px-1 font-mono text-[9px] text-zinc-500 uppercase tracking-widest">
            Reading pane
          </div>
          <ul className="flex flex-col gap-0.5">
            {(
              [
                { value: "right", label: "Right (default)" },
                { value: "bottom", label: "Below the list" },
                { value: "none", label: "No reading pane" },
              ] as const
            ).map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  onClick={() => pickReadingPane(o.value)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                    readingPane === o.value ? "bg-zinc-100 font-medium dark:bg-zinc-800" : ""
                  }`}
                >
                  <Sidebar className="h-3 w-3 text-zinc-500" />
                  {o.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function applyDensity(d: InboxDensity) {
  if (typeof document === "undefined") return;
  // Apply at the root so the inbox shell + every nested row picks it
  // up via attribute selectors. Avoids prop-drilling a density flag
  // through every component.
  document.documentElement.setAttribute("data-inbox-density", d);
}

function applyReadingPane(p: ReadingPanePosition) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-inbox-reading-pane", p);
}
