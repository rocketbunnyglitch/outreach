"use client";

import { cn } from "@/lib/cn";
import { Columns3, PanelLeftClose, PanelLeftOpen, Rows3, Settings } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { updateUserPreferences } from "../../_actions/user-preferences";
import { InboxRail } from "./InboxRail";

export type InboxView = "outlook" | "gmail";

/**
 * Three-pane Inbox shell (Outlook/Gmail-style, desktop-resizable).
 *
 *   Desktop (lg+):
 *     Left   (drag)    folder list — COLLAPSIBLE via the edge toggle AND
 *                      drag-resizable via the handle on its right edge.
 *     Middle (drag)    thread list — drag-resizable via the handle between
 *                      it and the reading pane; the reading pane reflows.
 *     Right  (flex)    thread detail + CRM rail.
 *   All three prefs (left width, middle width, collapsed) persist in
 *   localStorage. An always-visible Settings gear in the edge strip links
 *   to /settings/inboxes (add/resync inboxes) so it stays reachable even
 *   when the folders rail is collapsed.
 *
 *   Mobile (<lg): unchanged Phase-F pane swap. Resize + collapse are
 *     desktop-only, and persisted widths apply ONLY once mounted AND on a
 *     desktop viewport, so SSR + first hydration match the static defaults
 *     (hydration-safe — no #418 bail).
 */

const MIDDLE_WIDTH_KEY = "perse:inbox:middleWidth";
const LEFT_WIDTH_KEY = "perse:inbox:leftWidth";
const COLLAPSE_KEY = "perse:inbox:leftCollapsed";
const MID_MIN = 300;
const MID_MAX = 760;
const MID_DEFAULT = 380;
const LEFT_MIN = 180;
const LEFT_MAX = 420;
const LEFT_DEFAULT = 220;

