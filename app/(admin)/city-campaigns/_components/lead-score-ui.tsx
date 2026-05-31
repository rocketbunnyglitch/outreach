"use client";

/**
 * LeadScoreChip + ScoreAllButton — UI for Tier A #5 (lead scoring).
 *
 * LeadScoreChip renders an inline chip showing the 0-100 score with a
 * tooltip explaining the reason. Color reservation:
 *   80+    emerald   (strong lead)
 *   60-79  blue      (decent)
 *   40-59  zinc      (mixed)
 *   20-39  amber     (weak)
 *   <20    rose      (very weak — skip)
 *   null   muted     ("not scored yet — click below to score")
 *
 * ScoreAllButton is the admin affordance that triggers the backfill
 * action. Shows a spinner + progress text while in flight.
 * Chains automatically when hasMore is true (the lib returns up to
 * 200 rows per call; a large campaign needs N chained calls).
 *
 * Both render NOTHING for non-admins (the caller passes isAdmin).
 */

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { backfillLeadScoresForCampaign } from "../_cold-outreach-actions";

// =========================================================================
// LeadScoreChip — per-row score display
// =========================================================================

export function LeadScoreChip({
  score,
  reason,
}: {
  score: number | null;
  reason: string | null;
}) {
  if (score === null) {
    return (
      <span
        className="font-mono text-[10px] text-zinc-400 dark:text-zinc-600"
        title="Not scored yet. Use 'Score all' to generate."
      >
        —
      </span>
    );
  }

  const tone = scoreToTone(score);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px] tabular-nums tracking-[0.04em]",
        tone,
      )}
      title={reason ?? `Score ${score}`}
    >
      <Sparkles className="h-2.5 w-2.5 opacity-60" />
      {score}
    </span>
  );
}

function scoreToTone(score: number): string {
  if (score >= 80) {
    return "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200";
  }
  if (score >= 60) {
    return "bg-blue-100 text-blue-900 dark:bg-blue-950/60 dark:text-blue-200";
  }
  if (score >= 40) {
    return "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-200";
  }
  if (score >= 20) {
    return "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200";
  }
  return "bg-rose-100 text-rose-900 dark:bg-rose-950/60 dark:text-rose-200";
}

// =========================================================================
// ScoreAllButton — admin batched backfill trigger
// =========================================================================

interface RunningTotal {
  scanned: number;
  scored: number;
  failed: number;
  batches: number;
}

export function ScoreAllButton({
  cityCampaignId,
  isAdmin,
  unscoredCount,
}: {
  cityCampaignId: string;
  isAdmin: boolean;
  /** Live unscored count from the parent — drives the button label. */
  unscoredCount: number;
}) {
  const [pending, startTx] = useTransition();
  const [total, setTotal] = useState<RunningTotal | null>(null);
  const router = useRouter();
  const toast = useToast();

  if (!isAdmin) return null;
  if (unscoredCount === 0 && !total) return null;

  /**
   * Chained runner — calls backfillLeadScoresForCampaign in a loop
   * as long as the server reports hasMore. We cap at 10 chain hops
   * (= 2000 rows) per click to avoid an accidentally infinite loop
   * if something on the server keeps returning hasMore. Each hop's
   * batch result accumulates into the running total surfaced to the
   * operator.
   */
  function run() {
    setTotal({ scanned: 0, scored: 0, failed: 0, batches: 0 });
    startTx(async () => {
      let acc: RunningTotal = { scanned: 0, scored: 0, failed: 0, batches: 0 };
      let hops = 0;
      const MAX_HOPS = 10;
      while (hops < MAX_HOPS) {
        const result = await backfillLeadScoresForCampaign({ cityCampaignId });
        if (!result.ok) {
          toast.show({
            kind: "error",
            message: result.error ?? "Couldn't score leads.",
          });
          break;
        }
        acc = {
          scanned: acc.scanned + result.data.scanned,
          scored: acc.scored + result.data.scored,
          failed: acc.failed + result.data.failed,
          batches: acc.batches + result.data.batches,
        };
        setTotal({ ...acc });
        if (!result.data.hasMore) break;
        hops++;
      }
      router.refresh();
      toast.show({
        kind: "success",
        message: `Scored ${acc.scored} ${
          acc.scored === 1 ? "venue" : "venues"
        } across ${acc.batches} ${acc.batches === 1 ? "batch" : "batches"}${
          acc.failed > 0 ? ` (${acc.failed} skipped)` : ""
        }.`,
      });
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button type="button" size="sm" variant="outline" onClick={run} disabled={pending}>
        {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
        {pending && total ? (
          <span className="tabular-nums">
            Scoring… {total.scored}/{total.scanned}
          </span>
        ) : (
          <>
            Score all{" "}
            {unscoredCount > 0 && (
              <span className="font-mono text-[10px] text-zinc-500 tabular-nums">
                ({unscoredCount})
              </span>
            )}
          </>
        )}
      </Button>
    </div>
  );
}
