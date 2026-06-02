"use client";

/**
 * RichTextEditor — Tiptap-backed contenteditable editor with a
 * Gmail-style toolbar.
 *
 * Same onChange({ text, html }) contract as the previous
 * execCommand-based implementation; the composer doesn't need to
 * change. Drop-in replacement.
 *
 * Why Tiptap (vs the previous execCommand path):
 *   - execCommand is deprecated and increasingly buggy in evergreen
 *     browsers (cursor handling, nested-list collapse, paste-from-
 *     Word artifacts)
 *   - Tiptap is built on ProseMirror — every formatting verb is a
 *     deterministic transaction, so undo/redo, multi-keystroke
 *     compositions (IME, Korean/Japanese input), and serialization
 *     all "just work"
 *   - Output remains plain HTML so the existing sanitiseEmailHtml
 *     pipeline (lib/email-sanitize.ts) continues to be the security
 *     boundary on send
 *
 * Toolbar (toggleable via the Aa button in the composer footer):
 *   Undo / Redo
 *   Font family (Sans Serif, Serif, Mono, Wide)
 *   Font size (Small, Normal, Large, Huge) via a custom FontSize mark
 *   Bold / Italic / Underline / Strikethrough
 *   Text color (8-swatch picker)
 *   Alignment (left / center / right / justify)
 *   Ordered / unordered list
 *   Indent in / Indent out (only meaningful inside lists)
 *   Link (with the existing https:// normalization)
 *   Remove formatting
 *
 * Bundle cost: Tiptap-core + StarterKit + extensions + ProseMirror
 * weighs in around 250KB minified. Bundled into the admin app
 * chunk; the composer lazy-mounts so the rest of the app doesn't
 * pay the cost until a draft is opened.
 *
 * Migration notes:
 *   - sanitiseHtml stays as a small named export so preview-modal
 *     (which only imports the sanitizer) keeps working with no
 *     changes
 *   - htmlToText is no longer needed — Tiptap's getText() does the
 *     right thing — but we kept a thin wrapper for compatibility
 *     with the previous output shape
 */

