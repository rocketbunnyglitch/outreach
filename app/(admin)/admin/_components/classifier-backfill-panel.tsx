"use client";

/**
 * Admin → classifier backfill panel.
 *
 * Renders inside the /admin page (admin-only route). Shows the current
 * unclassified-thread count + a button to run one batch. The action is
 * idempotent, so repeated clicks chip away at a large backlog without
 * any locking complexity.
 *
 * Design choices
 * --------------
 * - Plain server-action call via useTransition. No optimistic UI — the
 *   real count from the backend is what matters and we want operators
 *   to see what actually happened, not a guess.
 * - Result panel stays sticky after each run so the operator can see
 *   the breakdown: classified vs stillUnclassified vs noInboundMessage.
 * - Next.js revalidatePath fires inside the action, so the surrounding
 *   page (with its own count snapshot) updates on the next navigation.
 *   The panel ALSO refreshes its own count by re-calling the action's
 *   sibling getUnclassifiedCount via router.refresh() after each run.
 */

import { Button } from "@/components/ui/button";
import { Brain, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { type ClassifierBackfillResult, runClassifierBackfill } from "../_actions-classifier";

interface Props {
  /**
   * Initial unclassified count, computed server-side at page load. The
   * panel updates this in state after each run from the action's
   * result.remaining so the operator sees movement without a full
   * page refresh.
   */
  initialUnclassified: number;
}

export function ClassifierBackfillPanel({ initialUnclassified }: Props) {
  const router = useRouter();
  const [pending, startTx] = useTransition();
  const [result, setResult] = useState<ClassifierBackfillResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Track current count locally — updated to result.remaining after
  // each successful run so the "X to go" number reflects the latest
  // batch without a full page reload.
  const [remaining, setRemaining] = useState(initialUnclassified);

  function handleRun() {
    setError(null);
    startTx(async () => {
      const r = await runClassifierBackfill();
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setResult(r.data);
      setRemaining(r.data.remaining);
      // Refresh server-rendered counts in surrounding sections (e.g.
      // dashboard inbox unread badge) on the next paint.
      router.refresh();
    });
  }

  const showProgress = remaining > 0;
  const showAllCaughtUp = remaining === 0 && !pending;

  return (
    <div className="flex flex-col gap-3 px-6 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="font-mono text-[11px] text-zinc-500 uppercase tracking-[0.08em]">
          Unclassified threads
        </div>
        <div className="font-mono font-semibold text-2xl text-zinc-900 tabular-nums dark:text-zinc-100">
          {remaining}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" size="sm" onClick={handleRun} disabled={pending || remaining === 0}>
          {pending ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" /> Classifying…
            </>
          ) : (
            <>
              <Brain className="h-3 w-3" />
              {showAllCaughtUp ? "All caught up" : "Run batch"}
            </>
          )}
        </Button>
        {showProgress && !pending && (
          <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
            Batch size: 1000
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-red-700 text-xs dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      )}

      {result && !error && (
        <div className="rounded-md border border-zinc-200 bg-zinc-50/60 px-3 py-2 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-300">
          <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
            Last run
          </p>
          <ul className="mt-1 space-y-0.5">
            <li>
              Processed{" "}
              <span className="font-mono font-semibold tabular-nums">{result.processed}</span>{" "}
              thread{result.processed === 1 ? "" : "s"}
            </li>
            <li>
              Reclassified{" "}
              <span className="font-mono font-semibold tabular-nums">{result.classified}</span>
            </li>
            {result.stillUnclassified > 0 && (
              <li className="text-zinc-500">
                Still unclassified (no rule matched):{" "}
                <span className="font-mono tabular-nums">{result.stillUnclassified}</span>
              </li>
            )}
            {result.noInboundMessage > 0 && (
              <li className="text-zinc-500">
                Skipped (no inbound message yet):{" "}
                <span className="font-mono tabular-nums">{result.noInboundMessage}</span>
              </li>
            )}
            {result.remaining > 0 && (
              <li className="text-zinc-500">
                Remaining: <span className="font-mono tabular-nums">{result.remaining}</span>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
