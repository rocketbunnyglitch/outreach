"use client";

import { useToast } from "@/components/ui/toast";
import { Loader2, Send, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { type ColdAllPlan, coldAllSelectedVenues } from "../_cold-all-actions";

/**
 * Cold All confirm dialog. On open it runs a dry-run plan (counts + skip
 * reasons + schedule span) so the operator sees exactly what will queue before
 * committing. Confirm creates the operator-approved, paced T1 drafts.
 */

const SKIP_LABEL: Record<string, string> = {
  noEmail: "no email",
  invalidEmail: "invalid email",
  suppressed: "on suppression list",
  dnc: "do-not-contact",
  alreadyContacted: "already contacted",
  failedValidation: "failed ZeroBounce check",
};

export function ColdAllModal({
  open,
  onClose,
  entryIds,
  cityCampaignId,
}: {
  open: boolean;
  onClose: () => void;
  entryIds: string[];
  cityCampaignId: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<ColdAllPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Dry-run plan on open.
  useEffect(() => {
    if (!open) {
      setPlan(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    coldAllSelectedVenues({ entryIds, cityCampaignId, dryRun: true })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) setPlan(res);
        else setError(res.error);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't build the plan.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, entryIds, cityCampaignId]);

  if (!open) return null;

  function confirm() {
    startTransition(async () => {
      const res = await coldAllSelectedVenues({ entryIds, cityCampaignId, dryRun: false });
      if (res.ok) {
        toast.show({
          kind: "success",
          message: `Queued ${res.queued} cold email${res.queued === 1 ? "" : "s"} to the email queue.`,
        });
        onClose();
        router.refresh();
      } else {
        toast.show({ kind: "error", message: res.error });
        setError(res.error);
      }
    });
  }

  const skips = plan ? Object.entries(plan.skipped).filter(([, n]) => n > 0) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/40"
      />
      <div className="card-surface relative z-10 w-full max-w-md p-5">
        <header className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-lg tracking-tight">Cold All</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Building the plan…
          </div>
        ) : error ? (
          <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
            {error}
          </p>
        ) : plan ? (
          <div className="flex flex-col gap-3 text-sm">
            {plan.queued === 0 ? (
              <p className="text-zinc-600 dark:text-zinc-300">
                Nothing to queue — none of the selected venues are eligible right now.
              </p>
            ) : (
              <>
                <p className="text-zinc-800 dark:text-zinc-100">
                  Queue <span className="font-semibold">{plan.queued}</span> cold T1 email
                  {plan.queued === 1 ? "" : "s"} from your inbox
                  {plan.byAccount.length === 1 ? "" : "es"}, paced to send safely.
                </p>
                <ul className="rounded-md bg-zinc-100/70 p-2 font-mono text-[11px] text-zinc-600 dark:bg-zinc-800/40 dark:text-zinc-300">
                  {plan.byAccount.map((a) => (
                    <li key={a.email} className="flex justify-between">
                      <span className="truncate">{a.email}</span>
                      <span className="tabular-nums">{a.count}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-zinc-500">
                  Spread over {plan.daySpan} day{plan.daySpan === 1 ? "" : "s"} · first ~
                  {plan.firstSendLabel ?? "-"}, last ~{plan.lastSendLabel ?? "-"} · sent at
                  randomized intervals respecting each inbox's daily cap + warmup.
                </p>
              </>
            )}
            {plan.pendingValidation > 0 && (
              <p className="text-xs text-sky-700 dark:text-sky-400">
                <span className="tabular-nums">{plan.pendingValidation}</span> not yet
                ZeroBounce-checked — they're verified on confirm and only green (valid) ones are
                sent.
              </p>
            )}
            {skips.length > 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Skipping{" "}
                {skips.map(([k, n], i) => (
                  <span key={k}>
                    {i > 0 ? ", " : ""}
                    <span className="tabular-nums">{n}</span> {SKIP_LABEL[k] ?? k}
                  </span>
                ))}
                .
              </p>
            )}
          </div>
        ) : null}

        <footer className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={pending || loading || !plan || plan.queued === 0}
            className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-sm text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            Queue {plan?.queued ?? 0}
          </button>
        </footer>
      </div>
    </div>
  );
}
