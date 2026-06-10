"use client";

/**
 * EmailQueueList - client view of the cold-send queue.
 *
 * Three buckets (Queued / Sending / Sent). Queued rows expose Cancel
 * (deletes the draft so it never sends) + Edit (re-opens it in the global
 * composer via the compose-email bridge). Sending rows are mid-dispatch
 * (cron-owned) so they're read-only; Sent rows are history.
 *
 * Times render absolute in the viewer's timezone (deterministic -> no
 * hydration mismatch). A relative "in 6 min" hint is added after mount,
 * where reading the clock is safe.
 */

import { useToast } from "@/components/ui/toast";
import { captureClientError } from "@/lib/client-error";
import type { EmailQueueItem } from "@/lib/email-queue-data";
import { Clock, Loader2, Mail, Pencil, Send, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { deleteDraft } from "../../_actions/email-drafts";

interface Props {
  queued: EmailQueueItem[];
  sending: EmailQueueItem[];
  sent: EmailQueueItem[];
  viewerTimezone: string;
}

export function EmailQueueList({ queued, sending, sent, viewerTimezone }: Props) {
  const router = useRouter();
  // The page is a static server render; without this it would show "sending
  // now..." indefinitely even after the cron actually sends. Poll while items
  // are in-flight so rows flip to "sent" on their own, then stop.
  const pendingCount = queued.length + sending.length;
  useEffect(() => {
    if (pendingCount === 0) return;
    const id = setInterval(() => router.refresh(), 12_000);
    return () => clearInterval(id);
  }, [pendingCount, router]);

  const total = queued.length + sending.length + sent.length;
  if (total === 0) {
    return (
      <div className="card-surface px-6 py-12 text-center">
        <Mail className="mx-auto h-6 w-6 text-zinc-300" />
        <p className="mt-3 text-sm text-zinc-500">Your queue is empty.</p>
        <p className="mt-1 text-xs text-zinc-400">
          Draft a cold email and hit Queue -- it'll appear here with its send time.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {(queued.length > 0 || sending.length > 0) && (
        <Section
          title="Queued"
          count={queued.length + sending.length}
          tone="amber"
          hint="auto-spaced a few minutes apart"
        >
          {sending.map((item) => (
            <QueueRow key={item.id} item={item} state="sending" viewerTimezone={viewerTimezone} />
          ))}
          {queued.map((item) => (
            <QueueRow key={item.id} item={item} state="queued" viewerTimezone={viewerTimezone} />
          ))}
        </Section>
      )}
      {sent.length > 0 && (
        <Section title="Sent" count={sent.length} tone="emerald" hint="last 24 hours">
          {sent.map((item) => (
            <QueueRow key={item.id} item={item} state="sent" viewerTimezone={viewerTimezone} />
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  count,
  tone,
  hint,
  children,
}: {
  title: string;
  count: number;
  tone: "amber" | "emerald";
  hint: string;
  children: React.ReactNode;
}) {
  const dot = tone === "amber" ? "bg-amber-500" : "bg-emerald-500";
  return (
    <section className="card-surface overflow-hidden">
      <header className="flex items-center gap-2 border-zinc-200/60 border-b px-5 py-3 dark:border-zinc-800/40">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        <h2 className="font-semibold text-sm tracking-tight">{title}</h2>
        <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em] tabular-nums">
          {count}
        </span>
        <span className="ml-auto font-mono text-[10px] text-zinc-400 uppercase tracking-[0.08em]">
          {hint}
        </span>
      </header>
      <ul className="divide-y divide-zinc-200/60 dark:divide-zinc-800/40">{children}</ul>
    </section>
  );
}

function QueueRow({
  item,
  state,
  viewerTimezone,
}: {
  item: EmailQueueItem;
  state: "queued" | "sending" | "sent";
  viewerTimezone: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTx] = useTransition();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const recipient = item.venueName ?? item.toAddresses[0] ?? "(no recipient)";
  const when = state === "sent" ? item.sentAt : item.scheduledFor;
  const absolute = when ? formatAbsolute(when, viewerTimezone) : "";
  const relative = mounted && when && state === "queued" ? formatRelative(when) : "";

  function cancel() {
    startTx(async () => {
      try {
        const res = await deleteDraft(item.id);
        if (!res.ok) {
          toast.show({
            kind: "error",
            message: res.error ?? "Couldn't cancel.",
            tag: "queue.cancel",
          });
          return;
        }
        toast.show({ kind: "success", message: "Removed from queue." });
        router.refresh();
      } catch (err) {
        const cap = captureClientError(err, { tag: "queue.cancel", fallback: "Couldn't cancel." });
        toast.show({ kind: "error", message: cap.message, code: cap.code });
      }
    });
  }

  function edit() {
    window.dispatchEvent(new CustomEvent("compose-email", { detail: { hydrateDraftId: item.id } }));
  }

  return (
    <li className={`flex items-start gap-3 px-5 py-3 ${pending ? "opacity-50" : ""}`}>
      <div className="mt-0.5 shrink-0 text-zinc-400">
        {state === "sending" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />
        ) : state === "sent" ? (
          <Send className="h-3.5 w-3.5 text-emerald-500" />
        ) : (
          <Clock className="h-3.5 w-3.5" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-sm">{item.subject || "(no subject)"}</p>
        <p className="truncate font-mono text-[10px] text-zinc-500 tracking-tight dark:text-zinc-400">
          {recipient}
        </p>
        <p className="mt-0.5 font-mono text-[10px] text-zinc-400 tabular-nums">
          {state === "sending"
            ? "sending now..."
            : state === "sent"
              ? `sent ${absolute}`
              : `sends ${absolute}${relative ? ` (${relative})` : ""}`}
        </p>
      </div>
      {state === "queued" && (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={edit}
            disabled={pending}
            title="Edit in composer"
            aria-label={`Edit ${item.subject}`}
            className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={cancel}
            disabled={pending}
            title="Cancel -- remove from queue"
            aria-label={`Cancel ${item.subject}`}
            className="rounded p-1 text-zinc-400 transition-colors hover:bg-rose-500/[0.08] hover:text-rose-600 dark:hover:bg-rose-500/[0.12] dark:hover:text-rose-400"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </li>
  );
}

/** Absolute time in the viewer's timezone -- deterministic across SSR/CSR. */
function formatAbsolute(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  }).format(new Date(iso));
}

/** "in 6 min" / "in 2 hr" -- relies on the clock, mount-gated by the caller. */
function formatRelative(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  if (diffMs <= 0) return "any moment";
  const min = Math.round(diffMs / 60_000);
  if (min < 60) return `in ${min} min`;
  const hr = Math.round(min / 60);
  return `in ${hr} hr`;
}
