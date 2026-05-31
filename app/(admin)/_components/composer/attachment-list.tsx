"use client";

/**
 * AttachmentList — chip-style list of attached files.
 *
 * Storage flow:
 *   1. On mount, probeAttachmentsEnabled returns whether object
 *      storage is configured on this deployment. If not, the
 *      paperclip button renders disabled with an explanatory
 *      tooltip — operators can't get into a state where they
 *      attach files that won't actually upload.
 *   2. Operator picks/drops a file
 *   3. Client calls createAttachmentUpload action -> signed PUT URL
 *   4. Client PUTs the file directly to object storage (bypasses
 *      Next route handlers + body-size limits)
 *   5. On success, the chip's storage_key is set and the parent
 *      composer's upsertDraft persists the attachment record on its
 *      next autosave tick
 *
 *   The legacy "memory_only" chip state is kept in the type union
 *   for backward compat with old drafts that may carry chips
 *   created before this probe existed, but the paperclip-gate
 *   means no NEW chip lands there.
 *
 *   Chip states:
 *     uploading   — spinner; PUT in flight
 *     uploaded    — green check; storage_key set
 *     memory_only — amber warning; legacy / unreachable for new picks
 *     error       — rose; remove + retry via the X button
 */

import { cn } from "@/lib/cn";
import { Check, File as FileIcon, Loader2, Paperclip, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createAttachmentUpload, probeAttachmentsEnabled } from "../../_actions/email-drafts";
import type { ComposerAttachment } from "./composer-store";

interface Props {
  /** Draft id — attachments are scoped under it on the server. */
  draftId: string;
  attachments: ComposerAttachment[];
  onChange: (
    next: ComposerAttachment[] | ((prev: ComposerAttachment[]) => ComposerAttachment[]),
  ) => void;
}

const MAX_FILE_BYTES = 25 * 1024 * 1024; // Gmail's stated max attachment size

type ChipState = "uploading" | "uploaded" | "memory_only" | "error";

