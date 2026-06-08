/**
 * SnippetExpander -- Tiptap extension that lets the operator type ";trigger"
 * to insert a team snippet at the caret. Built on @tiptap/suggestion, the same
 * primitive SlashCommands uses.
 *
 * The available snippets are dynamic (loaded per compose window, merge-rendered
 * against the email's context), so they live in the extension's STORAGE -- the
 * editor host (rich-text-editor.tsx) writes editor.storage.snippetExpander.items
 * whenever the list changes, and items() reads from there.
 *
 * Bodies are pre-rendered (merge fields already substituted) by the composer,
 * so inserting is just an escaped-text drop -- no send-path involvement.
 */

import { type Editor, Extension, type Range } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import type { SuggestionOptions } from "@tiptap/suggestion";
import Suggestion from "@tiptap/suggestion";

// Distinct plugin key. @tiptap/suggestion defaults every Suggestion plugin to
// the key "suggestion", so a SECOND suggestion extension (we already ship the
// "/" SlashCommands one) collides -> ProseMirror throws "Adding different
// instances of a keyed plugin (suggestion$)" and the whole editor fails to
// build (the composer then renders nothing). A unique key per suggestion
// extension is the documented fix for running more than one.
const SNIPPET_SUGGESTION_KEY = new PluginKey("snippetExpander");

export interface SnippetItem {
  trigger: string;
  label: string;
  /** Body with merge fields already rendered, ready to insert. */
  body: string;
}

interface SnippetStorage {
  items: SnippetItem[];
}

/** Escape text so an operator-authored snippet body can't inject markup. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Filter the snippet list by the typed query (prefix on trigger, substring on
 *  label). Empty query returns the first few so just ";" previews the set. */
export function filterSnippets(items: SnippetItem[], query: string): SnippetItem[] {
  const q = query.toLowerCase().trim();
  if (!q) return items.slice(0, 8);
  return items
    .filter((s) => s.trigger.toLowerCase().startsWith(q) || s.label.toLowerCase().includes(q))
    .slice(0, 8);
}

export interface SnippetExpanderOptions {
  suggestion: Omit<SuggestionOptions<SnippetItem>, "editor">;
}

export const SnippetExpander = Extension.create<SnippetExpanderOptions, SnippetStorage>({
  name: "snippetExpander",

  addStorage() {
    return { items: [] };
  },

  addOptions() {
    return {
      suggestion: {
        char: ";",
        startOfLine: false,
        // Insert the picked snippet's (already merge-rendered) body, preserving
        // line breaks as <br>. Replace the typed ";query" range first.
        command: ({
          editor,
          range,
          props,
        }: {
          editor: Editor;
          range: Range;
          props: SnippetItem;
        }) => {
          const html = escapeHtml(props.body).replace(/\n/g, "<br>");
          editor.chain().focus().deleteRange(range).insertContent(html).run();
        },
        items: ({ query, editor }: { query: string; editor: Editor }) => {
          const storage = editor.storage.snippetExpander as SnippetStorage | undefined;
          return filterSnippets(storage?.items ?? [], query);
        },
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
        // Force a unique key so this doesn't collide with SlashCommands'
        // default "suggestion" key (placed AFTER the spread so nothing overrides it).
        pluginKey: SNIPPET_SUGGESTION_KEY,
      }),
    ];
  },
});
