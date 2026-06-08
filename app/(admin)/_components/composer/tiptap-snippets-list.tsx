"use client";

/**
 * SnippetsList -- popover under the caret when the operator types ";".
 * Mirrors SlashCommandsList: arrow-key nav, Enter/Tab to insert, mouse click.
 * Tab also commits (text-expander feel). The list ref is exposed so the
 * suggestion keydown hook can plumb keyboard events in.
 */

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import type { SnippetItem } from "./tiptap-snippets";

interface Props {
  items: SnippetItem[];
  command: (item: SnippetItem) => void;
}

export interface SnippetsListRef {
  onKeyDown: (e: { event: KeyboardEvent }) => boolean;
}

export const SnippetsList = forwardRef<SnippetsListRef, Props>(({ items, command }, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setSelectedIndex(0), [items.length]);

  function selectItem(index: number) {
    const item = items[index];
    if (item) command(item);
  }

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowUp") {
        setSelectedIndex((i) => (i + items.length - 1) % items.length);
        return true;
      }
      if (event.key === "ArrowDown") {
        setSelectedIndex((i) => (i + 1) % items.length);
        return true;
      }
      // Enter / Tab both insert -- Tab gives the quick text-expander feel.
      if (event.key === "Enter" || event.key === "Tab") {
        selectItem(selectedIndex);
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) return null;

  return (
    <div className="max-h-72 w-72 overflow-y-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
      {items.map((item, i) => {
        const active = i === selectedIndex;
        return (
          <button
            key={item.trigger}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => selectItem(i)}
            onMouseEnter={() => setSelectedIndex(i)}
            className={`flex w-full flex-col px-3 py-1.5 text-left text-xs ${
              active ? "bg-zinc-100 dark:bg-zinc-800" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
            }`}
          >
            <span className="flex items-center gap-1.5">
              <code className="rounded bg-zinc-100 px-1 py-0.5 text-[10px] dark:bg-zinc-800">
                ;{item.trigger}
              </code>
              <span className="font-medium">{item.label}</span>
            </span>
            <span className="mt-0.5 line-clamp-1 text-[10px] text-zinc-500">{item.body}</span>
          </button>
        );
      })}
    </div>
  );
});

SnippetsList.displayName = "SnippetsList";
