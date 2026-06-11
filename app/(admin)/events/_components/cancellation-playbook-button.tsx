"use client";

/**
 * CancellationPlaybookButton (CRM plan B3) — guided cancellation for ONE
 * venue-event night.
 *
 * The engine side (lib/cancellation-flow.ts) already stops this night's
 * lifecycle emails + auto tasks and drafts the T16. This modal adds the
 * guidance the audit asked for:
 *   - the EXACT venue + role + night is displayed (a cancellation cannot
 *     target the wrong night — the button is bound to one venue_event id),
 *   - cancelled-by-venue vs cancelled-by-us is recorded in the reason,
 *   - "what will stop" (drafts deleted, scheduled sends stopped, auto tasks
 *     cancelled, T16 drafted for review) is shown BEFORE confirming,
 *   - on success, if the night was confirmed, the emergency replacement
 *     playbook is offered with the cancelled role preselected.
 */

import { useToast } from "@/components/ui/toast";
import { captureClientError } from "@/lib/client-error";
import type { ReplacementRole } from "@/lib/emergency-replacement";
import { AlertTriangle, CalendarX2, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  type CancellationPreview,
  type GuidedCancellationResult,
  previewVenueCancellation,
  runGuidedCancellation,
} from "../_cancellation-actions";
import { EmergencyReplacementModal } from "./emergency-replacement-button";

const REPLACEABLE_ROLES: readonly string[] = ["wristband", "middle", "final", "alt_final"];

export function CancellationPlaybookButton({
  venueEventId,
  eventId,
  venueName,
}: {
  venueEventId: string;
  eventId: string;
  venueName: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-rose-200 px-2.5 py-1.5 font-medium text-rose-600 text-xs hover:bg-rose-50 dark:border-rose-900/40 dark:text-rose-300 dark:hover:bg-rose-950/30"
        title="Guided cancellation: see exactly what stops before confirming"
      >
        <CalendarX2 className="h-3.5 w-3.5" /> Cancel night…
      </button>
      {open && (
        <CancellationModal
          onClose={() => setOpen(false)}
          venueEventId={venueEventId}
          eventId={eventId}
          venueName={venueName}
        />
      )}
    </>
  );
}

