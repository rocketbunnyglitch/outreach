"use client";

/**
 * RichTextEditor — minimal contenteditable + execCommand-based
 * editor. Supports bold, italic, underline, ordered/unordered lists,
 * link insertion, and remove-formatting. No heavy dependency.
 *
 * Why contenteditable + execCommand:
 *   document.execCommand is deprecated but still widely supported
 *   in every evergreen browser and is the only zero-dependency path
 *   to rich text. Modern alternatives (Lexical, TipTap, Slate) pull
 *   in 30-100kb of runtime each. For an outreach composer that
 *   primarily handles short text + light formatting, execCommand
 *   is the right tradeoff.
 *
 *   If we ever need inline images, table support, or collaborative
 *   editing, swapping to Lexical here is a contained refactor —
 *   the parent only knows about onChange({text, html}).
 *
 * Output contract:
 *   onChange({ text, html })
 *     text: plain text fallback (current paragraph structure preserved
 *           via newlines; <br> collapsed)
 *     html: sanitised HTML (script tags + on* attrs stripped)
 *
 * Sanitisation:
 *   The composer ALSO calls a server-side sanitiser when sending,
 *   so this is defense-in-depth rather than the security boundary.
 *   We strip the obvious vectors here so paste-from-Word can't
 *   inject runtime JS into a casually-rendered preview.
 */

import { cn } from "@/lib/cn";
import {
  Bold,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Type as RemoveFormatting,
  Underline,
} from "lucide-react";
import { useCallback, useEffect, useRef } from "react";

interface Props {
  /** HTML representation (the canonical source for the editor). */
  valueHtml: string | null;
  /** Plain text representation, derived from HTML on every change. */
  valueText: string;
  onChange: (next: { text: string; html: string }) => void;
  placeholder?: string;
  className?: string;
}

export function RichTextEditor({ valueHtml, onChange, placeholder, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // Track last-emitted HTML so we can avoid re-syncing the DOM (which
  // would reset the operator's cursor) when value updates come from
  // our own onChange round-trip.
  const lastEmittedRef = useRef<string | null>(null);

  // Initial mount: seed innerHTML from valueHtml.
  useEffect(() => {
    if (!ref.current) return;
    if (valueHtml !== null && valueHtml !== lastEmittedRef.current) {
      ref.current.innerHTML = valueHtml;
      lastEmittedRef.current = valueHtml;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueHtml]);

  const emit = useCallback(() => {
    if (!ref.current) return;
    const rawHtml = ref.current.innerHTML;
    const html = sanitiseHtml(rawHtml);
    const text = htmlToText(ref.current);
    lastEmittedRef.current = html;
    onChange({ text, html });
  }, [onChange]);

  /**
   * Apply a formatting command. document.execCommand is deprecated
   * but still the cheapest path to rich text without pulling in
   * Lexical. If we ever migrate, this is the single integration
   * point that changes.
   */
  function exec(cmd: string, arg?: string) {
    ref.current?.focus();
    // biome-ignore lint/suspicious/noExplicitAny: legacy execCommand surface
    (document as any).execCommand(cmd, false, arg);
    emit();
  }

  function insertLink() {
    const url = prompt("Link URL");
    if (!url) return;
    const safe = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    exec("createLink", safe);
  }

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="flex shrink-0 items-center gap-0.5 border-zinc-200 border-b px-2 py-1 dark:border-zinc-800">
        <ToolbarButton onClick={() => exec("bold")} title="Bold (Cmd+B)">
          <Bold className="h-3 w-3" />
        </ToolbarButton>
        <ToolbarButton onClick={() => exec("italic")} title="Italic (Cmd+I)">
          <Italic className="h-3 w-3" />
        </ToolbarButton>
        <ToolbarButton onClick={() => exec("underline")} title="Underline (Cmd+U)">
          <Underline className="h-3 w-3" />
        </ToolbarButton>
        <span className="mx-1 h-3 w-px bg-zinc-300 dark:bg-zinc-700" />
        <ToolbarButton onClick={() => exec("insertUnorderedList")} title="Bulleted list">
          <List className="h-3 w-3" />
        </ToolbarButton>
        <ToolbarButton onClick={() => exec("insertOrderedList")} title="Numbered list">
          <ListOrdered className="h-3 w-3" />
        </ToolbarButton>
        <span className="mx-1 h-3 w-px bg-zinc-300 dark:bg-zinc-700" />
        <ToolbarButton onClick={insertLink} title="Insert link">
          <LinkIcon className="h-3 w-3" />
        </ToolbarButton>
        <ToolbarButton onClick={() => exec("removeFormat")} title="Remove formatting">
          <RemoveFormatting className="h-3 w-3" />
        </ToolbarButton>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder ?? "Write your message…"}
        onInput={emit}
        onBlur={emit}
        tabIndex={0}
        role="textbox"
        aria-multiline="true"
        className={cn(
          "min-h-[160px] flex-1 overflow-y-auto bg-transparent px-3 py-2 text-sm outline-none",
          // Placeholder shimmed via data-placeholder + :empty:before
          // injected at the consuming page-level CSS. For now use
          // a tailwind-friendly variant via 'empty:before:content-[attr(data-placeholder)]'.
          "empty:before:pointer-events-none empty:before:text-zinc-400 empty:before:content-[attr(data-placeholder)]",
        )}
      />
    </div>
  );
}

function ToolbarButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      // Don't take focus when toolbar button clicked — keeps caret in
      // the editable area so the formatting applies to the right spot.
      onMouseDown={(e) => e.preventDefault()}
      className="rounded p-1 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
    >
      {children}
    </button>
  );
}

/**
 * Strip dangerous HTML constructs. Conservative allow-list:
 *   - Strip <script>, <style>, <iframe>, <object>, <embed>, <link>
 *   - Strip on* event handler attributes
 *   - Strip javascript: URLs in href/src
 *   - Leave the rest (this is operator-authored content, not
 *     untrusted user input — but defense-in-depth)
 */
export function sanitiseHtml(html: string): string {
  // Parse via a detached document fragment so we walk a real DOM
  // rather than running regex against potentially-broken HTML.
  if (typeof document === "undefined") return html;
  const tmpl = document.createElement("template");
  tmpl.innerHTML = html;
  const root = tmpl.content;

  const FORBIDDEN_TAGS = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META"]);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  const toRemove: Element[] = [];
  let n: Node | null = walker.nextNode();
  while (n !== null) {
    if (n instanceof Element) {
      if (FORBIDDEN_TAGS.has(n.tagName)) {
        toRemove.push(n);
      } else {
        // Strip on* attributes + dangerous URL schemes.
        for (const attr of Array.from(n.attributes)) {
          if (attr.name.toLowerCase().startsWith("on")) {
            n.removeAttribute(attr.name);
          } else if (
            (attr.name === "href" || attr.name === "src") &&
            /^\s*javascript:/i.test(attr.value)
          ) {
            n.removeAttribute(attr.name);
          }
        }
      }
    }
    n = walker.nextNode();
  }
  for (const el of toRemove) el.remove();
  return tmpl.innerHTML;
}

/**
 * Extract plain text from a DOM node, preserving paragraph + br
 * boundaries as newlines. <li> items get a leading bullet so the
 * plaintext fallback is still readable.
 */
function htmlToText(root: Element): string {
  const parts: string[] = [];
  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent ?? "");
      return;
    }
    if (!(node instanceof Element)) return;
    const tag = node.tagName;
    if (tag === "BR") {
      parts.push("\n");
      return;
    }
    if (tag === "LI") {
      parts.push("• ");
    }
    for (const child of Array.from(node.childNodes)) walk(child);
    if (tag === "P" || tag === "DIV" || tag === "LI" || tag === "BR") {
      parts.push("\n");
    }
  }
  for (const child of Array.from(root.childNodes)) walk(child);
  return parts
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
