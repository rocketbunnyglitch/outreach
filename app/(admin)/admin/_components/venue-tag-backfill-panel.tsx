"use client";

/**
 * Admin → venue-type AI backfill panel.
 *
 * Sweeps venues with empty venueType arrays in batches of 20.
 * Like the classifier panel, it's idempotent and chained — one
 * click runs up to 10 hops (= 2000 venues) and reports the
 * running total via toast.
 *
 * Operator pattern:
 *   - Click "Run batch" → spinner → progress text in the button
 *     ("Tagged X/Y")
 *   - Toast on completion: "Tagged 187 venues across 10 batches"
 *   - Chained until the server reports hasMore=false OR the
 *     10-hop cap protects against runaway loops.
 *
 * Reads: initialUntaggedCount snapshotted server-side at page
 * load (so the panel starts with the real number, not a guess).
 */

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { backfillVenueTypesForAdmin } from "../_actions-venue-tag";

interface Props {
  /** Initial count of venues with empty venueType, computed
   *  server-side at /admin load. Used as the starting "X to go"
   *  number; updated after each chained run. */
  initialUntaggedCount: number;
}

interface RunningTotal {
  scanned: number;
  tagged: number;
  failed: number;
  batches: number;
}

export function VenueTagBackfillPanel({ initialUntaggedCount }: Props) {
  const [pending, startTx] = useTransition();
  const [total, setTotal] = useState<RunningTotal | null>(null);
  const [remaining, setRemaining] = useState(initialUntaggedCount);
  const router = useRouter();
  const toast = useToast();

  function run() {
    setTotal({ scanned: 0, tagged: 0, failed: 0, batches: 0 });
    startTx(async () => {
      let acc: RunningTotal = { scanned: 0, tagged: 0, failed: 0, batches: 0 };
      let hops = 0;
      const MAX_HOPS = 10;
      while (hops < MAX_HOPS) {
        const result = await backfillVenueTypesForAdmin();
        if (!result.ok) {
          toast.show({
            kind: "error",
            message: result.error ?? "Couldn't tag venues.",
          });
          break;
        }
        acc = {
          scanned: acc.scanned + result.data.scanned,
          tagged: acc.tagged + result.data.tagged,
          failed: acc.failed + result.data.failed,
          batches: acc.batches + result.data.batches,
        };
        setTotal({ ...acc });
        if (!result.data.hasMore) break;
        hops++;
      }
      // Subtract tagged count from local remaining so the panel
      // shows movement without a server round-trip.
      setRemaining((r) => Math.max(0, r - acc.tagged));
      router.refresh();
      toast.show({
        kind: "success",
        message: `Tagged ${acc.tagged} ${
          acc.tagged === 1 ? "venue" : "venues"
        } across ${acc.batches} ${acc.batches === 1 ? "batch" : "batches"}${
          acc.failed > 0 ? ` (${acc.failed} skipped)` : ""
        }.`,
      });
    });
  }

  const showCaughtUp = remaining === 0 && !pending;

  return (
    <div className="flex flex-col gap-3 px-6 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="font-mono text-[11px] text-zinc-500 uppercase tracking-[0.08em]">
          Untagged venues
        </div>
        <div className="font-mono font-semibold text-2xl text-zinc-900 tabular-nums dark:text-zinc-100">
          {remaining}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" size="sm" onClick={run} disabled={pending || remaining === 0}>
          {pending ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              {total ? (
                <span className="tabular-nums">
                  Tagging… {total.tagged}/{total.scanned}
                </span>
              ) : (
                "Tagging…"
              )}
            </>
          ) : (
            <>
              <Sparkles className="h-3 w-3" />
              {showCaughtUp ? "All caught up" : "Tag empty venue types"}
            </>
          )}
        </Button>
      </div>

      {total && total.tagged > 0 && (
        <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
          Last run: tagged {total.tagged} · {total.batches}{" "}
          {total.batches === 1 ? "batch" : "batches"}
          {total.failed > 0 ? ` · skipped ${total.failed}` : ""}
        </p>
      )}

      <p className="text-[11px] text-zinc-500 leading-relaxed dark:text-zinc-400">
        Reads name + address + city and picks from a fixed vocabulary (bar / lounge / cocktail_bar /
        etc). Skips venues that already have a tag — operator edits are never overwritten. Costs
        about $0.0001 per venue (~$0.30 for a 3000-venue full backfill).
      </p>
    </div>
  );
}
