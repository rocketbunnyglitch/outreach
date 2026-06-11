"use client";

/**
 * DuplicatesCard (CRM plan D1) — possible duplicates of THIS venue with
 * the three rulings: Merge into this venue (admin; source's history is
 * re-pointed here), Same org (both stay, remembered), Not a duplicate
 * (remembered, never warned again). Renders nothing when there are no
 * unruled candidates, so a clean venue page stays clean.
 */

import { useToast } from "@/components/ui/toast";
import { captureClientError } from "@/lib/client-error";
import type { VenueDuplicate } from "@/lib/venue-duplicates";
import { Copy, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  listVenueDuplicates,
  mergeDuplicateVenues,
  recordDuplicateDecision,
} from "../_duplicate-decision-actions";

export function DuplicatesCard({ venueId, isAdmin }: { venueId: string; isAdmin: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [dupes, setDupes] = useState<VenueDuplicate[] | null>(null);
  const [pending, startTx] = useTransition();

  useEffect(() => {
    let cancelled = false;
    listVenueDuplicates(venueId)
      .then((res) => {
        if (!cancelled && res.ok) setDupes(res.data.duplicates);
      })
      .catch(() => {
        if (!cancelled) setDupes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [venueId]);

  if (!dupes || dupes.length === 0) return null;

  function decide(otherId: string, decision: "same_org" | "not_duplicate") {
    startTx(async () => {
      const res = await recordDuplicateDecision({
        venueAId: venueId,
        venueBId: otherId,
        decision,
      });
      if (!res.ok) {
        toast.show({ kind: "error", message: res.error ?? "Couldn't save." });
        return;
      }
      setDupes((prev) => prev?.filter((d) => d.id !== otherId) ?? null);
      toast.show({
        kind: "success",
        message: decision === "same_org" ? "Linked as same org." : "Won't warn again.",
      });
    });
  }

  function merge(other: VenueDuplicate) {
    if (
      !confirm(
        `Merge "${other.name}" INTO this venue? Its outreach history, threads and crawl links are re-pointed here and it is archived. This cannot be undone.`,
      )
    )
      return;
    startTx(async () => {
      try {
        const res = await mergeDuplicateVenues({ sourceId: other.id, destId: venueId });
        if (!res.ok) {
          toast.show({ kind: "error", message: res.error ?? "Merge failed." });
          return;
        }
        const moved = Object.values(res.data.repointed).reduce((s, n) => s + n, 0);
        setDupes((prev) => prev?.filter((d) => d.id !== other.id) ?? null);
        toast.show({ kind: "success", message: `Merged — ${moved} records re-pointed here.` });
        router.refresh();
      } catch (err) {
        const cap = captureClientError(err, {
          tag: "venues.merge",
          fallback: "Merge failed.",
        });
        toast.show({ kind: "error", message: cap.message, code: cap.code });
      }
    });
  }

  return (
    <section className="card-surface flex flex-col gap-3 p-4">
      <header className="flex items-center gap-2">
        <Copy className="h-4 w-4 text-amber-500" />
        <h2 className="font-semibold text-sm tracking-tight">Possible duplicates</h2>
        <span className="text-[11px] text-zinc-500">
          decisions are remembered — ruled pairs never warn again
        </span>
      </header>
      <ul className="flex flex-col gap-1.5">
        {dupes.map((d) => (
          <li
            key={d.id}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800"
          >
            <div className="min-w-0 flex-1">
              <Link
                href={`/venues/${d.id}`}
                className="truncate font-medium text-sm hover:underline"
              >
                {d.name}
              </Link>
              <p className="truncate font-mono text-[10px] text-zinc-500">
                {d.cityName}
                {d.address ? ` · ${d.address}` : ""} · {d.matchReasons.join(", ")}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" /> : null}
              {isAdmin && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => merge(d)}
                  className="rounded-md border border-rose-300 bg-rose-50 px-2 py-1 font-medium text-[11px] text-rose-700 hover:bg-rose-100 disabled:opacity-50 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200"
                >
                  Merge into this venue
                </button>
              )}
              <button
                type="button"
                disabled={pending}
                onClick={() => decide(d.id, "same_org")}
                className="rounded-md border border-zinc-200 px-2 py-1 text-[11px] hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                Same org
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => decide(d.id, "not_duplicate")}
                className="rounded-md border border-zinc-200 px-2 py-1 text-[11px] text-zinc-500 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                Not a duplicate
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