function CancellationModal({
  onClose,
  venueEventId,
  eventId,
  venueName,
}: {
  onClose: () => void;
  venueEventId: string;
  eventId: string;
  venueName: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [preview, setPreview] = useState<CancellationPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [byVenue, setByVenue] = useState(true);
  const [reason, setReason] = useState("");
  const [pending, startTx] = useTransition();
  const [done, setDone] = useState<GuidedCancellationResult | null>(null);
  const [replOpen, setReplOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    previewVenueCancellation(venueEventId)
      .then((res) => {
        if (cancelled) return;
        if (res.ok) setPreview(res.data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [venueEventId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function run() {
    startTx(async () => {
      try {
        const res = await runGuidedCancellation({
          venueEventId,
          cancelledByVenue: byVenue,
          reason,
        });
        if (!res.ok) {
          toast.show({ kind: "error", message: res.error ?? "Cancellation failed." });
          return;
        }
        setDone(res.data);
        router.refresh();
      } catch (err) {
        const cap = captureClientError(err, {
          tag: "events.cancellation-playbook",
          fallback: "Cancellation failed.",
        });
        toast.show({ kind: "error", message: cap.message, code: cap.code });
      }
    });
  }

  const canRun = reason.trim().length >= 3 && !pending && !done;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onClose}
    >
      <div
        className="card-surface flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-zinc-200/60 border-b px-5 py-3 dark:border-zinc-800/40">
          <CalendarX2 className="h-4 w-4 text-rose-500" />
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-sm tracking-tight">Cancel {venueName}</h3>
            <p className="truncate text-[11px] text-zinc-500">
              {preview
                ? `${preview.role} slot · night of ${preview.eventDate}`
                : "Loading night details…"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {done ? (
          <div className="flex flex-col gap-3 px-5 py-4">
            <p className="text-sm">
              Cancelled. {done.draftsCancelled} unsent email
              {done.draftsCancelled === 1 ? "" : "s"} deleted, {done.tasksCancelled} task
              {done.tasksCancelled === 1 ? "" : "s"} cancelled
              {done.t16Drafted ? ", T16 cancellation email drafted for review" : ""}.
            </p>
            {done.offerReplacement && REPLACEABLE_ROLES.includes(done.role) && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/40 dark:bg-amber-950/20">
                <p className="flex items-start gap-2 text-amber-800 text-xs dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  This crawl still needs a {done.role} venue for that night.
                </p>
                <button
                  type="button"
                  onClick={() => setReplOpen(true)}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-rose-300 bg-rose-50 px-3 py-1.5 font-medium text-rose-700 text-xs hover:bg-rose-100 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200"
                >
                  Start emergency replacement push
                </button>
              </div>
            )}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                Done
              </button>
            </div>
            {replOpen && (
              <EmergencyReplacementModal
                open
                onClose={() => {
                  setReplOpen(false);
                  onClose();
                }}
                eventId={eventId}
                initialRole={done.role as ReplacementRole}
              />
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3 px-5 py-4">
              <fieldset className="flex flex-col gap-1.5">
                <legend className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
                  Who cancelled?
                </legend>
                <div className="flex gap-2">
                  <label className="flex flex-1 cursor-pointer items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm has-[:checked]:border-rose-300 has-[:checked]:bg-rose-50 dark:border-zinc-700 dark:has-[:checked]:border-rose-900/50 dark:has-[:checked]:bg-rose-950/20">
                    <input
                      type="radio"
                      name="cancelledBy"
                      checked={byVenue}
                      onChange={() => setByVenue(true)}
                    />
                    The venue pulled out
                  </label>
                  <label className="flex flex-1 cursor-pointer items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm has-[:checked]:border-rose-300 has-[:checked]:bg-rose-50 dark:border-zinc-700 dark:has-[:checked]:border-rose-900/50 dark:has-[:checked]:bg-rose-950/20">
                    <input
                      type="radio"
                      name="cancelledBy"
                      checked={!byVenue}
                      onChange={() => setByVenue(false)}
                    />
                    We cancelled
                  </label>
                </div>
              </fieldset>

              <label className="flex flex-col gap-1 text-xs">
                <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
                  Reason
                </span>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Double-booked their patio for a private event"
                  maxLength={500}
                  className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                />
              </label>

              <div className="rounded-lg border border-zinc-200/80 bg-zinc-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900/40">
                <p className="mb-1 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
                  What happens
                </p>
                {loading || !preview ? (
                  <p className="flex items-center gap-2 text-zinc-500">
                    <Loader2 className="h-3 w-3 animate-spin" /> Checking this night…
                  </p>
                ) : (
                  <ul className="flex list-disc flex-col gap-0.5 pl-4 text-zinc-600 dark:text-zinc-300">
                    <li>
                      {preview.unsentDrafts} unsent email{preview.unsentDrafts === 1 ? "" : "s"} for
                      this night deleted
                      {preview.scheduledDrafts > 0
                        ? ` (${preview.scheduledDrafts} scheduled send${
                            preview.scheduledDrafts === 1 ? "" : "s"
                          } stopped)`
                        : ""}
                    </li>
                    <li>
                      {preview.pendingAutoTasks} pending auto task
                      {preview.pendingAutoTasks === 1 ? "" : "s"} cancelled
                    </li>
                    <li>T16 cancellation email drafted for review (nothing auto-sends)</li>
                    <li>Other nights for this venue are NOT touched</li>
                  </ul>
                )}
              </div>
            </div>

            <footer className="flex items-center justify-end gap-3 border-zinc-200/60 border-t px-5 py-3 dark:border-zinc-800/40">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                Keep the night
              </button>
              <button
                type="button"
                onClick={run}
                disabled={!canRun}
                className="inline-flex items-center gap-1.5 rounded-md border border-rose-300 bg-rose-50 px-3 py-1.5 font-medium text-rose-700 text-sm hover:bg-rose-100 disabled:opacity-50 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200"
              >
                {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Cancel this night
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