import { cn } from "@/lib/cn";
import Color from "@tiptap/extension-color";
import FontFamily from "@tiptap/extension-font-family";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import TextStyle from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import { BubbleMenu, type Editor, EditorContent, ReactRenderer, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
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
  Underline as UnderlineIcon,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import { FontSize } from "./tiptap-font-size";
import { SignatureBlock } from "./tiptap-signature-block";
import { SlashCommands } from "./tiptap-slash-commands";
import { SlashCommandsList, type SlashCommandsListRef } from "./tiptap-slash-commands-list";

interface Props {
  /** HTML representation (the canonical source for the editor). */
  valueHtml: string | null;
  /** Plain text representation, derived from HTML on every change. */
  valueText: string;
  onChange: (next: { text: string; html: string }) => void;
  placeholder?: string;
  className?: string;
  /** When true, the formatting toolbar above the editor is visible.
   *  The composer controls visibility via the Aa button in its
   *  footer. Defaults to true so existing callers keep their
   *  current behavior. */
  showToolbar?: boolean;
}

const FONT_SIZES: Array<{ label: string; value: string }> = [
  // px values that map roughly to the previous execCommand fontSize
  // scale (1-7). Operators recognize the labels, not the numbers.
  { label: "Small", value: "11px" },
  { label: "Normal", value: "14px" },
  { label: "Large", value: "18px" },
  { label: "Huge", value: "24px" },
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
  // Track last-emitted HTML so we don't re-seed the editor on our
  // own round-trip (which would jump the cursor to the start).
  const lastEmittedRef = useRef<string | null>(null);
  const [colorOpen, setColorOpen] = useState(false);
  const [fontOpen, setFontOpen] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      Color.configure({ types: ["textStyle"] }),
      FontFamily.configure({ types: ["textStyle"] }),
      FontSize.configure({ types: ["textStyle"] }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      SignatureBlock,
      Image.configure({
        // We constrain images to a sane inline width so a pasted
        // newsletter screenshot doesn't blow past the composer
        // edges. Operators can resize via attribute editing if we
        // ever add a node view; for now this is fine.
        HTMLAttributes: {
          class: "composer-inline-image",
        },
        // Don't auto-create images from URLs in the document — we
        // only want explicit insert via the photo button or paste.
        inline: false,
      }),
      Link.configure({
        // Open in a new tab when the user clicks a link inside the
        // editor (operator-facing convenience; doesn't affect the
        // final HTML which is rendered server-side anyway).
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: {
          rel: "noopener noreferrer",
          target: "_blank",
        },
      }),
      Placeholder.configure({
        placeholder: placeholder ?? "Write your message…",
      }),
      SlashCommands.configure({
        suggestion: {
          char: "/",
          startOfLine: false,
          // Tiptap calls render() with mount/update/destroy hooks.
          // We mount a ReactRenderer-wrapped SlashCommandsList into
          // a tippy.js popover anchored at the typed "/".
          render: () => {
            let component: ReactRenderer<SlashCommandsListRef> | null = null;
            let popup: TippyInstance | null = null;

            return {
              onStart: (props) => {
                component = new ReactRenderer(SlashCommandsList, {
                  props,
                  editor: props.editor,
                });
                const clientRect = props.clientRect?.();
                if (!clientRect) return;
                popup = tippy(document.body, {
                  getReferenceClientRect: () => clientRect,
                  appendTo: () => document.body,
                  content: component.element,
                  showOnCreate: true,
                  interactive: true,
                  trigger: "manual",
                  placement: "bottom-start",
                  // Keep within viewport — if the operator types "/" near
                  // the bottom of the composer, flip above.
                  popperOptions: {
                    modifiers: [{ name: "flip", enabled: true }],
                  },
                });
              },
              onUpdate: (props) => {
                component?.updateProps(props);
                const clientRect = props.clientRect?.();
                if (clientRect && popup) {
                  popup.setProps({ getReferenceClientRect: () => clientRect });
                }
              },
              onKeyDown: (props) => {
                if (props.event.key === "Escape") {
                  popup?.hide();
                  return true;
                }
                return component?.ref?.onKeyDown(props) ?? false;
              },
              onExit: () => {
                popup?.destroy();
                component?.destroy();
                popup = null;
                component = null;
              },
            };
          },
        },
      }),
    ],
    content: valueHtml ?? "",
    // ProseMirror logs an SSR warning if it tries to render server-
    // side. Defer attaching to the DOM until mount.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: cn(
          // White typing surface with dark text in BOTH themes (Gmail's
          // compose is always light) so the reply matches the white email
          // body you're reading and stays readable in dark mode.
          "min-h-[160px] flex-1 overflow-y-auto bg-white px-3 py-2 text-sm text-zinc-900 outline-none",
        ),
      },
    },
    onUpdate({ editor }) {
      const html = sanitiseHtml(editor.getHTML());
      const text = editor.getText();
      lastEmittedRef.current = html;
      onChange({ text, html });
    },
  });

  // Externally-driven valueHtml changes — re-seed when the caller's
  // value diverges from what we last emitted. Avoids the loop where
  // our own onChange round-trips back as a new valueHtml.
  useEffect(() => {
    if (!editor) return;
    if (valueHtml === null) return;
    if (valueHtml === lastEmittedRef.current) return;
    // setContent without emitting an update so we don't bounce.
    editor.commands.setContent(valueHtml, false);
    lastEmittedRef.current = valueHtml;
  }, [valueHtml, editor]);

  const insertLink = useCallback(() => {
    if (!editor) return;
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = prompt("Link URL", previous ?? "");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    const safe = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    editor.chain().focus().extendMarkRange("link").setLink({ href: safe }).run();
  }, [editor]);

  if (!editor) {
    return (
      <div className={cn("flex flex-col", className)}>
        <div className="min-h-[160px]" />
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col", className)}>
      {showToolbar && (
        <div className="flex shrink-0 flex-wrap items-center gap-0.5 border-zinc-200 border-b px-2 py-1 dark:border-zinc-800">
          <ToolbarButton
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().chain().focus().undo().run()}
            title="Undo (Cmd+Z)"
          >
            <Undo2 className="h-3 w-3" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().chain().focus().redo().run()}
            title="Redo (Cmd+Shift+Z)"
          >
            <Redo2 className="h-3 w-3" />
          </ToolbarButton>
          <Divider />
          <FontPopover
            open={fontOpen}
            setOpen={setFontOpen}
            onPickFamily={(v) => editor.chain().focus().setFontFamily(v).run()}
            onPickSize={(v) => editor.chain().focus().setFontSize(v).run()}
          />
          <Divider />
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            active={editor.isActive("bold")}
            title="Bold (Cmd+B)"
          >
            <Bold className="h-3 w-3" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            active={editor.isActive("italic")}
            title="Italic (Cmd+I)"
          >
            <Italic className="h-3 w-3" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            active={editor.isActive("underline")}
            title="Underline (Cmd+U)"
          >
            <UnderlineIcon className="h-3 w-3" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleStrike().run()}
            active={editor.isActive("strike")}
            title="Strikethrough"
          >
            <Strikethrough className="h-3 w-3" />
          </ToolbarButton>
          <ColorPopover
            open={colorOpen}
            setOpen={setColorOpen}
            onPick={(c) => editor.chain().focus().setColor(c).run()}
          />
          <Divider />
          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign("left").run()}
            active={editor.isActive({ textAlign: "left" })}
            title="Align left"
          >
            <AlignLeft className="h-3 w-3" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign("center").run()}
            active={editor.isActive({ textAlign: "center" })}
            title="Align center"
          >
            <AlignCenter className="h-3 w-3" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign("right").run()}
            active={editor.isActive({ textAlign: "right" })}
            title="Align right"
          >
            <AlignRight className="h-3 w-3" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign("justify").run()}
            active={editor.isActive({ textAlign: "justify" })}
            title="Justify"
          >
            <AlignJustify className="h-3 w-3" />
          </ToolbarButton>
          <Divider />
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            active={editor.isActive("orderedList")}
            title="Numbered list"
          >
            <ListOrdered className="h-3 w-3" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            active={editor.isActive("bulletList")}
            title="Bulleted list"
          >
            <List className="h-3 w-3" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().liftListItem("listItem").run()}
            disabled={!editor.can().chain().focus().liftListItem("listItem").run()}
            title="Decrease indent"
          >
            <Outdent className="h-3 w-3" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().sinkListItem("listItem").run()}
            disabled={!editor.can().chain().focus().sinkListItem("listItem").run()}
            title="Increase indent"
          >
            <Indent className="h-3 w-3" />
          </ToolbarButton>
          <Divider />
          <ToolbarButton onClick={insertLink} active={editor.isActive("link")} title="Insert link">
            <LinkIcon className="h-3 w-3" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
            title="Remove formatting"
          >
            <RemoveFormatting className="h-3 w-3" />
          </ToolbarButton>
        </div>
      )}
      <BubbleMenu
        editor={editor}
        // Render only on actual range selections (not just the caret),
        // and skip when the selection is inside the auto-managed
        // signature region — operators selecting their signature
        // shouldn't get a formatting prompt over auto-generated
        // content.
        shouldShow={({ editor, from, to }) => {
          if (from === to) return false;
          // Walk up the parent chain to check for signature ancestry.
          if (editor.isActive("signatureBlock")) return false;
          return true;
        }}
        // Tippy/Popper positioning options. Keep it close to the
        // selection and arrow-less so the floating pill reads as
        // contextual rather than a tooltip.
        tippyOptions={{
          duration: 80,
          placement: "top",
          arrow: false,
        }}
        className="pointer-events-auto flex items-center gap-0.5 rounded-md border border-zinc-200 bg-white px-1 py-0.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
      >
        <BubbleButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive("bold")}
          title="Bold"
        >
          <Bold className="h-3 w-3" />
        </BubbleButton>
        <BubbleButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive("italic")}
          title="Italic"
        >
          <Italic className="h-3 w-3" />
        </BubbleButton>
        <BubbleButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          active={editor.isActive("underline")}
          title="Underline"
        >
          <UnderlineIcon className="h-3 w-3" />
        </BubbleButton>
        <BubbleButton onClick={insertLink} active={editor.isActive("link")} title="Insert link">
          <LinkIcon className="h-3 w-3" />
        </BubbleButton>
      </BubbleMenu>
      <EditorContent editor={editor} className="flex-1 overflow-y-auto" />
    </div>
  );
}

