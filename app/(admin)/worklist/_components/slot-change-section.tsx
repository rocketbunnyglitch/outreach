"use client";

/**
 * SlotChangeSection (Phase 3.5) -- a CONFIRMED venue replied asking to move to a
 * different day/slot (detected by the heuristic flag, NOT an AI enum). The
 * operator drives the swap: Approve swap opens a picker (the venue's current
 * confirmed slot -> an open slot on the campaign), which cancels the old slot
 * and confirms the new one. Open thread / Dismiss are the other two outs.
 *
 * Visual style mirrors comebacks-section.tsx exactly (card-surface, badge,
 * mono uppercase buttons, useTransition, router.refresh).
 */

import { useToast } from "@/components/ui/toast";
import { captureClientError } from "@/lib/client-error";
import type { WorklistSlotChangeRow } from "@/lib/worklist-data";
import { CalendarClock, ExternalLink, Loader2, Repeat2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  type SlotChangeOptions,
  approveSlotSwap,
  dismissSlotChange,
  loadSlotChangeOptions,
} from "../_slot-change-actions";

function fmtDate(value: string | null): string {
  if (!value) return "unknown";
  // event_date is a date-only string (YYYY-MM-DD); pin UTC so it never shifts.
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));
}

function slotLabel(role: string, slotPosition: number | null): string {
  const r = role.charAt(0).toUpperCase() + role.slice(1).replace("_", " ");
  return slotPosition && slotPosition > 1 ? `${r} ${slotPosition}` : r;
}

