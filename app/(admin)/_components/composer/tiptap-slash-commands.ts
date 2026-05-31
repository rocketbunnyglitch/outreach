/**
 * SlashCommands — Tiptap extension that lets the operator type
 * "/" at the start of a line (or after whitespace) to summon a
 * dropdown of insertable blocks.
 *
 * Built on @tiptap/suggestion, the same primitive Mentions and
 * Emoji use. The popover is React via the renderItems callback
 * we attach below — see SlashCommandsList in rich-text-editor.tsx
 * which is the actual rendered list component.
 *
 * The available commands are deliberately small — operators do
 * email, not Notion-style block editing. Each command runs a
 * single Tiptap chain that replaces the typed "/" prefix with
 * the chosen block:
 *
 *   /h1   Heading 1
 *   /h2   Heading 2
 *   /list Bulleted list
 *   /num  Numbered list
 *   /quote Blockquote
 *   /hr   Horizontal rule
 *
 * Filtering is substring-match on the command name + aliases, so
 * "/bul" finds /list (alias "bullet") and "/ord" finds /num
 * (alias "ordered").
 */

import { type Editor, Extension, type Range } from "@tiptap/core";
import type { SuggestionOptions } from "@tiptap/suggestion";
import Suggestion from "@tiptap/suggestion";

export interface SlashCommandItem {
  /** Display title in the popover row. */
  title: string;
  /** Short description below the title. */
  description: string;
  /** Searchable terms — typed prefix matches any of these. */
  searchTerms: string[];
  /** Executed when the operator picks this item. The handler
   *  receives the editor + the Range that the "/<query>" text
   *  occupies, so it can delete the placeholder first. */
  command: (opts: { editor: Editor; range: Range }) => void;
}

export const SLASH_COMMAND_ITEMS: SlashCommandItem[] = [
  {
    title: "Heading 1",
    description: "Large section header",
    searchTerms: ["h1", "heading", "title"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run();
    },
  },
  {
    title: "Heading 2",
    description: "Medium section header",
    searchTerms: ["h2", "heading", "subtitle"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run();
    },
  },
  {
    title: "Bulleted list",
    description: "Plain bullet list",
    searchTerms: ["list", "bullet", "ul"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run();
    },
  },
  {
    title: "Numbered list",
    description: "Auto-incrementing numbered list",
    searchTerms: ["num", "ordered", "ol", "number"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run();
    },
  },
  {
    title: "Quote",
    description: "Indented block quote",
    searchTerms: ["quote", "blockquote", "cite"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBlockquote().run();
    },
  },
  {
    title: "Divider",
    description: "Horizontal rule",
    searchTerms: ["hr", "divider", "line", "rule"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().run();
    },
  },
];

/**
 * Filter the command list by the typed query. Empty query returns
 * everything (so just "/" pops the full menu). Match is
 * case-insensitive substring against the title + every searchTerm.
 */
export function filterSlashCommands(query: string): SlashCommandItem[] {
  if (!query.trim()) return SLASH_COMMAND_ITEMS;
  const q = query.toLowerCase().trim();
  return SLASH_COMMAND_ITEMS.filter((item) => {
    if (item.title.toLowerCase().includes(q)) return true;
    return item.searchTerms.some((term) => term.includes(q));
  });
}

export interface SlashCommandsOptions {
  suggestion: Omit<SuggestionOptions<SlashCommandItem>, "editor">;
}

export const SlashCommands = Extension.create<SlashCommandsOptions>({
  name: "slashCommands",

  addOptions() {
    return {
      suggestion: {
        char: "/",
        // Only trigger at start of line or after whitespace so a
        // mid-word "/" doesn't accidentally summon the menu.
        startOfLine: false,
        // Run our command when the operator picks an item — props is
        // the SlashCommandItem we returned from items().
        command: ({
          editor,
          range,
          props,
        }: {
          editor: unknown;
          range: unknown;
          props: { command: (args: { editor: unknown; range: unknown }) => void };
        }) => {
          props.command({ editor, range });
        },
        items: ({ query }: { query: string }) => filterSlashCommands(query),
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});
