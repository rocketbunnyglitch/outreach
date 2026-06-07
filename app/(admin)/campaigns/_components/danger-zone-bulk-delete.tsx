"use client";

/**
 * DangerZoneBulkDelete — two admin-only nuke options that live in the
 * campaign-detail danger zone next to DeleteCampaignButton.
 *
 * 1. Wipe city roster
 *    Hard-deletes EVERY city_campaign row in this campaign. Cascades
 *    to events + cold-outreach via FK. The campaign itself is kept so
 *    the operator can re-populate the roster.
 *    Confirmation: type the exact campaign name (matches the existing
 *    delete-campaign pattern — friction is the point).
 *
 * 2. Delete all crawls on a date
 *    Hard-deletes every events row in this campaign on a YYYY-MM-DD.
 *    Per-city assignments stay intact. Confirmation: pick a date from
 *    a date input, then a second-step "yes really" button (the date
 *    itself is the friction; the operator has to deliberately pick).
 *
 * Both gated behind isAdmin so non-admins can't even see the buttons.
 */

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { AlertTriangle, CalendarDays, Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteAllCitiesFromCampaign, deleteCrawlsOnDate } from "../_actions";

interface Props {
  campaignId: string;
  campaignName: string;
  /** Render nothing if the viewer isn't an admin. */
  isAdmin: boolean;
  /** Total cities currently on this campaign — informs the wipe-
   *  roster confirmation copy. */
  cityCount: number;
}

export function DangerZoneBulkDelete({ campaignId, campaignName, isAdmin, cityCount }: Props) {
  if (!isAdmin) return null;
  return (
    <div className="flex flex-col gap-3">
      <WipeRosterPanel campaignId={campaignId} campaignName={campaignName} cityCount={cityCount} />
      <DeleteDatePanel campaignId={campaignId} />
    </div>
  );
}

// =========================================================================
// Panel 1 — wipe entire city roster
// =========================================================================

