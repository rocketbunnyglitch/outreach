"use client";

/**
 * InboxRail — the left folder/settings rail, rendered ONCE.
 *
 *   Desktop (lg+): a static 220px left pane (folders, settings gear,
 *                  Compose, filter facets).
 *   Mobile (<lg):  hidden by default; slides in as an off-canvas overlay
 *                  when the operator taps the hamburger (InboxRailTrigger,
 *                  rendered in the list header). Previously the whole rail
 *                  was `hidden lg:block` with NO mobile affordance, so the
 *                  settings gear, folders (Sent/Drafts/Trash...) and the
 *                  Compose button were unreachable on a phone.
 *
 * Trigger and drawer are decoupled via a document CustomEvent so the
 * hamburger can live inline in the list header (no overlap with the scope
 * bar) while the rail content stays a single instance here (one
 * InboxPresenceBar -> one presence heartbeat).
 */

import { cn } from "@/lib/cn";
import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";

const OPEN_EVENT = "inbox-rail-open";

/** Hamburger button — mobile only. Place in the list header. */
export function InboxRailTrigger() {
  return (
    <button
      type="button"
      aria-label="Open folders and settings"
      title="Folders + settings"
      onClick={() => document.dispatchEvent(new CustomEvent(OPEN_EVENT))}
      className="-ml-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 lg:hidden dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
    >
      <Menu className="h-5 w-5" />
    </button>
  );
}

export function InboxRail({
  children,
  collapsed = false,
  style,
}: {
  children: React.ReactNode;
  /** Desktop-only: when true the static left pane is hidden (the operator
   *  collapsed it via InboxShell's toggle). Mobile drawer is unaffected —
   *  the hamburger still opens it. */
  collapsed?: boolean;
  /** Desktop-only inline width (operator drag-resize). InboxShell passes it
   *  ONLY on a mounted desktop viewport with the rail expanded, so it never
   *  fights the mobile drawer's fixed width or SSR defaults. */
  style?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onOpen() {
      setOpen(true);
    }
    document.addEventListener(OPEN_EVENT, onOpen);
    return () => document.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  // Close on Escape while the mobile drawer is open.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {/* Mobile backdrop (tap to close). */}
      {open && (
        <button
          type="button"
          aria-label="Close folders"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
        />
      )}
      <aside
        style={style}
        className={cn(
          "shrink-0 border-zinc-200/80 dark:border-zinc-800/60",
          // Mobile: off-canvas overlay when open, hidden when closed.
          open
            ? "fixed inset-y-0 left-0 z-50 w-[280px] max-w-[85vw] overflow-y-auto bg-white p-3 shadow-2xl dark:bg-zinc-950"
            : "hidden",
          // Desktop: static left pane regardless of `open` — UNLESS the
          // operator collapsed it, in which case it's hidden on lg+ and
          // InboxShell shows a slim expander instead.
          collapsed
            ? "lg:hidden"
            : "lg:static lg:inset-auto lg:z-auto lg:block lg:w-[220px] lg:max-w-none lg:overflow-visible lg:border-r lg:bg-transparent lg:p-3 lg:shadow-none",
        )}
      >
        {/* Mobile-only close affordance inside the drawer. */}
        {open && (
          <div className="mb-2 flex justify-end lg:hidden">
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpen(false)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {children}
      </aside>
    </>
  );
}
