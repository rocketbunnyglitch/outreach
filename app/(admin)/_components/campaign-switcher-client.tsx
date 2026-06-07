"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { Check, ChevronsUpDown, Settings2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { switchCurrentCampaign } from "../_actions";

interface CampaignOption {
  id: string;
  name: string;
  slug: string;
  outreachBrandName: string;
  crawlBrandName: string;
}

interface Props {
  available: CampaignOption[];
  currentId: string | null;
  currentLabel: string | null;
  /** Compact label for mobile (e.g. "IHLWN26"). Falls back to currentLabel. */
  currentShortLabel: string | null;
  currentBrandPair: string | null;
}

/**
 * Campaign picker in the top nav.
 *
 * Why we abandoned <details>: the previous version used a native
 * <details> element, but the `open` state didn't reliably reset after a
 * form submission — the dropdown stayed visually open across the
 * server-action revalidation. Switched to a controlled popover with
 * manual outside-click + escape handling.
 *
 * Adds an "Admin" link that jumps to /admin without changing the
 * current campaign cookie.
 *
 * Why mousedown + ignore on the trigger:
 *   Operators reported "the dropdown opens but I can't click anything,
 *   and nothing else on the page works either". Root cause was the
 *   outside-click listener using `pointerdown` on the document. On
 *   touch devices iOS sometimes routes the first pointer event to the
 *   document body (not the button), so the handler saw the tap as
 *   "outside" and closed the menu BEFORE the button's click could
 *   fire. The menu unmounted mid-tap, leaving the page in a weird
 *   pointer-capture state where subsequent clicks were swallowed.
 *
 *   Fix: use `mousedown` for outside-click (more predictable than
 *   pointerdown on touch), check `e.target` BUT also `contains()` —
 *   if either matches the container, treat as inside. Plus we use
 *   `data-campaign-switcher-item` markers + check those too so the
 *   click that just landed on a menu item isn't treated as outside.
 *   And we close + switch in a single transition so React/Next don't
 *   leave the page in a pending state.
 */
export function CampaignSwitcherClient({
  available,
  currentId,
  currentLabel,
  currentShortLabel,
  currentBrandPair,
}: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [pending, startTx] = useTransition();

  useEffect(() => {
    if (!open) return;
    function isInside(target: EventTarget | null): boolean {
      if (!(target instanceof Node)) return false;
      // Container check covers the dropdown menu since it's inside
      // containerRef. The data attribute is a defensive marker in
      // case a portal-rendered popover ever escapes the container.
      if (containerRef.current?.contains(target)) return true;
      if (target instanceof Element && target.closest("[data-campaign-switcher-item]")) {
        return true;
      }
      return false;
    }
    function onMouseDown(e: MouseEvent) {
      if (!isInside(e.target)) setOpen(false);
    }
    function onTouch(e: TouchEvent) {
      // touchstart is the iOS-reliable equivalent. We check the
      // touch target separately — iOS's pointer-event synthesis can
      // route the FIRST event to body, so we'd otherwise close on
      // tap-in.
      if (e.touches.length === 0) return;
      if (!isInside(e.touches[0]?.target ?? null)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("touchstart", onTouch, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("touchstart", onTouch);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Close the dropdown after any navigation. Defensive — `<a>`-based
  // entries in the menu set open=false on click already, but if the
  // user mid-tap triggers a route change another way (back button,
  // command palette), we don't want a ghost menu floating after.
  useEffect(() => {
    if (!open) return;
    function onPopState() {
      setOpen(false);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [open]);

  function pickCampaign(campaignId: string) {
    // Single transition: close the menu IMMEDIATELY, then run the
    // server action. router.refresh() at the end picks up the new
    // cookie state. Doing it this way (instead of wrapping with
    // <form action={async fn}>) keeps React from leaving the page
    // in a pending-form state that blocks other clicks.
    setOpen(false);
    startTx(async () => {
      const fd = new FormData();
      fd.set("campaignId", campaignId);
      await switchCurrentCampaign(fd);
      router.refresh();
    });
  }

  if (available.length === 0) {
    return (
      <a
        href="/campaigns/new"
        className="hidden items-center gap-2 rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-500 transition-colors hover:border-zinc-300 hover:text-zinc-900 lg:flex dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:text-zinc-100"
      >
        No campaigns yet · <span className="underline">create one</span>
      </a>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={pending}
        className={cn(
          "flex max-w-[52vw] cursor-pointer items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm transition-colors hover:border-zinc-300 sm:max-w-none dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700",
          pending && "opacity-60",
        )}
      >
        <div className="flex min-w-0 flex-col items-start leading-tight">
          <span className="text-[10px] text-zinc-400 uppercase tracking-widest">Campaign</span>
          {currentLabel ? (
            <span className="max-w-[140px] truncate font-medium text-zinc-900 sm:max-w-[200px] dark:text-zinc-100">
              {/* Short label on mobile (e.g. IHLWN26), full name on sm+. */}
              <span className="sm:hidden">{currentShortLabel ?? currentLabel}</span>
              <span className="hidden sm:inline">{currentLabel}</span>
            </span>
          ) : (
            <span className="font-medium text-zinc-500">Pick one…</span>
          )}
        </div>
        <ChevronsUpDown className="h-3 w-3 text-zinc-400" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full left-0 z-50 mt-1 w-80 rounded-md border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
        >
          {currentBrandPair && (
            <div className="border-zinc-100 border-b px-3 py-2 text-[11px] text-zinc-500 dark:border-zinc-800">
              Currently: {currentBrandPair}
            </div>
          )}
          <ul className="max-h-72 overflow-auto py-1">
            {available.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  data-campaign-switcher-item="true"
                  onClick={() => pickCampaign(c.id)}
                  disabled={pending}
                  className={cn(
                    "flex w-full flex-col items-start gap-0.5 rounded-sm px-3 py-2 text-left text-sm transition-colors",
                    "hover:bg-zinc-100 dark:hover:bg-zinc-800",
                    c.id === currentId && "bg-zinc-50 dark:bg-zinc-800",
                  )}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="truncate font-medium">{c.name}</span>
                    {c.id === currentId && (
                      <Check className="h-3 w-3 shrink-0 text-zinc-700 dark:text-zinc-300" />
                    )}
                  </div>
                  <span className="text-[10px] text-zinc-500">
                    {c.outreachBrandName} · {c.crawlBrandName}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="border-zinc-100 border-t dark:border-zinc-800">
            <a
              href="/admin"
              data-campaign-switcher-item="true"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <Settings2 className="h-3.5 w-3.5 text-zinc-500" />
              <span className="flex-1">Admin dashboard</span>
              <span className="font-mono text-[10px] text-zinc-400 uppercase tracking-widest">
                manage
              </span>
            </a>
          </div>
          {currentId && (
            <div className="border-zinc-100 border-t p-1 dark:border-zinc-800">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => pickCampaign("_clear")}
                disabled={pending}
                data-campaign-switcher-item="true"
                className="w-full justify-center text-xs text-zinc-500"
              >
                Clear selection
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
