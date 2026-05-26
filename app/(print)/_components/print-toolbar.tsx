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
    <div className="no-print sticky top-0 z-50 flex items-center justify-between gap-4 border-stone-200 border-b bg-white px-6 py-3 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1 text-sm text-stone-500 underline hover:text-stone-900 dark:hover:text-stone-100"
      >
        <ArrowLeft className="h-3 w-3" /> {backLabel}
      </Link>
      <div className="flex items-center gap-3">
        {meta && (
          <span className="font-mono text-stone-500 text-xs uppercase tracking-widest">{meta}</span>
        )}
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-md bg-stone-900 px-3 py-1.5 font-medium text-sm text-stone-50 hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200"
        >
          <Printer className="h-4 w-4" />
          Print / Save as PDF
        </button>
      </div>
    </div>
  );
}
