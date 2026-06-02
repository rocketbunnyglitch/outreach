"use client";

/**
 * InboxDensityToggle — operator-side display preferences.
 *
 * Persists to BOTH:
 *   - localStorage (instant, no-flicker on the same device)
 *   - server (user_preferences table — cross-device sync)
 *
 * The local key is the source of truth for the *current* paint;
 * the server is the source of truth for *new sessions* on other
 * devices (the InboxShell reads the server pref + writes it back
 * to localStorage on mount so the cache stays in sync).
 *
 * Three densities (Gmail uses the same three):
 *   default      — current spacing (py-3 on rows, py-5 on messages)
 *   comfortable  — extra breathing room (py-4 / py-6)
 *   compact      — denser (py-1.5 / py-3)
 *
 * Server writes go through updateUserPreferences with the single
 * key being changed; we don't bundle both fields so two devices
 * editing simultaneously don't stomp each other.
 */

import { Rows3, Rows4, Settings, Sidebar } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { updateUserPreferences } from "../../_actions/user-preferences";

export type InboxDensity = "compact" | "default" | "comfortable";
export type ReadingPanePosition = "right" | "bottom" | "none";

const DENSITY_KEY = "inbox-density";
const READING_PANE_KEY = "inbox-reading-pane";

export function InboxDensityToggle() {
  const [open, setOpen] = useState(false);
  const [density, setDensity] = useState<InboxDensity>("default");
  const [readingPane, setReadingPane] = useState<ReadingPanePosition>("right");
  const popRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

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
      const target = e.target as Node;
      // Exclude the trigger button: without this, a pointerdown on the
      // gear closed the popover, then the button's onClick re-opened it,
      // so the gear could never be used to close -- it took multiple
      // clicks / felt unresponsive. Let the button's own onClick toggle.
      if (
        popRef.current &&
        !popRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
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
    // Best-effort server sync — failures here just mean the choice
    // doesn't propagate to other devices until the operator tweaks
    // it again. Don't surface errors; the local change still works.
    updateUserPreferences({ inboxDensity: d }).catch(() => {});
  }

  function pickReadingPane(p: ReadingPanePosition) {
    setReadingPane(p);
    localStorage.setItem(READING_PANE_KEY, p);
    applyReadingPane(p);
    updateUserPreferences({ inboxReadingPane: p }).catch(() => {});
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
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
