"use client";

/**
 * EmergencyReplacementButton (Phase 6.2) -- one-click "emergency replacement
 * mode" for an open slot on a crawl. [ReferenceDoc 7.16.3]
 *
 * Opens a modal that:
 *   - lets the operator pick the open role (+ optional slot position),
 *   - loads candidate backup venues (known partners first) and lets them
 *     deselect any,
 *   - takes a short reason,
 *   - batch-drafts the replacement push (review-and-send drafts; cadence floors
 *     suspended at send time via the returned override reason).
 *
 * Nothing is auto-sent: the drafts land in the composer/worklist for the
 * operator to review + fire. Mirrors the HandoffModal pattern.
 */

import { useToast } from "@/components/ui/toast";
import { captureClientError } from "@/lib/client-error";
import type {
  ReplacementCallContext,
  ReplacementCandidate,
  ReplacementRole,
} from "@/lib/emergency-replacement";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { QuoDialControls } from "../../city-campaigns/_components/quo-dial-controls";
import {
  loadEmergencyReplacementCandidates,
  runEmergencyReplacement,
} from "../_emergency-replacement-actions";

const ROLES: { value: ReplacementRole; label: string }[] = [
  { value: "wristband", label: "Wristband (check-in)" },
  { value: "middle", label: "Middle" },
  { value: "final", label: "Final" },
  { value: "alt_final", label: "Alt final" },
];

export function EmergencyReplacementButton({ eventId }: { eventId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-rose-300 bg-rose-50 px-3 py-1.5 font-medium text-rose-700 text-sm hover:bg-rose-100 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200"
        title="Mass push to backup venues for a dropped slot (suspends cadence floors)"
      >
        <AlertTriangle className="h-3.5 w-3.5" /> Emergency replacement
      </button>
      <EmergencyReplacementModal open={open} onClose={() => setOpen(false)} eventId={eventId} />
    </>
  );
}

export function EmergencyReplacementModal({
  open,
  onClose,
  eventId,
  initialRole,
}: {
  open: boolean;
  onClose: () => void;
  eventId: string;
  /** Preselect the open role (e.g. when launched from the cancellation
   *  playbook, the cancelled slot's role). */
  initialRole?: ReplacementRole;
}) {
  const router = useRouter();
  const toast = useToast();
  const [candidates, setCandidates] = useState<ReplacementCandidate[] | null>(null);
  const [callContext, setCallContext] = useState<ReplacementCallContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [role, setRole] = useState<ReplacementRole>(initialRole ?? "wristband");
  const [slotPosition, setSlotPosition] = useState("");
  const [reason, setReason] = useState("");
  const [pending, startTx] = useTransition();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setCandidates(null);
    loadEmergencyReplacementCandidates(eventId)
      .then((res) => {
        if (cancelled) return;
        const list = res.ok ? res.data.candidates : [];
        setCandidates(list);
        setCallContext(res.ok ? res.data.callContext : null);
        setSelected(new Set(list.map((c) => c.venueId)));
      })
      .catch(() => {
        if (!cancelled) setCandidates([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, eventId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  function toggle(venueId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(venueId)) next.delete(venueId);
      else next.add(venueId);
      return next;
    });
  }

  function run() {
    const slot = slotPosition.trim() === "" ? null : Number.parseInt(slotPosition, 10);
    startTx(async () => {
      try {
        const res = await runEmergencyReplacement({
          eventId,
          role,
          slotPosition: Number.isFinite(slot) ? slot : null,
          reason,
          venueIds: Array.from(selected),
        });
        if (!res.ok) {
          toast.show({ kind: "error", message: res.error ?? "Replacement push failed." });
          return;
        }
        toast.show({
          kind: "success",
          message: `Drafted ${res.data.draftsCreated} replacement email${
            res.data.draftsCreated === 1 ? "" : "s"
          } (review + send in the inbox).`,
        });
        onClose();
        router.refresh();
      } catch (err) {
        const cap = captureClientError(err, {
          tag: "events.emergency-replacement",
          fallback: "Replacement push failed.",
        });
        toast.show({ kind: "error", message: cap.message, code: cap.code });
      }
    });
  }

  const canRun = reason.trim().length >= 3 && selected.size > 0 && !pending;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onClose}
    >
      <div
        className="card-surface flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-zinc-200/60 border-b px-5 py-3 dark:border-zinc-800/40">
          <AlertTriangle className="h-4 w-4 text-rose-500" />
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-sm tracking-tight">Emergency replacement push</h3>
            <p className="truncate text-[11px] text-zinc-500">
              Mass-draft to backup venues. Cadence floors are suspended on send.
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

        <div className="flex flex-col gap-3 px-5 py-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
                Open role
              </span>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as ReplacementRole)}
                className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
                Slot # (optional)
              </span>
              <input
                type="number"
                min={1}
                value={slotPosition}
                onChange={(e) => setSlotPosition(e.target.value)}
                placeholder="e.g. 2"
                className="w-24 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-xs">
            <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
              Reason
            </span>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Wristband venue cancelled, 5 days out"
              maxLength={500}
              className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto border-zinc-200/60 border-t px-2 py-2 dark:border-zinc-800/40">
          {loading ? (
            <div className="flex items-center justify-center gap-2 px-3 py-8 text-xs text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading backup venues...
            </div>
          ) : !candidates || candidates.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-zinc-500">
              No reachable backup venues found for this city.
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {candidates.map((c) => (
                <li key={c.venueId}>
                  <div className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-900">
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selected.has(c.venueId)}
                        onChange={() => toggle(c.venueId)}
                        className="h-4 w-4"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-sm">
                          {c.name}
                          {c.knownPartner && (
                            <span className="ml-2 rounded-full bg-emerald-100 px-1.5 py-0.5 font-mono text-[9px] text-emerald-700 uppercase tracking-[0.08em] dark:bg-emerald-950/40 dark:text-emerald-200">
                              past partner
                            </span>
                          )}
                          {c.warmThread && (
                            <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 font-mono text-[9px] text-amber-700 uppercase tracking-[0.08em] dark:bg-amber-950/40 dark:text-amber-200">
                              replies
                            </span>
                          )}
                        </p>
                        <p className="truncate font-mono text-[10px] text-zinc-500">
                          {c.email ?? "no email -- will be skipped"}
                        </p>
                      </div>
                    </label>
                    {c.phoneE164 && c.coldEntryId && callContext ? (
                      <QuoDialControls
                        venueId={c.venueId}
                        venueName={c.name}
                        venuePhone={c.phoneE164}
                        outreachBrandId={callContext.outreachBrandId}
                        cityCampaignId={callContext.cityCampaignId}
                        coldEntryId={c.coldEntryId}
                      />
                    ) : c.phoneE164 ? (
                      <a
                        href={`tel:${c.phoneE164}`}
                        className="shrink-0 font-mono text-[10px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                        title="Call (no cold-outreach row on this campaign, so the call won't auto-log)"
                      >
                        {c.phoneE164}
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-zinc-200/60 border-t px-5 py-3 dark:border-zinc-800/40">
          <p className="font-mono text-[10px] text-zinc-400">
            {selected.size} selected. Drafts land in the inbox for review + send.
          </p>
          <button
            type="button"
            onClick={run}
            disabled={!canRun}
            className="inline-flex items-center gap-1.5 rounded-md border border-rose-300 bg-rose-50 px-3 py-1.5 font-medium text-rose-700 text-sm hover:bg-rose-100 disabled:opacity-50 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Draft replacement push
          </button>
        </footer>
      </div>
    </div>
  );
}
