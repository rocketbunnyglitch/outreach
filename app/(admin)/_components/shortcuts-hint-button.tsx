"use client";

import { useShortcutContext } from "@/components/ui/shortcut-provider";
import { Command } from "lucide-react";

/**
 * Tiny `⌘?` chip in the top nav that opens the shortcut cheatsheet.
 * Doubles as a discoverability cue — without this, the keyboard layer
 * is invisible to new staff.
 *
 * Hidden on mobile (no physical keyboard, no point).
 */
export function ShortcutsHintButton() {
  const ctx = useShortcutContext();

  return (
    <button
      type="button"
      onClick={() => ctx.showCheatsheet()}
      className="hidden items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em] transition-colors hover:border-zinc-400 hover:bg-zinc-50 hover:text-zinc-900 sm:inline-flex dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
      title="Keyboard shortcuts"
      aria-label="Keyboard shortcuts"
    >
      <Command className="h-2.5 w-2.5" />?
    </button>
  );
}