export function AttachmentList({ draftId, attachments, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Per-chip transient state (upload progress + error string). Keyed
  // by attachment.id; only entries for in-flight or failed uploads
  // exist here. Saved attachments derive state from storage_key.
  const [transient, setTransient] = useState<Record<string, { state: ChipState; error?: string }>>(
    {},
  );
  // null = probe in flight; boolean = result. While in flight we
  // optimistically enable the paperclip so a fast-clicker doesn't
  // get a dead button on a snappy network; the actual upload path
  // re-checks via createAttachmentUpload anyway.
  const [storageEnabled, setStorageEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    probeAttachmentsEnabled()
      .then((r) => setStorageEnabled(r.enabled))
      .catch(() => setStorageEnabled(false));
  }, []);
  // Render-time gate: disable the paperclip only after we know
  // storage is unavailable. Probe-pending state stays enabled.
  const attachmentsDisabled = storageEnabled === false;

  function setChip(id: string, patch: { state: ChipState; error?: string }) {
    setTransient((prev) => ({ ...prev, [id]: patch }));
  }
  function clearChip(id: string) {
    setTransient((prev) => {
      const { [id]: _drop, ...rest } = prev;
      return rest;
    });
  }

  async function add(files: FileList | null) {
    if (!files) return;
    for (const f of Array.from(files)) {
      if (f.size > MAX_FILE_BYTES) {
        alert(`${f.name} is too large (${Math.round(f.size / 1024 / 1024)} MB). Max is 25 MB.`);
        continue;
      }
      const id = crypto.randomUUID();
      // Add the chip optimistically with no storage_key; mark
      // uploading transient state.
      const chip: ComposerAttachment = {
        id,
        name: f.name,
        size: f.size,
        mime: f.type || "application/octet-stream",
      };
      onChange((prev) => [...prev, chip]);
      setChip(id, { state: "uploading" });
      try {
        const res = await createAttachmentUpload({
          draftId,
          filename: f.name,
          mime: chip.mime,
          sizeBytes: f.size,
        });
        if (!res.ok) {
          setChip(id, { state: "error", error: res.error });
          continue;
        }
        if (!res.data.enabled) {
          // Storage not configured; leave chip in memory-only state.
          setChip(id, { state: "memory_only" });
          continue;
        }
        // Upload directly to object storage.
        const putRes = await fetch(res.data.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": res.data.contentType },
          body: f,
        });
        if (!putRes.ok) {
          setChip(id, { state: "error", error: `Upload failed (${putRes.status})` });
          continue;
        }
        // Persist storage_key onto the chip — parent's autosave will
        // pick it up. Use functional update so concurrent uploads
        // don't stomp each other.
        const storageKey = res.data.storageKey;
        onChange((prev) => prev.map((a) => (a.id === id ? { ...a, storage_key: storageKey } : a)));
        setChip(id, { state: "uploaded" });
      } catch (err) {
        setChip(id, {
          state: "error",
          error: err instanceof Error ? err.message : "Upload failed",
        });
      }
    }
  }

  function remove(id: string) {
    onChange((prev) => prev.filter((a) => a.id !== id));
    clearChip(id);
  }

  // Listen for the synthetic 'composer-add-image' event dispatched by
  // the composer footer's photo-icon button. The event carries
  // { draftId, files }; we filter by draftId so the right composer
  // instance picks up the upload when multiple are open.
  useEffect(() => {
    function onAddImage(e: Event) {
      const detail = (e as CustomEvent<{ draftId: string; files: FileList | null }>).detail;
      if (detail.draftId !== draftId) return;
      void add(detail.files);
    }
    window.addEventListener("composer-add-image", onAddImage);
    return () => window.removeEventListener("composer-add-image", onAddImage);
    // 'add' captures draftId + the current attachments via the functional
    // updater, so no extra deps needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

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
          void add(e.dataTransfer.files);
        }}
        className="flex flex-wrap items-center gap-1"
      >
        {attachments.map((a) => {
          const t = transient[a.id];
          const state: ChipState = t?.state ? t.state : a.storage_key ? "uploaded" : "memory_only";
          return (
            <span
              key={a.id}
              title={t?.error ?? a.name}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px]",
                state === "uploaded"
                  ? "border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/40 dark:bg-emerald-950/30"
                  : state === "uploading"
                    ? "border-blue-200 bg-blue-50/40 dark:border-blue-900/40 dark:bg-blue-950/30"
                    : state === "error"
                      ? "border-rose-200 bg-rose-50/40 dark:border-rose-900/40 dark:bg-rose-950/30"
                      : "border-amber-200 bg-amber-50/40 dark:border-amber-900/40 dark:bg-amber-950/30",
              )}
            >
              <ChipStateIcon state={state} />
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
          );
        })}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={attachmentsDisabled}
          title={
            attachmentsDisabled
              ? "Attachments aren't enabled on this deployment"
              : "Attach files (drag-drop also works)"
          }
          className={cn(
            "inline-flex items-center gap-1 rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
            attachmentsDisabled &&
              "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-zinc-500 dark:hover:bg-transparent dark:hover:text-zinc-500",
          )}
        >
          <Paperclip className="h-3 w-3" />
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          disabled={attachmentsDisabled}
          onChange={(e) => void add(e.target.files)}
        />
      </div>
    </div>
  );
}

function ChipStateIcon({ state }: { state: ChipState }) {
  if (state === "uploading") {
    return <Loader2 className="h-2.5 w-2.5 animate-spin text-blue-500" />;
  }
  if (state === "uploaded") return <Check className="h-2.5 w-2.5 text-emerald-500" />;
  if (state === "error") return <X className="h-2.5 w-2.5 text-rose-500" />;
  return <FileIcon className="h-2.5 w-2.5 text-amber-500" />;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}
