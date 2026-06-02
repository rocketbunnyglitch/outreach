"use client";

/**
 * Admin -> empty-body backfill panel.
 *
 * One-shot repair surface for the empty-body bug (fixed at the
 * ingest layer in commit 38b15f6). Scans inbound email_messages
 * with body_text='' AND body_html IS NULL, re-fetches each via
 * Gmail (which now correctly follows attachmentId), and writes
 * the recovered bodies back.
 *
 * Like the venue-tag panel, this chains batches. One click runs
 * up to MAX_HOPS = 10 batches (default batch size = 200 in the
 * lib) -> up to 2000 messages per click. Operator clicks until
 * totalCandidates hits 0.
 *
 * Idempotent: re-running after every message is fixed reports
 * "no candidates left."
 */

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Loader2, MailQuestion } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { runEmptyBodyBackfill } from "../_actions-empty-body-backfill";

interface Props {
  /** Initial count of inbound messages with empty body, computed
   *  server-side at /admin load. Drives the visible "X to repair"
   *  starting number. */
  initialEmptyCount: number;
}

interface RunningTotal {
  scanned: number;
  repaired: number;
  stillEmpty: number;
  errors: number;
  batches: number;
}

export function EmptyBodyBackfillPanel({ initialEmptyCount }: Props) {
  const [pending, startTx] = useTransition();
  const [total, setTotal] = useState<RunningTotal | null>(null);
  const [remaining, setRemaining] = useState(initialEmptyCount);
  const router = useRouter();
  const toast = useToast();

  function run() {
    setTotal({ scanned: 0, repaired: 0, stillEmpty: 0, errors: 0, batches: 0 });
    startTx(async () => {
      let acc: RunningTotal = { scanned: 0, repaired: 0, stillEmpty: 0, errors: 0, batches: 0 };
      let hops = 0;
      const MAX_HOPS = 10;
      while (hops < MAX_HOPS) {
        const result = await runEmptyBodyBackfill();
        if (!result.ok) {
          toast.show({ kind: "error", message: result.error ?? "Backfill failed" });
          break;
        }
        const r = result.data;
        acc = {
          scanned: acc.scanned + r.scanned,
          repaired: acc.repaired + r.repaired,
          stillEmpty: acc.stillEmpty + r.stillEmpty,
          errors: acc.errors + r.errors,
          batches: acc.batches + 1,
        };
        setTotal(acc);
        setRemaining(r.totalCandidates - r.scanned);
        hops++;
        // Stop once we've drained the candidates OR the batch was
        // empty for any reason (catches the "no candidates" / "all
        // failures consume their batch" edge cases without spinning).
        if (r.scanned === 0) break;
        if (r.totalCandidates - r.scanned <= 0) break;
      }
      toast.show({
        kind: "success",
        message: `Repaired ${acc.repaired} message${acc.repaired === 1 ? "" : "s"} across ${acc.batches} batch${acc.batches === 1 ? "" : "es"}${acc.errors > 0 ? ` (${acc.errors} errors)` : ""}.`,
      });
      router.refresh();
    });
  }

  if (initialEmptyCount === 0 && !total) {
    // Hide the whole panel when there's nothing to do. Surfacing a
    // "0 to repair" panel is just noise on the admin page.
    return null;
  }

  return (
    <section className="card-surface p-5">
      <header className="flex items-start gap-3">
        <MailQuestion className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-base">Repair empty message bodies</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Inbound messages whose body Gmail returned via attachmentId were silently dropped before
            the ingest fix in commit 38b15f6. This re-fetches them and fills in the body columns.
          </p>
          <p className="mt-1 font-mono text-[11px] text-zinc-500 uppercase tabular-nums tracking-widest">
            {total
              ? `${total.repaired} repaired / ${total.scanned} scanned across ${total.batches} batch${total.batches === 1 ? "" : "es"}${total.errors > 0 ? ` (${total.errors} errors)` : ""}${remaining > 0 ? ` -- ${remaining.toLocaleString("en-US")} more` : " -- done"}`
              : `${initialEmptyCount.toLocaleString("en-US")} message${initialEmptyCount === 1 ? "" : "s"} to repair`}
          </p>
        </div>
        <Button onClick={run} disabled={pending} variant="default" size="sm">
          {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          {pending ? "Running..." : "Run batch"}
        </Button>
      </header>
    </section>
  );
}
