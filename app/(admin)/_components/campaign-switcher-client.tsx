"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { Check, ChevronsUpDown, Settings2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
 */
export function CampaignSwitcherClient({
  available,
  currentId,
  currentLabel,
  currentBrandPair,
}: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

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
    <div ref={containerRef} className="relative hidden lg:block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex cursor-pointer items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
      >
        <div className="flex flex-col items-start leading-tight">
          <span className="text-[10px] text-zinc-400 uppercase tracking-widest">Campaign</span>
          {currentLabel ? (
            <span className="max-w-[200px] truncate font-medium text-zinc-900 dark:text-zinc-100">
              {currentLabel}
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
                <form
                  action={async (fd) => {
                    setOpen(false);
                    await switchCurrentCampaign(fd);
                  }}
                >
                  <input type="hidden" name="campaignId" value={c.id} />
                  <button
                    type="submit"
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
                </form>
              </li>
            ))}
          </ul>
          <div className="border-zinc-100 border-t dark:border-zinc-800">
            <a
              href="/admin"
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
              <form
                action={async (fd) => {
                  setOpen(false);
                  await switchCurrentCampaign(fd);
                }}
              >
                <input type="hidden" name="campaignId" value="_clear" />
                <Button
                  type="submit"
                  variant="ghost"
                  size="sm"
                  className="w-full justify-center text-xs text-zinc-500"
                >
                  Clear selection
                </Button>
              </form>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
