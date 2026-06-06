"use client";

/**
 * ComebacksSection (Phase 4.8) -- a venue that cancelled but replied again may
 * want back in. The lead can re-confirm (if the slot's still open) or open the
 * thread to reply (e.g. a polite "already filled"). Re-confirm re-fires the
 * post-confirm tasks + lifecycle emails.
 */

import { useToast } from "@/components/ui/toast";
import { captureClientError } from "@/lib/client-error";
import type { WorklistComebackRow } from "@/lib/worklist-data";
import { ExternalLink, Loader2, MailX, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { reconfirmCancelledVenue, sendPoliteDecline } from "../_actions";

function fmt(iso: string | null): string {
  if (!iso) return "unknown";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Toronto",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

function Row({ c }: { c: WorklistComebackRow }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTx] = useTransition();

  function reconfirm() {
    startTx(async () => {
      try {
        const res = await reconfirmCancelledVenue({ venueEventId: c.venueEventId });
        if (!res.ok) {
          toast.show({ kind: "error", message: res.error ?? "Couldn't re-confirm." });
          return;
        }
        toast.show({ kind: "success", message: `Re-confirmed ${c.venueName}.` });
        router.refresh();
      } catch (err) {
        const cap = captureClientError(err, {
          tag: "worklist.comeback",
          fallback: "Couldn't re-confirm.",
        });
        toast.show({ kind: "error", message: cap.message, code: cap.code });
      }
    });
  }

  function decline() {
    startTx(async () => {
      try {
        const res = await sendPoliteDecline({ venueEventId: c.venueEventId });
        if (!res.ok) {
          toast.show({ kind: "error", message: res.error ?? "Couldn't build the decline." });
          return;
        }
        toast.show({ kind: "success", message: "Polite decline drafted -- review in Drafts." });
        router.refresh();
      } catch (err) {
        const cap = captureClientError(err, {
          tag: "worklist.comeback.decline",
          fallback: "Couldn't build the decline.",
        });
        toast.show({ kind: "error", message: cap.message, code: cap.code });
      }
    });
  }

  return (
    <li className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
      <div className="min-w-0">
        <p className="truncate font-medium text-sm">
          {c.venueName}
          {c.cityName ? <span className="text-zinc-500"> &middot; {c.cityName}</span> : null}
        </p>
        <p className="font-mono text-[10px] text-zinc-400">
          cancelled {fmt(c.cancelledAt)} &middot; replied since -- may want back in
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Link
          href={`/inbox/${c.threadId}`}
          title="Open thread"
          className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 font-mono text-[10px] text-zinc-600 uppercase tracking-[0.08em] hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <ExternalLink className="h-3 w-3" /> Thread
        </Link>
        <button
          type="button"
          onClick={decline}
          disabled={pending}
          title="Slot taken -- send a polite decline"
          className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 font-mono text-[10px] text-amber-800 uppercase tracking-[0.08em] hover:bg-amber-100 disabled:opacity-50 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
        >
          <MailX className="h-3 w-3" /> Polite decline
        </button>
        <button
          type="button"
          onClick={reconfirm}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 font-mono text-[10px] text-emerald-800 uppercase tracking-[0.08em] hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200"
        >
          {pending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RotateCcw className="h-3 w-3" />
          )}
          Re-confirm
        </button>
      </div>
    </li>
  );
}

export function ComebacksSection({ comebacks }: { comebacks: WorklistComebackRow[] }) {
  if (comebacks.length === 0) return null;
  return (
    <section className="card-surface overflow-hidden">
      <header className="flex items-center gap-2 border-zinc-200/60 border-b px-5 py-3 dark:border-zinc-800/40">
        <RotateCcw className="h-4 w-4 text-emerald-500" />
        <h3 className="font-semibold text-sm tracking-tight">Possible comebacks</h3>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-mono text-[9px] text-zinc-500 uppercase tracking-[0.1em] dark:bg-zinc-800 dark:text-zinc-400">
          {comebacks.length}
        </span>
      </header>
      <ul className="flex flex-col gap-2 p-3">
        {comebacks.map((c) => (
          <Row key={c.venueEventId} c={c} />
        ))}
      </ul>
    </section>
  );
}
