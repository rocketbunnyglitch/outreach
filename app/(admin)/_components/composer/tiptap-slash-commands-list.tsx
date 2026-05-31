"use client";

/**
 * SlashCommandsList — popover that renders the filtered command
 * list under the operator's caret when they type "/".
 *
 * Tiptap's suggestion plugin gives us mount/update/destroy
 * callbacks; we build a tiny imperative wrapper around a React
 * component that handles arrow-key navigation + Enter to select.
 *
 * The list ref is exposed so the parent's renderItems chain can
 * call list.onKeyDown(props) from within the suggestion
 * keydown hook — that's how Tiptap suggestion plumbs keyboard
 * events into the popover.
 */

import type { Editor } from "@tiptap/core";
import type { Range } from "@tiptap/core";
import { Heading1, Heading2, List, ListOrdered, Minus, Quote } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import type { SlashCommandItem } from "./tiptap-slash-commands";

interface Props {
  items: SlashCommandItem[];
  command: (item: SlashCommandItem) => void;
  editor: Editor;
  range: Range;
}

export interface SlashCommandsListRef {
  onKeyDown: (e: { event: KeyboardEvent }) => boolean;
}

const ICON_FOR_TITLE: Record<string, React.ComponentType<{ className?: string }>> = {
  "Heading 1": Heading1,
  "Heading 2": Heading2,
  "Bulleted list": List,
  "Numbered list": ListOrdered,
  Quote,
  Divider: Minus,
};

export const SlashCommandsList = forwardRef<SlashCommandsListRef, Props>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);

    // Reset selection when the filtered items change (operator
    // typed more characters and the list narrowed).
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
        if (event.key === "Enter") {
          selectItem(selectedIndex);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div className="w-64 rounded-lg border border-zinc-200 bg-white p-3 text-xs text-zinc-500 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
          No matching commands.
        </div>
      );
    }

    return (
      <div className="max-h-72 w-64 overflow-y-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
        {items.map((item, i) => {
          const Icon = ICON_FOR_TITLE[item.title];
          const active = i === selectedIndex;
          return (
            <button
              key={item.title}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => selectItem(i)}
              onMouseEnter={() => setSelectedIndex(i)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${
                active ? "bg-zinc-100 dark:bg-zinc-800" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
              }`}
            >
              {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-zinc-500" />}
              <span className="flex-1">
                <span className="block font-medium">{item.title}</span>
                <span className="block text-[10px] text-zinc-500">{item.description}</span>
              </span>
            </button>
          );
        })}
      </div>
    );
  },
);

SlashCommandsList.displayName = "SlashCommandsList";