function Picker({
  row,
  options,
  onDone,
}: {
  row: WorklistSlotChangeRow;
  options: SlotChangeOptions;
  onDone: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTx] = useTransition();
  const [fromId, setFromId] = useState(
    () =>
      options.current.find((c) => c.venueEventId === row.fromVenueEventId)?.venueEventId ??
      options.current[0]?.venueEventId ??
      "",
  );
  // Encode the target as "eventId|role|slotPosition" in one select.
  const [toKey, setToKey] = useState("");

  function approve() {
    const from = options.current.find((c) => c.venueEventId === fromId);
    if (!from) {
      toast.show({ kind: "error", message: "Pick the current slot to move." });
      return;
    }
    const target = options.open.find((o) => `${o.eventId}|${o.role}|${o.slotPosition}` === toKey);
    if (!target) {
      toast.show({ kind: "error", message: "Pick a slot to move into." });
      return;
    }
    startTx(async () => {
      try {
        const res = await approveSlotSwap({
          threadId: row.threadId,
          fromVenueEventId: from.venueEventId,
          toEventId: target.eventId,
          toRole: target.role,
          toSlotPosition: target.slotPosition,
        });
        if (!res.ok) {
          toast.show({ kind: "error", message: res.error ?? "Couldn't swap." });
          return;
        }
        toast.show({ kind: "success", message: `Moved ${row.venueName} to a new slot.` });
        router.refresh();
        onDone();
      } catch (err) {
        const cap = captureClientError(err, {
          tag: "worklist.slotswap",
          fallback: "Couldn't swap.",
        });
        toast.show({ kind: "error", message: cap.message, code: cap.code });
      }
    });
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-lg border border-zinc-200 bg-zinc-50/50 p-2.5 dark:border-zinc-800 dark:bg-zinc-900/40">
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-[0.1em]">
          Cancel current slot
        </span>
        <select
          value={fromId}
          onChange={(e) => setFromId(e.target.value)}
          disabled={pending}
          className="rounded-md border border-zinc-200 bg-transparent px-2 py-1 text-xs dark:border-zinc-700"
        >
          {options.current.length === 0 ? <option value="">No confirmed slot found</option> : null}
          {options.current.map((c) => (
            <option key={c.venueEventId} value={c.venueEventId}>
              {fmtDate(c.eventDate)} -- {slotLabel(c.role, c.slotPosition)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-[0.1em]">
          Move into open slot
        </span>
        <select
          value={toKey}
          onChange={(e) => setToKey(e.target.value)}
          disabled={pending}
          className="rounded-md border border-zinc-200 bg-transparent px-2 py-1 text-xs dark:border-zinc-700"
        >
          <option value="">Pick a slot...</option>
          {options.open.map((o) => {
            const key = `${o.eventId}|${o.role}|${o.slotPosition}`;
            const crawl = o.crawlNumber ? `Crawl ${o.crawlNumber}` : (o.routeLabel ?? "Crawl");
            return (
              <option key={key} value={key}>
                {fmtDate(o.eventDate)} -- {crawl} -- {slotLabel(o.role, o.slotPosition)}
              </option>
            );
          })}
        </select>
        {options.open.length === 0 ? (
          <span className="text-[10px] text-zinc-400">
            No open slots on this campaign. Free one up first, or open the thread to reply.
          </span>
        ) : null}
      </label>
      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          onClick={onDone}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 font-mono text-[10px] text-zinc-600 uppercase tracking-[0.08em] hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={approve}
          disabled={pending || options.open.length === 0}
          className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 font-mono text-[10px] text-emerald-800 uppercase tracking-[0.08em] hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200"
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Repeat2 className="h-3 w-3" />}
          Confirm swap
        </button>
      </div>
    </div>
  );
}

function Row({ row }: { row: WorklistSlotChangeRow }) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTx] = useTransition();
  const [loadingOpts, setLoadingOpts] = useState(false);
  const [options, setOptions] = useState<SlotChangeOptions | null>(null);

  function openPicker() {
    setLoadingOpts(true);
    startTx(async () => {
      try {
        const res = await loadSlotChangeOptions(row.threadId);
        if (!res.ok) {
          toast.show({ kind: "error", message: res.error ?? "Couldn't load options." });
          return;
        }
        setOptions(res.data);
      } catch (err) {
        const cap = captureClientError(err, {
          tag: "worklist.slotchange.load",
          fallback: "Couldn't load options.",
        });
        toast.show({ kind: "error", message: cap.message, code: cap.code });
      } finally {
        setLoadingOpts(false);
      }
    });
  }

  function dismiss() {
    startTx(async () => {
      try {
        const res = await dismissSlotChange(row.threadId);
        if (!res.ok) {
          toast.show({ kind: "error", message: res.error ?? "Couldn't dismiss." });
          return;
        }
        toast.show({ kind: "success", message: "Dismissed." });
        router.refresh();
      } catch (err) {
        const cap = captureClientError(err, {
          tag: "worklist.slotchange.dismiss",
          fallback: "Couldn't dismiss.",
        });
        toast.show({ kind: "error", message: cap.message, code: cap.code });
      }
    });
  }

  return (
    <li className="flex flex-col gap-0 rounded-xl border border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-sm">
            {row.venueName}
            {row.cityName ? <span className="text-zinc-500"> &middot; {row.cityName}</span> : null}
          </p>
          <p className="truncate font-mono text-[10px] text-zinc-400">
            {row.matchedPhrase ? `matched "${row.matchedPhrase}"` : "wants a different slot"}{" "}
            &middot; confirmed venue -- pick a new slot
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Link
            href={`/inbox/${row.threadId}`}
            title="Open thread"
            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 font-mono text-[10px] text-zinc-600 uppercase tracking-[0.08em] hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <ExternalLink className="h-3 w-3" /> Thread
          </Link>
          <button
            type="button"
            onClick={dismiss}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 font-mono text-[10px] text-zinc-600 uppercase tracking-[0.08em] hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <X className="h-3 w-3" /> Dismiss
          </button>
          <button
            type="button"
            onClick={openPicker}
            disabled={pending || options !== null}
            className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 font-mono text-[10px] text-amber-800 uppercase tracking-[0.08em] hover:bg-amber-100 disabled:opacity-50 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
          >
            {loadingOpts ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Repeat2 className="h-3 w-3" />
            )}
            Approve swap
          </button>
        </div>
      </div>
      {options ? <Picker row={row} options={options} onDone={() => setOptions(null)} /> : null}
    </li>
  );
}

export function SlotChangeSection({ slotChanges }: { slotChanges: WorklistSlotChangeRow[] }) {
  if (slotChanges.length === 0) return null;
  return (
    <section className="card-surface overflow-hidden">
      <header className="flex items-center gap-2 border-zinc-200/60 border-b px-5 py-3 dark:border-zinc-800/40">
        <CalendarClock className="h-4 w-4 text-amber-500" />
        <h3 className="font-semibold text-sm tracking-tight">Slot change requested</h3>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-mono text-[9px] text-zinc-500 uppercase tracking-[0.1em] dark:bg-zinc-800 dark:text-zinc-400">
          {slotChanges.length}
        </span>
      </header>
      <ul className="flex flex-col gap-2 p-3">
        {slotChanges.map((s) => (
          <Row key={s.threadId} row={s} />
        ))}
      </ul>
    </section>
  );
}
