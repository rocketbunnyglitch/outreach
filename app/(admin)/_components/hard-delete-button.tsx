"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * Permanent-delete control. Superuser-only (the parent decides whether to
 * render it). Two-step confirm with type-to-match so the operator can't
 * fat-finger a destructive action. On success the page redirects.
 */
export function HardDeleteButton({
  label,
  matchText,
  redirectTo,
  action,
}: {
  /** What the operator is deleting, e.g. "venue The Foundry" — shown in the
   *  warning copy and used as the case-sensitive confirm text. */
  label: string;
  /** What the operator must type. Usually the record's display name. */
  matchText: string;
  /** Where to navigate after a successful delete. */
  redirectTo: string;
  /** Server action. Returns { ok, error? }. */
  action: () => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [pending, startTx] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const matches = confirm === matchText;

  function reset() {
    setOpen(false);
    setConfirm("");
    setError(null);
  }

  function submit() {
    if (!matches) return;
    setError(null);
    startTx(async () => {
      const res = await action();
      if (!res.ok) {
        setError(res.error ?? "Delete failed.");
        toast.show({ kind: "error", message: res.error ?? "Couldn't delete." });
        return;
      }
      toast.show({ kind: "success", message: `${label} deleted.` });
      reset();
      router.push(redirectTo);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <div className="flex items-center justify-between rounded-md border border-rose-300 bg-rose-50 p-4 dark:border-rose-900 dark:bg-rose-950/40">
        <div>
          <p className="font-medium text-rose-900 text-sm dark:text-rose-200">
            Permanently delete {label}
          </p>
          <p className="mt-1 text-rose-800 text-xs dark:text-rose-300">
            Irreversible. Removes every row that depends on this record. Superuser only. Archive
            instead unless you're sure.
          </p>
        </div>
        <Button
          type="button"
          variant="destructive"
          onClick={() => setOpen(true)}
          className="bg-rose-700 hover:bg-rose-800"
        >
          Permanently delete…
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-rose-400 bg-rose-50 p-4 dark:border-rose-800 dark:bg-rose-950/50">
      <p className="font-medium text-rose-900 text-sm dark:text-rose-100">
        Type <code className="rounded bg-rose-200/60 px-1 dark:bg-rose-900/50">{matchText}</code> to
        confirm permanent deletion of {label}.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoFocus
          placeholder={matchText}
          className="max-w-xs"
        />
        <Button
          type="button"
          variant="destructive"
          disabled={!matches || pending}
          onClick={submit}
          className="bg-rose-700 hover:bg-rose-800"
        >
          {pending ? "Deleting…" : "Delete forever"}
        </Button>
        <Button type="button" variant="ghost" onClick={reset} disabled={pending}>
          Cancel
        </Button>
      </div>
      {error && <p className="mt-2 text-rose-800 text-xs dark:text-rose-300">{error}</p>}
    </div>
  );
}
