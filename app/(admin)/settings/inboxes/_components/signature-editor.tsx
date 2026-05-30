"use client";

/**
 * SignatureEditor — small per-inbox signature edit UI shown on
 * /settings/inboxes. Click to expand a textarea, paste/edit HTML,
 * save via setInboxSignature.
 *
 * Plain textarea (no rich text) since signatures are typically
 * authored once and pasted in. The composer's existing rich-text
 * editor renders the saved HTML when the signature gets appended,
 * so formatting works fine end-to-end.
 *
 * Sanitised + size-capped server-side; client-side does no
 * validation other than the obvious empty check.
 */

import { Loader2, Pencil, Save, X } from "lucide-react";
import { useState, useTransition } from "react";
import { setInboxSignature } from "../../../_actions/compose-and-send";

interface Props {
  connectedAccountId: string;
  initialSignatureHtml: string | null;
}

export function SignatureEditor({ connectedAccountId, initialSignatureHtml }: Props) {
  const [signature, setSignature] = useState(initialSignatureHtml ?? "");
  const [saved, setSaved] = useState(initialSignatureHtml ?? "");
  const [open, setOpen] = useState(false);
  const [pending, startTx] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const dirty = signature !== saved;

  function save() {
    setError(null);
    startTx(async () => {
      const res = await setInboxSignature({
        connectedAccountId,
        signatureHtml: signature.trim() === "" ? null : signature,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(res.signatureHtml ?? "");
      setOpen(false);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[10px] hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
        title="Edit signature for this inbox"
      >
        <Pencil className="h-2.5 w-2.5" />
        {saved ? "Edit signature" : "Add signature"}
      </button>
    );
  }

  return (
    <div className="rounded-md border border-zinc-200 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
          Signature (HTML)
        </span>
        <button
          type="button"
          onClick={() => {
            setSignature(saved);
            setError(null);
            setOpen(false);
          }}
          className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          aria-label="Close signature editor"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <textarea
        value={signature}
        onChange={(e) => setSignature(e.target.value)}
        placeholder="<p>— Your name<br>Your title</p>"
        rows={4}
        className="w-full rounded border border-zinc-200 bg-white px-2 py-1 font-mono text-[11px] dark:border-zinc-700 dark:bg-zinc-950"
      />
      {error && <p className="mt-1 text-[10px] text-rose-600">{error}</p>}
      <div className="mt-1.5 flex items-center justify-between">
        <p className="font-mono text-[9px] text-zinc-500">
          Auto-appended on outbound mail from this inbox. Operators can edit per-draft.
        </p>
        <button
          type="button"
          onClick={save}
          disabled={pending || !dirty}
          className="inline-flex items-center gap-1 rounded-md bg-zinc-900 px-2 py-1 font-medium text-[10px] text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? (
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
          ) : (
            <Save className="h-2.5 w-2.5" />
          )}
          Save
        </button>
      </div>
    </div>
  );
}
