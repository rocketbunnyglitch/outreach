"use client";

/**
 * HandoffModal (Phase 2.14) -- pick a brand to hand an exhausted venue to.
 *
 * Lists the org's other active brands, each with its last touch to this venue
 * and whether the 7-day cross-domain floor is met. Selecting a brand resets the
 * venue's cadence + re-attributes the thread, then opens a fresh cold draft in
 * the composer (where the operator picks that brand's inbox/alias to send from).
 */

import { useToast } from "@/components/ui/toast";
import { captureClientError } from "@/lib/client-error";
import { cn } from "@/lib/cn";
import { ArrowRightLeft, Clock, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  type HandoffBrandOption,
  handoffColdOutreach,
  loadHandoffOptions,
} from "../_handoff-actions";

interface Props {
  open: boolean;
  onClose: () => void;
  entryId: string;
  venueId: string;
  venueName: string;
  venueEmail: string | null;
  cityCampaignId: string;
}

type HandoffButtonProps = Omit<Props, "open" | "onClose">;

/**
 * Row-level entry point: a compact "Handoff" button that owns its modal open
 * state, so the giant cold-outreach table doesn't have to thread modal state
 * through every row. Rendered only on exhausted (ready-for-handoff) rows.
 */
export function HandoffButton(props: HandoffButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 inline-flex items-center gap-1 rounded-md border border-blue-300 bg-blue-50 px-1.5 py-0.5 font-mono text-[9px] text-blue-700 uppercase tracking-[0.08em] hover:bg-blue-100 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200"
        title="Hand off to another domain (cross-domain re-pitch)"
      >
        <ArrowRightLeft className="h-2.5 w-2.5" /> Handoff
      </button>
      <HandoffModal open={open} onClose={() => setOpen(false)} {...props} />
    </>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return "never";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Toronto",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

export function HandoffModal({
  open,
  onClose,
  entryId,
  venueId,
  venueName,
  venueEmail,
  cityCampaignId,
}: Props) {
  const router = useRouter();
  const toast = useToast();
  const [options, setOptions] = useState<HandoffBrandOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyBrand, setBusyBrand] = useState<string | null>(null);
  const [pending, startTx] = useTransition();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setOptions(null);
    loadHandoffOptions(venueId, cityCampaignId)
      .then((opts) => {
        if (!cancelled) setOptions(opts);
      })
      .catch(() => {
        if (!cancelled) setOptions([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, venueId, cityCampaignId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  function handoff(brandId: string) {
    setBusyBrand(brandId);
    startTx(async () => {
      try {
        const res = await handoffColdOutreach({ entryId, targetBrandId: brandId });
        if (!res.ok) {
          toast.show({ kind: "error", message: res.error ?? "Couldn't hand off." });
          setBusyBrand(null);
          return;
        }
        toast.show({ kind: "success", message: "Handed off -- drafting a fresh opener." });
        // Open a fresh cold draft; the composer engine-picks T1 and the operator
        // selects the new brand's inbox/alias to send from.
        window.dispatchEvent(
          new CustomEvent("compose-email", {
            detail: { venueId, cityCampaignId, to: venueEmail ?? "" },
          }),
        );
        onClose();
        router.refresh();
      } catch (err) {
        const cap = captureClientError(err, {
          tag: "cold.handoff",
          fallback: "Couldn't hand off.",
        });
        toast.show({ kind: "error", message: cap.message, code: cap.code });
        setBusyBrand(null);
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onClose}
    >
      <div
        className="card-surface w-full max-w-md overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-zinc-200/60 border-b px-5 py-3 dark:border-zinc-800/40">
          <ArrowRightLeft className="h-4 w-4 text-blue-500" />
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-sm tracking-tight">Hand off to another domain</h3>
            <p className="truncate text-[11px] text-zinc-500">{venueName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="px-2 py-2">
          {loading ? (
            <div className="flex items-center justify-center gap-2 px-3 py-8 text-xs text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading brands...
            </div>
          ) : !options || options.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-zinc-500">
              No other active brands to hand off to.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {options.map((o) => (
                <li
                  key={o.brandId}
                  className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-sm">{o.brandName}</p>
                    <p className="truncate font-mono text-[10px] text-zinc-500">
                      {o.emailDomain} &middot; last touch {fmtDate(o.lastTouchFromBrandAt)}
                    </p>
                  </div>
                  {o.floorMet ? (
                    <button
                      type="button"
                      onClick={() => handoff(o.brandId)}
                      disabled={pending && busyBrand === o.brandId}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-blue-300 bg-blue-50 px-2.5 py-1 font-mono text-[10px] text-blue-700 uppercase tracking-[0.08em] hover:bg-blue-100 disabled:opacity-50 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200"
                    >
                      {pending && busyBrand === o.brandId ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <ArrowRightLeft className="h-3 w-3" />
                      )}
                      Hand off
                    </button>
                  ) : (
                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em]",
                        "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500",
                      )}
                      title="7-day cross-domain floor not met yet"
                    >
                      <Clock className="h-3 w-3" /> {fmtDate(o.floorAvailableAt)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="border-zinc-200/40 border-t px-5 py-2 text-[10px] text-zinc-400 dark:border-zinc-800/30">
          Resets the venue's cadence to a fresh cold sequence and opens an opener draft. The 7-day
          floor protects deliverability across domains.
        </p>
      </div>
    </div>
  );
}
