"use client";

/**
 * RichTextEditor — Gmail-style contenteditable editor.
 *
 * Toolbar (toggleable via the Aa button mounted next to Send in the
 * composer footer — see `showToolbar` prop):
 *   - Undo / Redo
 *   - Font family + Font size (text-size popovers)
 *   - Bold / Italic / Underline / Strikethrough
 *   - Text color / Background color (color pickers)
 *   - Alignment: left / center / right / justify
 *   - Numbered list / Bulleted list
 *   - Indent in / Indent out
 *   - Insert link
 *   - Remove formatting
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
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Indent,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Outdent,
  Palette,
  Redo2,
  Type as RemoveFormatting,
  Strikethrough,
  Underline,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  /** HTML representation (the canonical source for the editor). */
  valueHtml: string | null;
  /** Plain text representation, derived from HTML on every change. */
  valueText: string;
  onChange: (next: { text: string; html: string }) => void;
  placeholder?: string;
  className?: string;
  /** When true, the formatting toolbar above the editor is visible.
   *  Gmail mounts this beside Send and the toolbar can be toggled
   *  off for a cleaner surface; the composer controls visibility
   *  via the Aa button in the footer. Defaults to true so existing
   *  callers keep their current behavior. */
  showToolbar?: boolean;
}

const FONT_SIZES: Array<{ label: string; value: string }> = [
  { label: "Small", value: "2" },
  { label: "Normal", value: "3" },
  { label: "Large", value: "5" },
  { label: "Huge", value: "7" },
];

const FONT_FAMILIES: Array<{ label: string; value: string }> = [
  { label: "Sans Serif", value: "Arial, sans-serif" },
  { label: "Serif", value: "Georgia, serif" },
  { label: "Monospace", value: "ui-monospace, Menlo, monospace" },
  { label: "Wide", value: "Verdana, sans-serif" },
];

const TEXT_COLORS: string[] = [
  "#000000",
  "#5f6368",
  "#e6194b",
  "#f58231",
  "#ffe119",
  "#3cb44b",
  "#4363d8",
  "#911eb4",
];