function ToolbarButton({
  onClick,
  title,
  active,
  disabled,
  children,
}: {
  onClick: () => void;
  title: string;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      // Don't take focus when toolbar button clicked — keeps caret in
      // the editable area so the formatting applies to the right spot.
      onMouseDown={(e) => e.preventDefault()}
      className={cn(
        "rounded p-1 disabled:opacity-40",
        active
          ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100"
          : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-3 w-px bg-zinc-300 dark:bg-zinc-700" />;
}

/** Bubble-menu button — slightly tighter than ToolbarButton since
 *  the floating pill has less room than the top toolbar. */
function BubbleButton({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      className={cn(
        "rounded p-1",
        active
          ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100"
          : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
      )}
    >
      {children}
    </button>
  );
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
          className="absolute top-full left-0 z-30 mt-1 w-44 rounded-lg border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
        >
          <div className="mb-1.5 px-0.5 font-mono text-[9px] text-zinc-500 uppercase tracking-widest">
            Text color
          </div>
          <div className="grid grid-cols-4 gap-2">
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
                title={c}
                className="h-7 w-7 rounded-md border border-zinc-300 ring-offset-1 transition-transform hover:scale-110 hover:ring-2 hover:ring-zinc-400 dark:border-zinc-700 dark:hover:ring-zinc-500"
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onPick("inherit");
              setOpen(false);
            }}
            className="mt-2 w-full rounded px-2 py-1 text-left font-mono text-[10px] text-zinc-500 uppercase tracking-widest hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            Reset color
          </button>
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
 *
 * Tiptap already gives us reasonably-clean HTML (it serializes
 * from its ProseMirror schema rather than passing the raw DOM
 * through), but we keep this as defense-in-depth so a pasted-in
 * value with weird residue gets cleaned before any preview path.
 */
export function sanitiseHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "")
    .replace(/javascript:/gi, "");
}

/**
 * Compatibility shim — the previous implementation exported a
 * htmlToText helper for the composer to use when computing the
 * plain-text fallback. We don't need it anymore (Tiptap's
 * getText() is the source of truth) but the export stays so any
 * external consumer keeps compiling.
 */
export function htmlToText(node: HTMLElement | string): string {
  if (typeof node === "string") {
    // Best-effort browser-side strip — no DOM parsing.
    return node
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .trim();
  }
  return node.innerText.trim();
}

// Re-export the FontSize extension type so external callers can
// inspect the schema if they ever need to.
export type TiptapEditor = Editor;
