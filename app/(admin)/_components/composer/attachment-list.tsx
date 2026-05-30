"use client";

/**
 * AttachmentList — chip-style list of attached files.
 *
 * Current scope:
 *   v1 renders the chip UI + accepts drag-drop / file-input adds /
 *   removes. Files are HELD IN MEMORY ONLY — the actual upload to
 *   backend file storage (S3/GCS) is NOT wired. The composer makes
 *   this visible to the operator via the disclaimer banner.
 *
 *   Why ship the UI before the storage:
 *     - The data shape stabilises (the email_drafts.attachments
 *       JSONB column already matches { name, size, mime, storage_key })
 *     - Operators can scope what they'd attach without losing draft
 *       state
 *     - When storage lands (separate commit), it's a single network
 *       call swap inside onAdd() — no API churn upstream
 *
 *   When storage IS wired, the same chip list will render real
 *   upload progress (size already shown) + a clear "uploaded" badge.
 */

import { cn } from "@/lib/cn";
import { File as FileIcon, Paperclip, Upload, X } from "lucide-react";
import { useRef } from "react";
import type { ComposerAttachment } from "./composer-store";

interface Props {
  attachments: ComposerAttachment[];
  onChange: (next: ComposerAttachment[]) => void;
}

const MAX_FILE_BYTES = 25 * 1024 * 1024; // Gmail's stated max attachment size

export function AttachmentList({ attachments, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  function add(files: FileList | null) {
    if (!files) return;
    const next: ComposerAttachment[] = [...attachments];
    for (const f of Array.from(files)) {
      if (f.size > MAX_FILE_BYTES) {
        alert(`${f.name} is too large (${Math.round(f.size / 1024 / 1024)} MB). Max is 25 MB.`);
        continue;
      }
      next.push({
        id: crypto.randomUUID(),
        name: f.name,
        size: f.size,
        mime: f.type || "application/octet-stream",
        // TODO: upload f to storage here, set storage_key on resolve.
      });
    }
    onChange(next);
  }

  function remove(id: string) {
    onChange(attachments.filter((a) => a.id !== id));
  }

  return (
    <div className="flex flex-col gap-1">
      <div
        // Drag-drop target wraps the chip list + the upload button.
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(e) => {
          e.preventDefault();
          add(e.dataTransfer.files);
        }}
        className="flex flex-wrap items-center gap-1"
      >
        {attachments.map((a) => (
          <span
            key={a.id}
            title={a.name}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] dark:border-zinc-700 dark:bg-zinc-900"
          >
            <FileIcon className="h-2.5 w-2.5 text-zinc-500" />
            <span className="max-w-[140px] truncate">{a.name}</span>
            <span className="font-mono text-zinc-400">{formatBytes(a.size)}</span>
            <button
              type="button"
              onClick={() => remove(a.id)}
              aria-label={`Remove ${a.name}`}
              className="text-zinc-500 hover:text-rose-600"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          title="Attach files (drag-drop also works)"
          className={cn(
            "inline-flex items-center gap-1 rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
          )}
        >
          <Paperclip className="h-3 w-3" />
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => add(e.target.files)}
        />
      </div>
      {attachments.length > 0 && (
        <p className="font-mono text-[9px] text-amber-600 dark:text-amber-400">
          <Upload className="mr-0.5 inline h-2.5 w-2.5" />
          TODO: backend storage not yet wired — files held in memory only and won't actually attach
          to the sent email.
        </p>
      )}
    </div>
  );
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}
