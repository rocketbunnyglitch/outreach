"use client";

/**
 * VenueConfirmationSection - the venue's written-confirmation proof.
 *
 * Operators wanted, for dispute defense ("the venue says we never agreed"),
 * to flag the exact email where a venue confirmed a slot and pull it up fast
 * from the venue card. This section:
 *   - Surfaces any FLAGGED confirmation emails at the top, highlighted, with
 *     who at the venue confirmed, when, and a one-click link to the thread.
 *   - Lists the venue's recent inbound replies as candidates, each with a
 *     "Mark as confirmation" toggle.
 *
 * Timestamps render in America/Toronto with an explicit timeZone so server
 * and client output match (no clock read -> hydration-safe, no mount gate).
 */

import { useToast } from "@/components/ui/toast";
import { captureClientError } from "@/lib/client-error";
import { cn } from "@/lib/cn";
import type { VenueConfirmationMessage } from "@/lib/venue-communication";
import { BadgeCheck, ExternalLink, Mail, Star, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { setEmailConfirmation } from "../_confirmation-actions";

interface Props {
  venueId: string;
  messages: VenueConfirmationMessage[];
}

function fmt(at: Date | string | null): string {
  if (!at) return "unknown date";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Toronto",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(at));
}

export function VenueConfirmationSection({ venueId, messages }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTx] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const flagged = useMemo(() => messages.filter((m) => m.isConfirmation), [messages]);
  const candidates = useMemo(() => messages.filter((m) => !m.isConfirmation), [messages]);

  function toggle(messageId: string, next: boolean) {
    setBusyId(messageId);
    startTx(async () => {
      try {
        const res = await setEmailConfirmation(messageId, next, venueId);
        if (!res.ok) {
          toast.show({
            kind: "error",
            message: res.error ?? "Couldn't update.",
            tag: "venue.confirm",
          });
          setBusyId(null);
          return;
        }
        toast.show({
          kind: "success",
          message: next ? "Flagged as the written confirmation." : "Confirmation flag removed.",
        });
        router.refresh();
      } catch (err) {
        const cap = captureClientError(err, { tag: "venue.confirm", fallback: "Couldn't update." });
        toast.show({ kind: "error", message: cap.message, code: cap.code });
        setBusyId(null);
      }
    });
  }

  const shown = showAll ? candidates : candidates.slice(0, 4);

  return (
    <section className="card-surface overflow-hidden">
      <header className="flex items-center gap-2 border-zinc-200/60 border-b px-5 py-3 dark:border-zinc-800/40">
        <BadgeCheck className="h-4 w-4 text-emerald-500" />
        <h3 className="font-semibold text-sm tracking-tight">Written confirmation</h3>
        {flagged.length > 0 && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-mono text-[9px] text-emerald-800 uppercase tracking-[0.1em] dark:bg-emerald-950/60 dark:text-emerald-200">
            on file
          </span>
        )}
      </header>

      {/* Flagged confirmations -- the proof. */}
      {flagged.length > 0 && (
        <ul className="divide-y divide-emerald-200/50 dark:divide-emerald-900/30">
          {flagged.map((m) => (
            <li key={m.messageId} className="bg-emerald-50/60 px-5 py-3 dark:bg-emerald-950/20">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm">
                    Confirmed by {m.fromName?.trim() || m.fromAddress}
                  </p>
                  <p className="font-mono text-[10px] text-zinc-500 tracking-tight dark:text-zinc-400">
                    {m.fromAddress} &middot; email &middot; {fmt(m.at)}
                  </p>
                  {m.subject && (
                    <p className="mt-1 truncate text-xs text-zinc-700 dark:text-zinc-300">
                      Re: {m.subject}
                    </p>
                  )}
                  {m.snippet && (
                    <p className="mt-0.5 line-clamp-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                      {m.snippet}
                    </p>
                  )}
                  {m.flaggedByName && (
                    <p className="mt-1 font-mono text-[9px] text-emerald-700 uppercase tracking-[0.08em] dark:text-emerald-300">
                      flagged by {m.flaggedByName}
                      {m.flaggedAt ? ` ${fmt(m.flaggedAt)}` : ""}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Link
                    href={`/inbox/${m.threadId}`}
                    className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-white px-2 py-1 font-mono text-[10px] text-emerald-800 uppercase tracking-[0.08em] hover:bg-emerald-50 dark:border-emerald-900/50 dark:bg-zinc-950 dark:text-emerald-200"
                  >
                    <ExternalLink className="h-3 w-3" /> Open
                  </Link>
                  <button
                    type="button"
                    onClick={() => toggle(m.messageId, false)}
                    disabled={pending && busyId === m.messageId}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em] hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50 dark:hover:bg-zinc-800"
                  >
                    <X className="h-3 w-3" /> Unflag
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* No confirmation flagged yet - nudge. */}
      {flagged.length === 0 && (
        <div className="border-zinc-200/40 border-b bg-amber-50/40 px-5 py-2.5 dark:border-zinc-800/30 dark:bg-amber-950/15">
          <p className="text-[11px] text-amber-800 dark:text-amber-300">
            No written confirmation flagged yet. If this venue confirmed by email, mark that reply
            below so it's on file if there's ever a dispute.
          </p>
        </div>
      )}

      {/* Candidate inbound replies. */}
      {candidates.length === 0 ? (
        flagged.length === 0 && (
          <div className="px-5 py-6 text-center text-xs text-zinc-500">
            <Mail className="mx-auto h-5 w-5 text-zinc-300" />
            <p className="mt-2">No replies from this venue yet.</p>
          </div>
        )
      ) : (
        <>
          <p className="px-5 pt-3 pb-1 font-mono text-[9px] text-zinc-400 uppercase tracking-[0.12em]">
            Replies from this venue
          </p>
          <ul className="divide-y divide-zinc-200/60 dark:divide-zinc-800/40">
            {shown.map((m) => (
              <li key={m.messageId} className="flex items-start gap-3 px-5 py-2.5">
                <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs">
                    <span className="font-medium">{m.fromName?.trim() || m.fromAddress}</span>{" "}
                    <span className="font-mono text-[10px] text-zinc-400">{fmt(m.at)}</span>
                  </p>
                  {m.subject && (
                    <p className="truncate text-[11px] text-zinc-600 dark:text-zinc-400">
                      {m.subject}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Link
                    href={`/inbox/${m.threadId}`}
                    title="Open thread"
                    className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                  <button
                    type="button"
                    onClick={() => toggle(m.messageId, true)}
                    disabled={pending && busyId === m.messageId}
                    title="Mark as the written confirmation"
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] disabled:opacity-50",
                      "border-zinc-200 text-zinc-600 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-emerald-900/50 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-200",
                    )}
                  >
                    <Star className="h-3 w-3" /> Mark
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {candidates.length > 4 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="w-full border-zinc-200/60 border-t px-5 py-2 text-center font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em] hover:bg-zinc-50 dark:border-zinc-800/40 dark:hover:bg-zinc-900"
            >
              {showAll ? "Show fewer" : `Show ${candidates.length - 4} more`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
