"use client";

import type { CrawlHostRef } from "@/lib/city-sheet-shared";
import { cn } from "@/lib/cn";
import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { setSlot1HostType, updateInternalHostCapture } from "../_host-actions";

type HostType = "none" | "internal" | "external";

/**
 * Slot-1 (wristband slot) host control for a crawl. Pick None / Internal /
 * External.
 *
 * Per operator request the internal-host details (name + hours + rate) are
 * NOT required to flag a crawl as internal. Picking "Internal" alone is
 * enough to mark the venue as having an internal host running it; details
 * can be filled in later (often hours + rate aren't known until after the
 * job is done, and the host's name sometimes isn't given right away by the
 * venue).
 *
 * To make that explicit:
 *
 *   - The detail fields are labeled "(optional, save anytime)" with a hint
 *     saying the marking is already in effect.
 *   - Each field auto-saves on blur — there's no Save button to click and
 *     no chance of "I typed it but didn't save" confusion.
 *   - A brief CheckCircle2 + "Saved" badge appears for 1.5s after each
 *     successful save so the operator has explicit confirmation.
 *   - The Hours and Rate inputs are type="number" so the browser enforces
 *     numeric entry — previously a stray non-numeric character ("5h" or
 *     "$25") silently failed the zod refine and the user didn't see why.
 */
