"use client";

/**
 * PreviewModal — read-only render of the final email as it'll arrive.
 *
 * Shows:
 *   - From line (inbox emailAddress)
 *   - To / Cc / Bcc lines (only fields with content)
 *   - Subject line
 *   - Body — renders the sanitised HTML (or wraps plain text in <pre>)
 *
 * The signature block is rendered alongside the body so the operator
 * sees exactly what the recipient gets. Attachments are listed in a
 * footer note since v1 doesn't actually attach files yet (TODO).
 *
 * Pure dialog overlay — Esc closes, click-outside closes, no
 * interactivity beyond Close.
 */

import { useFocusTrap } from "@/lib/use-focus-trap";
import { X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { ComposerInstance } from "./composer-store";
import { sanitiseHtml } from "./rich-text-editor";

interface Props {
  instance: ComposerInstance;
  fromEmailAddress: string | null;
  onClose: () => void;
}

export function PreviewModal({ instance, fromEmailAddress, onClose }: Props) {
  // Esc closes.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const trapRef = useFocusTrap<HTMLDivElement>(true);

  if (typeof document === "undefined") return null;

  const bodyHtml = instance.bodyHtml
    ? sanitiseHtml(instance.bodyHtml)
    : `<pre style="font:inherit;white-space:pre-wrap;margin:0">${escapeText(
        instance.bodyText,
      )}</pre>`;

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Email preview"
    >
      <div
        ref={trapRef}
        tabIndex={-1}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-2xl outline-none dark:border-zinc-800 dark:bg-zinc-950"
      >
        <header className="flex items-center justify-between gap-2 border-zinc-200 border-b bg-zinc-50 px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="font-medium text-sm">Preview — final email</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="rounded p-1 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-3 text-sm">
          <div className="mb-3 space-y-0.5 border-zinc-200 border-b pb-2 text-xs dark:border-zinc-800">
            <Field label="From" value={fromEmailAddress ?? "— not selected —"} />
            <Field label="To" value={instance.to || "—"} />
            {instance.cc && <Field label="Cc" value={instance.cc} />}
            {instance.bcc && <Field label="Bcc" value={instance.bcc} />}
            <Field label="Subject" value={instance.subject || "(no subject)"} bold />
          </div>
          <div
            className="prose prose-sm dark:prose-invert max-w-none"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: html is sanitised above
            dangerouslySetInnerHTML={{ __html: bodyHtml }}
          />
          {instance.attachments.length > 0 && (
            <div className="mt-4 border-zinc-200 border-t pt-2 text-[10px] dark:border-zinc-800">
              <p className="font-mono text-zinc-500 uppercase tracking-widest">
                Attachments ({instance.attachments.length})
              </p>
              <ul className="mt-1 space-y-0.5">
                {instance.attachments.map((a) => (
                  <li key={a.id} className="font-mono text-zinc-600 dark:text-zinc-400">
                    {a.name} · {formatBytes(a.size)}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[9px] text-amber-600 dark:text-amber-400">
                TODO: backend storage not yet wired — attachments will not actually be sent.
              </p>
            </div>
          )}
        </div>
        <footer className="border-zinc-200 border-t bg-zinc-50 px-4 py-2 text-[10px] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
          This is a read-only preview. Close it and click Send to actually dispatch the email.
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function Field({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <p className="flex gap-2">
      <span className="w-14 shrink-0 text-zinc-500">{label}</span>
      <span className={bold ? "font-medium" : ""}>{value}</span>
    </p>
  );
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}
