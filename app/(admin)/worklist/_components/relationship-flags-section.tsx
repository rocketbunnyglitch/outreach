"use client";

/**
 * RelationshipFlagsSection (Phase 3.12) -- after an event runs, prompt the city
 * lead to flag how the venue x brand relationship went. One click records the
 * flag (good / neutral / bad) and the row drops off.
 */

import { useToast } from "@/components/ui/toast";
import { captureClientError } from "@/lib/client-error";
import type { WorklistRelationshipFlagRow } from "@/lib/worklist-data";
import { Minus, ThumbsDown, ThumbsUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setPostEventRelationshipFlag } from "../_actions";

const OPTIONS = [
  {
    status: "good" as const,
    label: "Good",
    Icon: ThumbsUp,
    cls: "hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 dark:hover:border-emerald-900/50 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-200",
  },
  {
    status: "neutral" as const,
    label: "Neutral",
    Icon: Minus,
    cls: "hover:border-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800",
  },
  {
    status: "bad" as const,
    label: "Bad",
    Icon: ThumbsDown,
    cls: "hover:border-rose-300 hover:bg-rose-50 hover:text-rose-800 dark:hover:border-rose-900/50 dark:hover:bg-rose-950/30 dark:hover:text-rose-200",
  },
];

function Row({ flag }: { flag: WorklistRelationshipFlagRow }) {
  const router = useRouter();
  const toast = useToast();
  const [notes, setNotes] = useState("");
  const [pending, startTx] = useTransition();

  function flagIt(status: "good" | "neutral" | "bad") {
    startTx(async () => {
      try {
        const res = await setPostEventRelationshipFlag({
          venueId: flag.venueId,
          brandId: flag.brandId,
          status,
          notes,
        });
        if (!res.ok) {
          toast.show({ kind: "error", message: res.error ?? "Couldn't save." });
          return;
        }
        toast.show({ kind: "success", message: `Flagged ${flag.venueName} as ${status}.` });
        router.refresh();
      } catch (err) {
        const cap = captureClientError(err, {
          tag: "worklist.relflag",
          fallback: "Couldn't save.",
        });
        toast.show({ kind: "error", message: cap.message, code: cap.code });
      }
    });
  }

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-sm">
            {flag.venueName}
            {flag.cityName ? (
              <span className="text-zinc-500"> &middot; {flag.cityName}</span>
            ) : null}
          </p>
          <p className="font-mono text-[10px] text-zinc-400">
            {flag.brandName} &middot; event {flag.eventDate} &middot; how did it go?
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {OPTIONS.map(({ status, label, Icon, cls }) => (
            <button
              key={status}
              type="button"
              disabled={pending}
              onClick={() => flagIt(status)}
              className={`inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] disabled:opacity-50 dark:border-zinc-700 ${cls}`}
            >
              <Icon className="h-3 w-3" /> {label}
            </button>
          ))}
        </div>
      </div>
      <input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Optional note (e.g. great staff, slow night)..."
        className="w-full rounded-md border border-zinc-200 bg-transparent px-2 py-1 text-xs placeholder:text-zinc-400 dark:border-zinc-800"
      />
    </li>
  );
}

export function RelationshipFlagsSection({ flags }: { flags: WorklistRelationshipFlagRow[] }) {
  if (flags.length === 0) return null;
  return (
    <section className="card-surface overflow-hidden">
      <header className="flex items-center gap-2 border-zinc-200/60 border-b px-5 py-3 dark:border-zinc-800/40">
        <h3 className="font-semibold text-sm tracking-tight">Relationship flags pending</h3>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-mono text-[9px] text-zinc-500 uppercase tracking-[0.1em] dark:bg-zinc-800 dark:text-zinc-400">
          {flags.length}
        </span>
      </header>
      <ul className="flex flex-col gap-2 p-3">
        {flags.map((f) => (
          <Row key={`${f.venueId}:${f.brandId}`} flag={f} />
        ))}
      </ul>
    </section>
  );
}
