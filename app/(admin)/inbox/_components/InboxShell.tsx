"use client";

import { cn } from "@/lib/cn";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { InboxRail } from "./InboxRail";

/**
 * Three-pane Inbox shell (Outlook/Gmail-style, desktop-resizable).
 *
 *   Desktop (lg+):
 *     Left   (~220px)  folder list + filter chips — COLLAPSIBLE via the
 *                      edge toggle; state persists in localStorage.
 *     Middle (drag)    thread list — width is operator-draggable via the
 *                      handle between it and the reading pane; the reading
 *                      pane reflows live. Width persists in localStorage.
 *     Right  (flex)    thread detail + CRM rail.
 *
 *   Mobile (<lg): unchanged Phase-F pane swap — middle full-width on the
 *     list view, right full-width inside a thread. Resize + collapse are
 *     desktop-only (the drag handle + toggle are `hidden lg:*`), and the
 *     persisted middle width is applied ONLY once mounted AND on a desktop
 *     viewport, so SSR + first hydration always match the static defaults
 *     (hydration-safe — no #418 bail).
 */

const WIDTH_KEY = "perse:inbox:middleWidth";
const COLLAPSE_KEY = "perse:inbox:leftCollapsed";
const MIN_W = 300;
const MAX_W = 760;
const DEFAULT_W = 380;

function clampWidth(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_W;
  return Math.min(MAX_W, Math.max(MIN_W, Math.round(n)));
}

export function InboxShell({
  left,
  middle,
  right,
  topRight,
  topBar,
  hasThreadSelected = false,
}: {
  left: React.ReactNode;
  middle: React.ReactNode;
  right: React.ReactNode;
  /** Optional top-right slot — renders absolutely-positioned over the
   *  shell so it floats above the right pane (the AccountSwitcher). */
  topRight?: React.ReactNode;
  /** Optional full-width header row inside the card, above the panes. */
  topBar?: React.ReactNode;
  /** Drives the mobile pane swap. Desktop shows all panes regardless. */
  hasThreadSelected?: boolean;
}) {
  // Mount gate — defaults match SSR; persisted prefs apply only after mount
  // (and only on desktop) so the first client render can't mismatch the
  // server HTML.
  const [mounted, setMounted] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [middleWidth, setMiddleWidth] = useState(DEFAULT_W);
  const [dragging, setDragging] = useState(false);

  const widthRef = useRef(DEFAULT_W);
  const startXRef = useRef(0);
  const startWRef = useRef(DEFAULT_W);
  const draggingRef = useRef(false);

  useEffect(() => {
    setMounted(true);
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    try {
      const w = clampWidth(Number(window.localStorage.getItem(WIDTH_KEY)));
      widthRef.current = w;
      setMiddleWidth(w);
      setLeftCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      // localStorage blocked — defaults are fine.
    }
    return () => mq.removeEventListener("change", sync);
  }, []);

  const onPointerMove = useCallback((e: PointerEvent) => {
    if (!draggingRef.current) return;
    const next = clampWidth(startWRef.current + (e.clientX - startXRef.current));
    widthRef.current = next;
    setMiddleWidth(next);
  }, []);

  const onPointerUp = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    try {
      window.localStorage.setItem(WIDTH_KEY, String(widthRef.current));
    } catch {
      // ignore
    }
  }, [onPointerMove]);

  const onHandleDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      draggingRef.current = true;
      setDragging(true);
      startXRef.current = e.clientX;
      startWRef.current = widthRef.current;
      // Suppress text selection + force the col-resize cursor globally
      // while dragging so it doesn't flicker over the panes.
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    },
    [onPointerMove, onPointerUp],
  );

  function toggleLeft() {
    setLeftCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }

  // Apply the custom middle width ONLY on a mounted desktop viewport. On
  // SSR/first paint and on mobile this is undefined, so the static
  // `lg:w-[380px]` class (desktop) / `flex-1` (mobile) governs — keeping
  // hydration deterministic.
  const middleStyle =
    mounted && isDesktop ? { width: middleWidth, flex: "0 0 auto" as const } : undefined;

  return (
    <div
      className={cn(
        "relative flex animate-[fade-in_300ms_ease-out] flex-col",
        "min-h-[calc(100vh-8rem)] lg:min-h-[calc(100vh-6rem)]",
        "card-surface overflow-hidden p-0",
        "-mx-6 -mt-6 max-lg:rounded-none max-lg:border-x-0 sm:-mx-10 sm:-mt-10",
        "lg:-mx-6 lg:-my-6",
      )}
    >
      {topRight && (
        <div className="absolute top-3 right-4 z-20 lg:top-4 lg:right-5">{topRight}</div>
      )}
      {topBar && <div className="shrink-0 pr-14 lg:pr-16">{topBar}</div>}

      {/* Pane body — column on mobile, row on lg+. */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Desktop-only edge control: collapse / expand the folders rail.
            A thin always-present strip at the far left so the toggle is
            reachable in both states. */}
        <div className="hidden shrink-0 flex-col items-center pt-2 lg:flex">
          <button
            type="button"
            onClick={toggleLeft}
            aria-label={leftCollapsed ? "Expand folders" : "Collapse folders"}
            title={leftCollapsed ? "Expand folders" : "Collapse folders"}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            {leftCollapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </button>
        </div>

        {/* Left pane — folders. Hidden on desktop when collapsed; mobile
            drawer is unaffected. */}
        <InboxRail collapsed={leftCollapsed}>{left}</InboxRail>

        {/* Middle pane — thread list. Width is operator-resizable on
            desktop (inline style); mobile keeps the full-width pane swap. */}
        <section
          style={middleStyle}
          className={cn(
            "overflow-y-auto border-zinc-200/80 lg:w-[380px] lg:border-r",
            "dark:border-zinc-800/60",
            hasThreadSelected ? "hidden lg:block" : "flex-1 lg:flex-none",
          )}
        >
          {middle}
        </section>

        {/* Resize handle between the list and the reading pane. Desktop
            only; a wide invisible hit-area around a thin visible rule. */}
        <button
          type="button"
          aria-label="Resize panes"
          onPointerDown={onHandleDown}
          className={cn(
            "group relative hidden w-1.5 shrink-0 cursor-col-resize touch-none lg:block",
            "bg-transparent hover:bg-blue-500/10",
            dragging && "bg-blue-500/20",
          )}
        >
          {/* Widen the actual grab target without shifting layout. */}
          <span aria-hidden="true" className="absolute inset-y-0 -left-1 -right-1" />
          <span
            aria-hidden="true"
            className={cn(
              "absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent",
              "group-hover:bg-blue-400/60",
              dragging && "bg-blue-500/70",
            )}
          />
        </button>

        {/* Right pane — thread detail. */}
        <section
          className={cn(
            "overflow-y-auto",
            hasThreadSelected ? "flex-1" : "hidden lg:block lg:flex-1",
          )}
        >
          {right}
        </section>
      </div>
    </div>
  );
}
