"use client";

import { Button } from "@/components/ui/button";
import { ChevronLeft, Printer } from "lucide-react";
import Link from "next/link";

interface Props {
  cityCampaignId: string;
  cityName: string;
}

/**
 * Action bar shown on screen with Print + back-to-city-sheet
 * controls. Hidden via the `print:hidden` Tailwind utility so it
 * doesn't show up in the printed output.
 */
export function PrintActions({ cityCampaignId, cityName }: Props) {
  return (
    <div className="sticky top-0 z-50 border-zinc-200 border-b bg-white/95 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/95 print:hidden">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-6 py-3">
        <div className="flex items-center gap-3">
          <Link
            href={`/city-campaigns/${cityCampaignId}`}
            className="inline-flex items-center gap-1 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.14em] underline-offset-4 hover:text-zinc-900 hover:underline dark:hover:text-zinc-100"
          >
            <ChevronLeft className="h-3 w-3" /> Back to {cityName}
          </Link>
          <span className="font-mono text-[10px] text-zinc-400 uppercase tracking-[0.12em]">
            · print preview
          </span>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => window.print()}
          className="bg-zinc-900 text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          <Printer className="h-3 w-3" /> Print or Save PDF
        </Button>
      </div>
      <p className="mx-auto max-w-5xl px-6 pb-2 font-mono text-[10px] text-zinc-500">
        Cmd/Ctrl+P to print · Pages auto-break between crawls · Use system "Save as PDF" for digital
        distribution
      </p>
    </div>
  );
}
