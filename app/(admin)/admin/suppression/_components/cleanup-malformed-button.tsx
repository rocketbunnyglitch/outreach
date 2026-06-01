"use client";

import { Button } from "@/components/ui/button";
import { Loader2, ShieldOff } from "lucide-react";
import { useState, useTransition } from "react";
import { cleanMalformedSuppression } from "../_actions";

/**
 * Inline button that surfaces only when there are malformed
 * suppression rows on the team (count > 0). One-click cleanup
 * with a confirm() dialog showing the count + a 5-row sample.
 *
 * Why a sample: deleting suppression rows is destructive in the
 * abstract, even though malformed rows can never match a real
 * recipient. The sample gives the admin a quick visual sanity
 * check ("oh, yeah, those are all display-name junk") before
 * pulling the trigger.
 *
 * Auth: the server action gates on requireAdmin; this component
 * trusts the parent page to only render when ctx is admin.
 */
export function CleanupMalformedButton({
  count,
  sample,
}: {
  count: number;
  sample: string[];
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<
    { kind: "ok"; deleted: number } | { kind: "err"; error: string } | null
  >(null);

  if (count === 0) return null;

  function handleClick() {
    const preview = sample.length > 0 ? `\n\nSample:\n${sample.slice(0, 5).join("\n")}` : "";
    const msg = `Delete ${count} malformed suppression row${count === 1 ? "" : "s"}?\n\nThese rows contain display-name junk and have never matched any send. Safe to remove.${preview}`;
    if (!window.confirm(msg)) return;
    startTransition(async () => {
      try {
        const r = await cleanMalformedSuppression();
        if (r.ok) {
          setResult({ kind: "ok", deleted: r.data.deleted });
        } else {
          setResult({ kind: "err", error: r.error ?? "Cleanup failed" });
        }
      } catch (err) {
        setResult({ kind: "err", error: err instanceof Error ? err.message : "Cleanup failed" });
      }
    });
  }

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-900/50 dark:bg-amber-950/30">
      <div className="flex items-center gap-2">
        <ShieldOff className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
        <p className="text-xs text-amber-900 dark:text-amber-200">
          {count} malformed row{count === 1 ? "" : "s"} (display-name junk from pre-fix block
          actions). These never block any real send.
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleClick}
          disabled={pending}
          className="ml-auto"
        >
          {pending && <Loader2 className="h-3 w-3 animate-spin" />}
          Clean up
        </Button>
      </div>
      {result?.kind === "ok" && (
        <p className="text-[11px] text-emerald-700 dark:text-emerald-300">
          Deleted {result.deleted} row{result.deleted === 1 ? "" : "s"}. Refresh the page to update
          the table.
        </p>
      )}
      {result?.kind === "err" && (
        <p className="text-[11px] text-rose-600 dark:text-rose-400">{result.error}</p>
      )}
    </div>
  );
}
