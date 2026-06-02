"use client";

/**
 * ArchiveWithReason -- inline, Apple-clean confirm for a dangerous archive /
 * cancel override. There is no heavy modal: the trigger button reveals a small
 * reason field + confirm in place. The reason is required (the server action
 * enforces >= 3 chars, but we also guard client-side so the operator gets
 * instant feedback) and is submitted via FormData under the name "reason".
 *
 * The parent passes a server action bound to the row id; this component only
 * collects the reason and renders the pending state. When `canArchive` is
 * false (caller lacks the lead/admin role) the control is shown disabled with
 * a short hint instead of being hidden, so the operator understands why.
 */

import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useFormStatus } from "react-dom";

function SubmitButton({ label, disabled }: { label: string; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" size="sm" disabled={disabled || pending}>
      {pending ? "Working..." : label}
    </Button>
  );
}

export function ArchiveWithReason({
  action,
  title,
  description,
  triggerLabel,
  confirmLabel,
  reasonPlaceholder,
  canArchive,
  disabledHint,
}: {
  action: (formData: FormData) => void | Promise<void>;
  title: string;
  description: string;
  triggerLabel: string;
  confirmLabel: string;
  reasonPlaceholder: string;
  canArchive: boolean;
  disabledHint: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const reasonOk = reason.trim().length >= 3;

  return (
    <div className="rounded-md border border-rose-200 bg-rose-50 p-4 dark:border-rose-900 dark:bg-rose-950">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-medium text-rose-900 text-sm dark:text-rose-200">{title}</p>
          <p className="mt-1 text-rose-800 text-xs dark:text-rose-300">{description}</p>
        </div>
        {!open ? (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={!canArchive}
            onClick={() => setOpen(true)}
          >
            {triggerLabel}
          </Button>
        ) : null}
      </div>

      {!canArchive ? (
        <p className="mt-2 text-rose-700 text-xs dark:text-rose-400">{disabledHint}</p>
      ) : null}

      {open && canArchive ? (
        <form action={action} className="mt-3 flex flex-col gap-2">
          <label
            htmlFor="archive-reason"
            className="font-medium text-rose-900 text-xs dark:text-rose-200"
          >
            Reason (required, shown in the audit log)
          </label>
          <textarea
            id="archive-reason"
            name="reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={reasonPlaceholder}
            className="w-full rounded-md border border-rose-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 dark:border-rose-900 dark:bg-zinc-950 dark:text-zinc-100"
          />
          <div className="flex items-center gap-2">
            <SubmitButton label={confirmLabel} disabled={!reasonOk} />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false);
                setReason("");
              }}
            >
              Cancel
            </Button>
            {!reasonOk ? (
              <span className="text-rose-700 text-xs dark:text-rose-400">
                At least 3 characters.
              </span>
            ) : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}