function WipeRosterPanel({
  campaignId,
  campaignName,
  cityCount,
}: {
  campaignId: string;
  campaignName: string;
  cityCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTx] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const trapRef = useFocusTrap<HTMLDivElement>(open);

  function submit() {
    setError(null);
    startTx(async () => {
      const result = await deleteAllCitiesFromCampaign({
        campaignId,
        confirmCampaignName: confirmText,
      });
      if (!result.ok) {
        setError(result.error ?? "Couldn't wipe roster.");
        toast.show({
          kind: "error",
          message: result.error ?? "Couldn't wipe roster.",
          code: (result as { code?: string }).code,
        });
        return;
      }
      toast.show({
        kind: "success",
        message: `Wiped roster: ${result.data.cityCampaignsDeleted} ${result.data.cityCampaignsDeleted === 1 ? "city" : "cities"} and ${result.data.eventsDeleted} crawl${result.data.eventsDeleted === 1 ? "" : "s"} removed.`,
      });
      setOpen(false);
      setConfirmText("");
      router.refresh();
    });
  }

  return (
    <>
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200/60 bg-rose-50/40 p-4",
          "dark:border-rose-900/40 dark:bg-rose-950/20",
        )}
      >
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium text-rose-900 text-sm dark:text-rose-200">
            <AlertTriangle className="h-3.5 w-3.5" />
            Wipe city roster
          </p>
          <p className="mt-1 text-rose-800/80 text-xs dark:text-rose-300/70">
            Hard-deletes every city_campaign row on this campaign{" "}
            {cityCount > 0 ? (
              <>
                ({cityCount} {cityCount === 1 ? "city" : "cities"})
              </>
            ) : null}{" "}
            and every crawl underneath. The campaign itself is kept; you can re-populate the roster
            afterwards. <strong>Cannot be undone.</strong> Admin only.
          </p>
        </div>
        <Button
          type="button"
          variant="destructive"
          onClick={() => setOpen(true)}
          disabled={cityCount === 0}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Wipe roster…
        </Button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 px-6"
          onClick={() => !pending && setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !pending) setOpen(false);
          }}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
        >
          <div
            ref={trapRef}
            tabIndex={-1}
            className={cn(
              "card-surface w-full max-w-md p-6 outline-none",
              "animate-[fade-in_200ms_ease-out]",
            )}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-rose-100 p-2 dark:bg-rose-950">
                <AlertTriangle className="h-5 w-5 text-rose-600 dark:text-rose-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-lg tracking-tight">Wipe city roster?</h3>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  This removes <strong>every city</strong> from <strong>{campaignName}</strong> and{" "}
                  <strong>every crawl</strong> underneath. The campaign itself stays.{" "}
                  <strong>Not reversible from the UI.</strong>
                </p>
              </div>
            </div>
            <label className="mt-5 block">
              <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
                Type the campaign name to confirm
              </span>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={campaignName}
                disabled={pending}
                className={cn(
                  "mt-1.5 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm",
                  "focus:border-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-500/20",
                  "dark:border-zinc-700 dark:bg-zinc-900",
                )}
              />
            </label>
            {error && (
              <p
                className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800 text-xs dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200"
                role="alert"
              >
                {error}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={submit}
                disabled={pending || confirmText !== campaignName}
              >
                {pending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                Wipe roster
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// =========================================================================
// Panel 2 — delete all crawls on a specific date
// =========================================================================

function DeleteDatePanel({ campaignId }: { campaignId: string }) {
  const [date, setDate] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTx] = useTransition();
  const router = useRouter();
  const toast = useToast();

  function submit() {
    setError(null);
    startTx(async () => {
      const result = await deleteCrawlsOnDate({ campaignId, eventDate: date });
      if (!result.ok) {
        setError(result.error ?? "Couldn't delete.");
        toast.show({
          kind: "error",
          message: result.error ?? "Couldn't delete.",
          code: (result as { code?: string }).code,
        });
        return;
      }
      toast.show({
        kind: "success",
        message: `Deleted ${result.data.deleted} ${result.data.deleted === 1 ? "crawl" : "crawls"} on ${prettyDate(date)}.`,
      });
      setConfirming(false);
      setDate("");
      router.refresh();
    });
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-2xl border border-rose-200/60 bg-rose-50/40 p-4",
        "dark:border-rose-900/40 dark:bg-rose-950/20",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-medium text-rose-900 text-sm dark:text-rose-200">
            <CalendarDays className="h-3.5 w-3.5" />
            Delete all crawls on a date
          </p>
          <p className="mt-1 text-rose-800/80 text-xs dark:text-rose-300/70">
            Hard-deletes every crawl scheduled on the chosen date across every city in this
            campaign. The city assignments stay intact — they just lose their crawl(s) for that
            date. Useful when the wrong day was bulk-scheduled and you want to reset.
            <strong> Cannot be undone.</strong>
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[9px] text-rose-700/80 uppercase tracking-[0.12em] dark:text-rose-300/70">
            Date to nuke
          </span>
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setConfirming(false);
              setError(null);
            }}
            disabled={pending}
            className={cn(
              "h-9 w-44 rounded-md border border-rose-300 bg-white px-2 text-sm",
              "focus:border-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-500/20",
              "dark:border-rose-900/60 dark:bg-zinc-900",
            )}
          />
        </label>
        {!confirming ? (
          <Button
            type="button"
            variant="destructive"
            onClick={() => setConfirming(true)}
            disabled={!date || pending}
            className="self-end"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete crawls on this date…
          </Button>
        ) : (
          <div className="flex flex-col gap-1.5 self-end">
            <p className="font-medium text-rose-900 text-xs dark:text-rose-200">
              Really delete every crawl on {prettyDate(date)}?
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirming(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={submit}
                disabled={pending}
              >
                {pending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                Yes, delete
              </Button>
            </div>
          </div>
        )}
      </div>
      {error && (
        <p
          className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800 text-xs dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}

function prettyDate(yyyymmdd: string): string {
  if (!yyyymmdd) return "—";
  const d = new Date(`${yyyymmdd}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return yyyymmdd;
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