export function Slot1HostControl({
  eventId,
  cityCampaignId,
  slot1,
}: {
  eventId: string;
  cityCampaignId: string;
  slot1: CrawlHostRef | undefined;
}) {
  const router = useRouter();
  const [pendingType, startTypeTx] = useTransition();
  const [pendingSave, startSaveTx] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const current: HostType = slot1 ? (slot1.type as HostType) : "none";

  const [name, setName] = useState(slot1?.internalHostName ?? "");
  const [hours, setHours] = useState(slot1?.internalHostHours ?? "");
  const [rate, setRate] = useState(
    slot1?.internalHostRateCents != null ? String(slot1.internalHostRateCents / 100) : "",
  );

  // When the underlying row changes (e.g. after another tab edited it, or
  // after router.refresh() repulls), resync the inputs unless the
  // operator is actively typing. lastSaved* is what we last sent so we
  // can distinguish server-driven changes from our own.
  const lastSavedRef = useRef({
    name: slot1?.internalHostName ?? "",
    hours: slot1?.internalHostHours ?? "",
    rate: slot1?.internalHostRateCents != null ? String(slot1.internalHostRateCents / 100) : "",
  });
  useEffect(() => {
    const serverName = slot1?.internalHostName ?? "";
    const serverHours = slot1?.internalHostHours ?? "";
    const serverRate =
      slot1?.internalHostRateCents != null ? String(slot1.internalHostRateCents / 100) : "";
    if (serverName !== lastSavedRef.current.name) setName(serverName);
    if (serverHours !== lastSavedRef.current.hours) setHours(serverHours);
    if (serverRate !== lastSavedRef.current.rate) setRate(serverRate);
    lastSavedRef.current = { name: serverName, hours: serverHours, rate: serverRate };
  }, [slot1?.internalHostName, slot1?.internalHostHours, slot1?.internalHostRateCents]);

  function pickType(next: HostType) {
    if (next === current) return;
    setError(null);
    startTypeTx(async () => {
      const res = await setSlot1HostType({ eventId, cityCampaignId, hostType: next });
      if (!res.ok) {
        setError(res.error ?? "Couldn't update.");
        return;
      }
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1500);
      router.refresh();
    });
  }

  // Auto-save on blur. Skips the call if nothing changed since the last
  // save (so tabbing through doesn't fire pointless requests).
  function saveCapture(overrides?: { name?: string; hours?: string; rate?: string }) {
    if (!slot1) return;
    const next = {
      name: overrides?.name ?? name,
      hours: overrides?.hours ?? hours,
      rate: overrides?.rate ?? rate,
    };
    const last = lastSavedRef.current;
    if (next.name === last.name && next.hours === last.hours && next.rate === last.rate) {
      return; // no change → don't fire
    }
    setError(null);
    startSaveTx(async () => {
      const res = await updateInternalHostCapture({
        crawlHostId: slot1.id,
        cityCampaignId,
        name: next.name,
        hours: next.hours,
        rate: next.rate,
      });
      if (!res.ok) {
        setError(res.error ?? "Couldn't save.");
        return;
      }
      lastSavedRef.current = next;
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1500);
      router.refresh();
    });
  }

  const TYPES: Array<{ value: HostType; label: string }> = [
    { value: "none", label: "None" },
    { value: "internal", label: "Internal" },
    { value: "external", label: "External" },
  ];

  const pending = pendingType || pendingSave;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="font-mono text-[9px] text-zinc-400 uppercase tracking-[0.14em]"
          title="Slot 1 is the wristband-slot host. Picking Internal marks this crawl in the internal-host roster; details (name, hours, rate) are optional and can be filled in later."
        >
          Slot 1 host
        </span>
        <div className="inline-flex overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-700">
          {TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => pickType(t.value)}
              disabled={pending}
              className={cn(
                "px-2 py-0.5 text-[11px] transition-colors disabled:opacity-50",
                current === t.value
                  ? t.value === "internal"
                    ? "bg-blue-500/15 text-blue-700 dark:text-blue-300"
                    : t.value === "external"
                      ? "bg-violet-500/15 text-violet-700 dark:text-violet-300"
                      : "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"
                  : "text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        {pendingType && (
          <Loader2 className="h-3 w-3 animate-spin text-zinc-400" aria-label="Saving" />
        )}
        {savedFlash && !pending && (
          <span className="inline-flex items-center gap-1 font-mono text-[9px] text-emerald-600 uppercase tracking-[0.12em] dark:text-emerald-400">
            <CheckCircle2 className="h-2.5 w-2.5" />
            Saved
          </span>
        )}
        {error && <span className="text-[10px] text-rose-600">{error}</span>}
      </div>

      {current === "internal" && slot1 && (
        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-2">
          <p className="mb-2 text-[10px] text-zinc-500 dark:text-zinc-400">
            Marked as internal host. Details below are{" "}
            <span className="font-medium text-zinc-700 dark:text-zinc-300">optional</span> — fill
            them in now or after the job. Fields save automatically when you tab away.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-0.5">
              <span className="font-mono text-[8px] text-zinc-500 uppercase tracking-widest">
                Name
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => saveCapture({ name })}
                placeholder="(unknown — fill later)"
                className="w-36 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                disabled={pendingSave}
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="font-mono text-[8px] text-zinc-500 uppercase tracking-widest">
                Hours
              </span>
              <input
                type="number"
                step="0.25"
                min="0"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                onBlur={() => saveCapture({ hours })}
                placeholder="—"
                className="w-20 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                disabled={pendingSave}
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="font-mono text-[8px] text-zinc-500 uppercase tracking-widest">
                Rate $/hr
              </span>
              <input
                type="number"
                step="0.50"
                min="0"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                onBlur={() => saveCapture({ rate })}
                placeholder="—"
                className="w-20 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                disabled={pendingSave}
              />
            </label>
            {pendingSave && (
              <Loader2 className="h-3 w-3 animate-spin text-zinc-400" aria-label="Saving" />
            )}
          </div>
        </div>
      )}

      {current === "external" && slot1 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-violet-500/20 bg-violet-500/5 px-2 py-1.5 text-xs">
          {slot1.externalPending ? (
            <>
              <span className="text-violet-700 dark:text-violet-300">
                Awaiting external host assignment.
              </span>
              <Link
                href="/external-hosts"
                className="inline-flex items-center gap-1 font-medium text-violet-700 underline-offset-2 hover:underline dark:text-violet-300"
              >
                Assign on External Hosts <ExternalLink className="h-3 w-3" />
              </Link>
            </>
          ) : (
            <span className="text-violet-700 dark:text-violet-300">
              Assigned to <span className="font-medium">{slot1.name}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
