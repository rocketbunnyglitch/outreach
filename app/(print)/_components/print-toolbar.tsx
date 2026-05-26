"use client";

import { ArrowLeft, Printer } from "lucide-react";
import Link from "next/link";

interface Props {
  backHref: string;
  backLabel: string;
  meta?: string;
}

/**
 * Small floating toolbar that appears on screen but hides in print.
 * Has a back link and a print button that triggers window.print().
 */
export function PrintToolbar({ backHref, backLabel, meta }: Props) {
  return (
    <div className="no-print sticky top-0 z-50 flex items-center justify-between gap-4 border-zinc-200 border-b bg-white px-6 py-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1 text-sm text-zinc-500 underline hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        <ArrowLeft className="h-3 w-3" /> {backLabel}
      </Link>
      <div className="flex items-center gap-3">
        {meta && (
          <span className="font-mono text-xs text-zinc-500 uppercase tracking-widest">{meta}</span>
        )}
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-sm text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          <Printer className="h-4 w-4" />
          Print / Save as PDF
        </button>
      </div>
    </div>
  );
}
