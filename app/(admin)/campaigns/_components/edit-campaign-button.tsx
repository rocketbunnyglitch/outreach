"use client";

/**
 * EditCampaignButton — opens an inline modal with the most-edited
 * campaign fields. Saves through the existing updateCampaign action so
 * audit columns + brand-pair guards stay intact.
 *
 * What's editable here:
 *   - name
 *   - status (planning / active / completed / archived)
 *   - holidayType (stpaddys / halloween / newyears / custom)
 *   - startDate / endDate (with end >= start refinement enforced server-side)
 *
 * Out of scope (use /campaigns/[id] for these):
 *   - swapping outreach brand or crawl brand
 *   - revenue + venue count goals
 *   - delete / archive
 *
 * Why not full inline-on-row?
 *   Campaigns have ~10 editable fields. Cramming all of them into a
 *   table row reads as visual noise. A popover gives every field room
 *   while preserving the no-navigation guarantee the operator asked for.
 */

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { updateCampaign } from "../_actions";

type CampaignStatus = "planning" | "active" | "completed" | "archived";
type HolidayType = "stpaddys" | "halloween" | "newyears" | "custom";

interface Props {
  campaign: {
    id: string;
    name: string;
    status: CampaignStatus;
    holidayType: HolidayType;
    startDate: string | null;
    endDate: string | null;
  };
}

const STATUSES: Array<{ value: CampaignStatus; label: string; tone: string }> = [
  {
    value: "planning",
    label: "Planning",
    tone: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  },
  {
    value: "active",
    label: "Active",
    tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  },
  {
    value: "completed",
    label: "Completed",
    tone: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  },
  {
    value: "archived",
    label: "Archived",
    tone: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  },
];

const HOLIDAYS: Array<{ value: HolidayType; label: string }> = [
  { value: "stpaddys", label: "St. Paddy's" },
  { value: "halloween", label: "Halloween" },
  { value: "newyears", label: "New Year's" },
  { value: "custom", label: "Custom" },
];

export function EditCampaignButton({ campaign }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(campaign.name);
  const [status, setStatus] = useState<CampaignStatus>(campaign.status);
  const [holiday, setHoliday] = useState<HolidayType>(campaign.holidayType);
  const [startDate, setStartDate] = useState(campaign.startDate ?? "");
  const [endDate, setEndDate] = useState(campaign.endDate ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTx] = useTransition();
  const router = useRouter();
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // Reset local state every time the popover opens so the operator
  // doesn't see stale unsaved values from a prior open
  useEffect(() => {
    if (!open) return;
    setName(campaign.name);
    setStatus(campaign.status);
    setHoliday(campaign.holidayType);
    setStartDate(campaign.startDate ?? "");
    setEndDate(campaign.endDate ?? "");
    setError(null);
    setSaved(false);
    setTimeout(() => firstFieldRef.current?.focus(), 0);
  }, [open, campaign]);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, pending]);

  function save() {
    setError(null);
    const fd = new FormData();
    fd.set("name", name.trim());
    fd.set("status", status);
    fd.set("holidayType", holiday);
    if (startDate) fd.set("startDate", startDate);
    if (endDate) fd.set("endDate", endDate);

    startTx(async () => {
      const result = await updateCampaign(campaign.id, null, fd);
      if (!result.ok) {
        setError(result.error ?? "Couldn't save.");
        return;
      }
      setSaved(true);
      setTimeout(() => {
        setOpen(false);
        setSaved(false);
        router.refresh();
      }, 600);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          // Stop the parent Link from navigating to /campaigns/[id]
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        title="Edit campaign"
        className={cn(
          "inline-flex items-center justify-center rounded-md p-1.5 text-zinc-400 transition-colors",
          "hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
        )}
        aria-label="Edit campaign"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 px-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !pending) setOpen(false);
          }}
          onKeyDown={(e) => {
            // Allow Esc-on-overlay even when focus is on the backdrop
            if (e.key === "Escape" && !pending) setOpen(false);
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Edit campaign"
          tabIndex={-1}
        >
          <div
            className={cn("card-surface w-full max-w-md p-5", "animate-[fade-in_200ms_ease-out]")}
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-semibold text-base tracking-tight">Edit campaign</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-[0.12em]">
                  Name
                </span>
                <input
                  ref={firstFieldRef}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={pending}
                  className={cn(
                    "rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm",
                    "focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20",
                    "dark:border-zinc-700 dark:bg-zinc-900",
                  )}
                />
              </label>

              <div>
                <p className="font-mono text-[9px] text-zinc-500 uppercase tracking-[0.12em]">
                  Status
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {STATUSES.map((s) => {
                    const selected = status === s.value;
                    return (
                      <button
                        key={s.value}
                        type="button"
                        onClick={() => setStatus(s.value)}
                        disabled={pending}
                        className={cn(
                          "rounded-md px-2 py-1 text-[11px] transition-all",
                          selected
                            ? `${s.tone} ring-2 ring-zinc-900/10 dark:ring-zinc-100/10`
                            : "bg-zinc-50 text-zinc-500 hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800",
                        )}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="font-mono text-[9px] text-zinc-500 uppercase tracking-[0.12em]">
                  Holiday type
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {HOLIDAYS.map((h) => {
                    const selected = holiday === h.value;
                    return (
                      <button
                        key={h.value}
                        type="button"
                        onClick={() => setHoliday(h.value)}
                        disabled={pending}
                        className={cn(
                          "rounded-md px-2 py-1 text-[11px] transition-all",
                          selected
                            ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                            : "bg-zinc-50 text-zinc-500 hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800",
                        )}
                      >
                        {h.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-[0.12em]">
                    Start date
                  </span>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    disabled={pending}
                    className={cn(
                      "rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs",
                      "focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20",
                      "dark:border-zinc-700 dark:bg-zinc-900",
                    )}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-[0.12em]">
                    End date
                  </span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    disabled={pending}
                    className={cn(
                      "rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs",
                      "focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20",
                      "dark:border-zinc-700 dark:bg-zinc-900",
                    )}
                  />
                </label>
              </div>
            </div>

            {error && (
              <p
                role="alert"
                className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-rose-800 text-xs dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200"
              >
                {error}
              </p>
            )}

            <div className="mt-4 flex items-center justify-between gap-2">
              <a
                href={`/campaigns/${campaign.id}`}
                className="text-[11px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                onClick={(e) => e.stopPropagation()}
              >
                More options →
              </a>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setOpen(false)}
                  disabled={pending}
                >
                  Cancel
                </Button>
                <Button type="button" onClick={save} disabled={pending || !name.trim() || saved}>
                  {saved ? (
                    <Check className="h-3 w-3" />
                  ) : pending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : null}
                  {saved ? "Saved" : "Save"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
