"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { Check, ChevronsUpDown } from "lucide-react";
import { useRef, useState } from "react";
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
 * Click-to-open campaign picker that lives in the top nav. Uses a native
 * <details> element instead of building a custom popover, which gives us:
 *   - keyboard accessibility for free
 *   - works without client JS hydration timing concerns
 *   - closes on outside click via the `toggle` event
 *
 * Submitting a campaign id calls a server action that sets a cookie and
 * revalidates the layout. No client-side state syncing needed.
 */
export function CampaignSwitcherClient({
  available,
  currentId,
  currentLabel,
  currentBrandPair,
}: Props) {
  const [open, setOpen] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  if (available.length === 0) {
    // No campaigns yet — show a quiet placeholder rather than an empty
    // dropdown. Clicking lands the operator on /campaigns/new.
    return (
      <a
        href="/campaigns/new"
        className="hidden items-center gap-2 rounded-md border border-stone-200 px-3 py-1.5 text-stone-500 text-xs transition-colors hover:border-stone-300 hover:text-stone-900 lg:flex dark:border-stone-800 dark:hover:border-stone-700 dark:hover:text-stone-100"
      >
        No campaigns yet · <span className="underline">create one</span>
      </a>
    );
  }

  return (
    <details
      ref={detailsRef}
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="relative hidden lg:block"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md border border-stone-200 bg-white px-3 py-1.5 text-sm transition-colors hover:border-stone-300 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-stone-700">
        <div className="flex flex-col items-start leading-tight">
          <span className="text-[10px] text-stone-400 uppercase tracking-widest">Campaign</span>
          {currentLabel ? (
            <span className="max-w-[200px] truncate font-medium text-stone-900 dark:text-stone-100">
              {currentLabel}
            </span>
          ) : (
            <span className="font-medium text-stone-500">Pick one…</span>
          )}
        </div>
        <ChevronsUpDown className="h-3 w-3 text-stone-400" />
      </summary>

      <div className="absolute top-full left-0 z-50 mt-1 w-80 rounded-md border border-stone-200 bg-white p-1 shadow-lg dark:border-stone-800 dark:bg-stone-900">
        {currentBrandPair && (
          <div className="border-stone-100 border-b px-3 py-2 text-[11px] text-stone-500 dark:border-stone-800">
            Currently: {currentBrandPair}
          </div>
        )}
        <ul className="max-h-72 overflow-auto py-1">
          {available.map((c) => (
            <li key={c.id}>
              <form action={switchCurrentCampaign}>
                <input type="hidden" name="campaignId" value={c.id} />
                <button
                  type="submit"
                  className={cn(
                    "flex w-full flex-col items-start gap-0.5 rounded-sm px-3 py-2 text-left text-sm transition-colors",
                    "hover:bg-stone-100 dark:hover:bg-stone-800",
                    c.id === currentId && "bg-stone-50 dark:bg-stone-800",
                  )}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="truncate font-medium">{c.name}</span>
                    {c.id === currentId && (
                      <Check className="h-3 w-3 shrink-0 text-stone-700 dark:text-stone-300" />
                    )}
                  </div>
                  <span className="text-[10px] text-stone-500">
                    {c.outreachBrandName} · {c.crawlBrandName}
                  </span>
                </button>
              </form>
            </li>
          ))}
        </ul>
        {currentId && (
          <div className="border-stone-100 border-t p-1 dark:border-stone-800">
            <form action={switchCurrentCampaign}>
              <input type="hidden" name="campaignId" value="_clear" />
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                className="w-full justify-center text-stone-500 text-xs"
              >
                Clear selection
              </Button>
            </form>
          </div>
        )}
      </div>
    </details>
  );
}