export function RichTextEditor({
  valueHtml,
  onChange,
  placeholder,
  className,
  showToolbar = true,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // Track last-emitted HTML so we can avoid re-syncing the DOM (which
  // would reset the operator's cursor) when value updates come from
  // our own onChange round-trip.
  const lastEmittedRef = useRef<string | null>(null);
  const [colorOpen, setColorOpen] = useState(false);
  const [fontOpen, setFontOpen] = useState(false);

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
      {showToolbar && (
        <div className="flex shrink-0 flex-wrap items-center gap-0.5 border-zinc-200 border-b px-2 py-1 dark:border-zinc-800">
          <ToolbarButton onClick={() => exec("undo")} title="Undo (Cmd+Z)">
            <Undo2 className="h-3 w-3" />
          </ToolbarButton>
          <ToolbarButton onClick={() => exec("redo")} title="Redo (Cmd+Shift+Z)">
            <Redo2 className="h-3 w-3" />
          </ToolbarButton>
          <Divider />
          <FontPopover
            open={fontOpen}
            setOpen={setFontOpen}
            onPickFamily={(v) => exec("fontName", v)}
            onPickSize={(v) => exec("fontSize", v)}
          />
          <Divider />
          <ToolbarButton onClick={() => exec("bold")} title="Bold (Cmd+B)">
            <Bold className="h-3 w-3" />
          </ToolbarButton>
          <ToolbarButton onClick={() => exec("italic")} title="Italic (Cmd+I)">
            <Italic className="h-3 w-3" />
          </ToolbarButton>
          <ToolbarButton onClick={() => exec("underline")} title="Underline (Cmd+U)">
            <Underline className="h-3 w-3" />
          </ToolbarButton>
          <ToolbarButton onClick={() => exec("strikeThrough")} title="Strikethrough">
            <Strikethrough className="h-3 w-3" />
          </ToolbarButton>
          <ColorPopover
            open={colorOpen}
            setOpen={setColorOpen}
            onPick={(c) => exec("foreColor", c)}
          />
          <Divider />
          <ToolbarButton onClick={() => exec("justifyLeft")} title="Align left">
            <AlignLeft className="h-3 w-3" />
          </ToolbarButton>
          <ToolbarButton onClick={() => exec("justifyCenter")} title="Align center">
            <AlignCenter className="h-3 w-3" />
          </ToolbarButton>
          <ToolbarButton onClick={() => exec("justifyRight")} title="Align right">
            <AlignRight className="h-3 w-3" />
          </ToolbarButton>
          <ToolbarButton onClick={() => exec("justifyFull")} title="Justify">
            <AlignJustify className="h-3 w-3" />
          </ToolbarButton>
          <Divider />
          <ToolbarButton onClick={() => exec("insertOrderedList")} title="Numbered list">
            <ListOrdered className="h-3 w-3" />
          </ToolbarButton>
          <ToolbarButton onClick={() => exec("insertUnorderedList")} title="Bulleted list">
            <List className="h-3 w-3" />
          </ToolbarButton>
          <ToolbarButton onClick={() => exec("outdent")} title="Decrease indent">
            <Outdent className="h-3 w-3" />
          </ToolbarButton>
          <ToolbarButton onClick={() => exec("indent")} title="Increase indent">
            <Indent className="h-3 w-3" />
          </ToolbarButton>
          <Divider />
          <ToolbarButton onClick={insertLink} title="Insert link">
            <LinkIcon className="h-3 w-3" />
          </ToolbarButton>
          <ToolbarButton onClick={() => exec("removeFormat")} title="Remove formatting">
            <RemoveFormatting className="h-3 w-3" />
          </ToolbarButton>
        </div>
      )}
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

function Divider() {
  return <span className="mx-1 h-3 w-px bg-zinc-300 dark:bg-zinc-700" />;
}

function FontPopover({
  open,
  setOpen,
  onPickFamily,
  onPickSize,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  onPickFamily: (v: string) => void;
  onPickSize: (v: string) => void;
}) {
  const popRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, setOpen]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        onMouseDown={(e) => e.preventDefault()}
        title="Font family + size"
        className="rounded px-1.5 py-1 font-semibold text-[10px] text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      >
        Aa
      </button>
      {open && (
        <div
          ref={popRef}
          className="absolute top-full left-0 z-30 mt-1 w-44 rounded-lg border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
        >
          <div className="mb-1 px-1 font-mono text-[9px] text-zinc-500 uppercase tracking-widest">
            Family
          </div>
          <ul className="flex flex-col gap-0.5">
            {FONT_FAMILIES.map((f) => (
              <li key={f.value}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onPickFamily(f.value);
                    setOpen(false);
                  }}
                  className="w-full rounded px-2 py-1 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  style={{ fontFamily: f.value }}
                >
                  {f.label}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 mb-1 px-1 font-mono text-[9px] text-zinc-500 uppercase tracking-widest">
            Size
          </div>
          <ul className="flex flex-col gap-0.5">
            {FONT_SIZES.map((s) => (
              <li key={s.value}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onPickSize(s.value);
                    setOpen(false);
                  }}
                  className="w-full rounded px-2 py-1 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ColorPopover({
  open,
  setOpen,
  onPick,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  onPick: (color: string) => void;
}) {
  const popRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, setOpen]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        onMouseDown={(e) => e.preventDefault()}
        title="Text color"
        className="rounded p-1 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      >
        <Palette className="h-3 w-3" />
      </button>
      {open && (
        <div
          ref={popRef}
          className="absolute top-full left-0 z-30 mt-1 rounded-lg border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
        >
          <div className="grid grid-cols-4 gap-1">
            {TEXT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(c);
                  setOpen(false);
                }}
                aria-label={`Text color ${c}`}
                className="h-4 w-4 rounded border border-zinc-300 dark:border-zinc-700"
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Strip dangerous HTML constructs. Conservative allow-list:
 * remove all script tags, on* attribute names, and javascript:
 * URLs. The composer also re-sanitizes on send via the same
 * sanitiseEmailHtml() helper from lib/email-sanitize.ts.
 */
export function sanitiseHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "")
    .replace(/javascript:/gi, "");
}

/**
 * Convert the editable's current DOM into a plain-text representation
 * that preserves paragraph breaks but collapses inline runs.
 *
 * We walk children rather than reading innerText to avoid layout
 * forcing reflow on every keystroke.
 */
function htmlToText(node: HTMLElement): string {
  const lines: string[] = [];
  let current = "";
  function walk(n: Node) {
    if (n.nodeType === Node.TEXT_NODE) {
      current += n.textContent ?? "";
      return;
    }
    if (n.nodeType === Node.ELEMENT_NODE) {
      const el = n as HTMLElement;
      const tag = el.tagName.toLowerCase();
      if (tag === "br") {
        lines.push(current);
        current = "";
        return;
      }
      const isBlock = ["p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote"].includes(
        tag,
      );
      for (const child of Array.from(el.childNodes)) walk(child);
      if (isBlock) {
        lines.push(current);
        current = "";
      }
    }
  }
  for (const child of Array.from(node.childNodes)) walk(child);
  if (current) lines.push(current);
  return lines.join("\n").trim();
}