function clamp(n: number, min: number, max: number, def: number): number {
  if (!Number.isFinite(n) || n === 0) return def;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function InboxShell({
  left,
  middle,
  right,
  topRight,
  topBar,
  hasThreadSelected = false,
  view = "outlook",
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
  /** 'outlook' = 3-pane reading-pane layout (default). 'gmail' = no
   *  reading pane: full-width list, click opens the thread full-screen
   *  (like the mobile pane-swap, but on desktop too). Saved to profile. */
  view?: InboxView;
}) {
  const router = useRouter();
  const [, startViewSave] = useTransition();
  // In gmail view the list + reading pane never coexist -- they swap
  // full-width like the mobile layout, keeping only the folder rail.
  const gmail = view === "gmail";

  function toggleView() {
    const next: InboxView = gmail ? "outlook" : "gmail";
    startViewSave(() => {
      void updateUserPreferences({ inboxView: next }).catch(() => {});
      // Server re-renders the shell with the new layout.
      router.refresh();
    });
  }
  // Mount gate — defaults match SSR; persisted prefs apply only after mount
  // (and only on desktop) so the first client render can't mismatch the
  // server HTML.
  const [mounted, setMounted] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [middleWidth, setMiddleWidth] = useState(MID_DEFAULT);
  const [leftWidth, setLeftWidth] = useState(LEFT_DEFAULT);
  const [dragging, setDragging] = useState<null | "left" | "middle">(null);

  const middleWidthRef = useRef(MID_DEFAULT);
  const leftWidthRef = useRef(LEFT_DEFAULT);
  const startXRef = useRef(0);
  const startWRef = useRef(0);
  const dragKindRef = useRef<null | "left" | "middle">(null);

  useEffect(() => {
    setMounted(true);
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    try {
      const mw = clamp(
        Number(window.localStorage.getItem(MIDDLE_WIDTH_KEY)),
        MID_MIN,
        MID_MAX,
        MID_DEFAULT,
      );
      middleWidthRef.current = mw;
      setMiddleWidth(mw);
      const lw = clamp(
        Number(window.localStorage.getItem(LEFT_WIDTH_KEY)),
        LEFT_MIN,
        LEFT_MAX,
        LEFT_DEFAULT,
      );
      leftWidthRef.current = lw;
      setLeftWidth(lw);
      setLeftCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      // localStorage blocked — defaults are fine.
    }
    return () => mq.removeEventListener("change", sync);
  }, []);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const kind = dragKindRef.current;
    if (!kind) return;
    const delta = e.clientX - startXRef.current;
    if (kind === "left") {
      const next = clamp(startWRef.current + delta, LEFT_MIN, LEFT_MAX, LEFT_DEFAULT);
      leftWidthRef.current = next;
      setLeftWidth(next);
    } else {
      const next = clamp(startWRef.current + delta, MID_MIN, MID_MAX, MID_DEFAULT);
      middleWidthRef.current = next;
      setMiddleWidth(next);
    }
  }, []);

  const onPointerUp = useCallback(() => {
    const kind = dragKindRef.current;
    if (!kind) return;
    dragKindRef.current = null;
    setDragging(null);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    try {
      window.localStorage.setItem(
        kind === "left" ? LEFT_WIDTH_KEY : MIDDLE_WIDTH_KEY,
        String(kind === "left" ? leftWidthRef.current : middleWidthRef.current),
      );
    } catch {
      // ignore
    }
  }, [onPointerMove]);

  const startDrag = useCallback(
    (kind: "left" | "middle", e: React.PointerEvent) => {
      e.preventDefault();
      dragKindRef.current = kind;
      setDragging(kind);
      startXRef.current = e.clientX;
      startWRef.current = kind === "left" ? leftWidthRef.current : middleWidthRef.current;
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

  // Custom widths apply ONLY on a mounted desktop viewport. On SSR/first
  // paint and on mobile these are undefined, so the static Tailwind widths
  // (desktop) / flex-1 / drawer (mobile) govern — hydration-deterministic.
  const onDesktop = mounted && isDesktop;
  const middleStyle = onDesktop ? { width: middleWidth, flex: "0 0 auto" as const } : undefined;
  const railStyle =
    onDesktop && !leftCollapsed ? { width: leftWidth, flex: "0 0 auto" as const } : undefined;

  return (
    <div
      // Drives the gmail-vs-outlook row density via CSS ancestor variants
      // in the thread rows (single-line list in gmail view).
      data-inbox-view={view}
      className={cn(
        "relative flex animate-[fade-in_300ms_ease-out] flex-col",
        // Pin to the viewport so the thread list + reading pane scroll
        // INTERNALLY (Gmail-style) instead of growing the whole page.
        // 100dvh accounts for mobile browser chrome.
        "h-[calc(100dvh-8rem)] lg:h-[calc(100dvh-6rem)]",
        "card-surface overflow-hidden p-0",
        "-mx-6 -mt-6 sm:-mx-10 sm:-mt-10 max-lg:rounded-none max-lg:border-x-0",
        "lg:-mx-6 lg:-my-6",
      )}
    >
      {topRight && (
        <div className="absolute top-3 right-4 z-20 lg:top-4 lg:right-5">{topRight}</div>
      )}
      {topBar && <div className={cn("shrink-0", topRight && "pr-14 lg:pr-16")}>{topBar}</div>}

      {/* Pane body — column on mobile, row on lg+. */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Desktop-only edge control strip: collapse/expand the rail, and
            an always-visible Settings gear (reachable even when collapsed). */}
        <div className="hidden shrink-0 flex-col items-center gap-1 border-zinc-200/80 border-r pt-2 lg:flex dark:border-zinc-800/60">
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
          <Link
            href="/settings/inboxes"
            aria-label="Inbox settings — add or resync email accounts"
            title="Inbox settings (add / resync email accounts)"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <Settings className="h-4 w-4" />
          </Link>
          <button
            type="button"
            onClick={toggleView}
            aria-label={
              gmail ? "Switch to Outlook view (reading pane)" : "Switch to Gmail view (list)"
            }
            title={
              gmail
                ? "Outlook view: 3-pane with reading pane"
                : "Gmail view: full-width list, open full-screen"
            }
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            {gmail ? <Columns3 className="h-4 w-4" /> : <Rows3 className="h-4 w-4" />}
          </button>
        </div>

        {/* Left pane — folders. Hidden on desktop when collapsed; mobile
            drawer is unaffected. Drag-resizable on desktop via railStyle. */}
        <InboxRail collapsed={leftCollapsed} style={railStyle}>
          {left}
        </InboxRail>

        {/* Left resize handle — between the rail and the list. Desktop only,
            and only when the rail is expanded. */}
        {!leftCollapsed && (
          <button
            type="button"
            aria-label="Resize folders pane"
            onPointerDown={(e) => startDrag("left", e)}
            className={cn(
              "group relative hidden w-1.5 shrink-0 cursor-col-resize touch-none lg:block",
              "bg-transparent hover:bg-blue-500/10",
              dragging === "left" && "bg-blue-500/20",
            )}
          >
            <span aria-hidden="true" className="-right-1 -left-1 absolute inset-y-0" />
            <span
              aria-hidden="true"
              className={cn(
                "-translate-x-1/2 absolute inset-y-0 left-1/2 w-px bg-transparent",
                "group-hover:bg-blue-400/60",
                dragging === "left" && "bg-blue-500/70",
              )}
            />
          </button>
        )}

        {/* Middle pane — thread list. Drag-resizable on desktop; mobile
            keeps the full-width pane swap. */}
        <section
          style={gmail ? undefined : middleStyle}
          className={cn(
            "overflow-y-auto border-zinc-200/80 dark:border-zinc-800/60",
            gmail
              ? hasThreadSelected
                ? "hidden"
                : "flex-1"
              : cn(
                  "lg:w-[380px] lg:border-r",
                  hasThreadSelected ? "hidden lg:block" : "flex-1 lg:flex-none",
                ),
          )}
        >
          {middle}
        </section>

        {/* Resize handle between the list and the reading pane. Desktop
            only; hidden in gmail view (no side-by-side reading pane). */}
        {!gmail && (
          <button
            type="button"
            aria-label="Resize reading pane"
            onPointerDown={(e) => startDrag("middle", e)}
            className={cn(
              "group relative hidden w-1.5 shrink-0 cursor-col-resize touch-none lg:block",
              "bg-transparent hover:bg-blue-500/10",
              dragging === "middle" && "bg-blue-500/20",
            )}
          >
            <span aria-hidden="true" className="-right-1 -left-1 absolute inset-y-0" />
            <span
              aria-hidden="true"
              className={cn(
                "-translate-x-1/2 absolute inset-y-0 left-1/2 w-px bg-transparent",
                "group-hover:bg-blue-400/60",
                dragging === "middle" && "bg-blue-500/70",
              )}
            />
          </button>
        )}

        {/* Right pane -- thread detail. In gmail view it takes the full
            width when a thread is open, and is hidden on the list route. */}
        <section
          className={cn(
            "overflow-y-auto",
            gmail
              ? hasThreadSelected
                ? "flex-1"
                : "hidden"
              : hasThreadSelected
                ? "flex-1"
                : "hidden lg:block lg:flex-1",
          )}
        >
          {right}
        </section>
      </div>
    </div>
  );
}
