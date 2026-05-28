"use client";

import type { CrawlHostRef } from "@/lib/city-sheet-shared";
import { cn } from "@/lib/cn";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setSlot1HostType, updateInternalHostCapture } from "../_host-actions";

type HostType = "none" | "internal" | "external";

/**
 * Slot-1 (wristband slot) host control for a crawl. Pick None / Internal /
 * External. Internal captures name + hours + rate inline on the crawl event
 * (hours vary by crawl/day). External routes the crawl to /external-hosts for
 * assignment.
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
  const [pending, startTx] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const current: HostType = slot1 ? (slot1.type as HostType) : "none";

  const [name, setName] = useState(slot1?.internalHostName ?? "");
  const [hours, setHours] = useState(slot1?.internalHostHours ?? "");
  const [rate, setRate] = useState(
    slot1?.internalHostRateCents != null ? String(slot1.internalHostRateCents / 100) : "",
  );

  function pickType(next: HostType) {
    if (next === current) return;
    setError(null);
    startTx(async () => {
      const res = await setSlot1HostType({ eventId, cityCampaignId, hostType: next });
      if (!res.ok) {
        setError(res.error ?? "Couldn't update.");
        return;
      }
      router.refresh();
    });
  }

  function saveCapture() {
    if (!slot1) return;
    setError(null);
    startTx(async () => {
      const res = await updateInternalHostCapture({
        crawlHostId: slot1.id,
        cityCampaignId,
        name,
        hours,
        rate,
      });
      if (!res.ok) {
        setError(res.error ?? "Couldn't save.");
        return;
      }
      router.refresh();
    });
  }

  const TYPES: Array<{ value: HostType; label: string }> = [
    { value: "none", label: "None" },
    { value: "internal", label: "Internal" },
    { value: "external", label: "External" },
  ];

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="font-mono text-[9px] text-zinc-400 uppercase tracking-[0.14em]"
          title="Slot 1 is the wristband-slot host. Internal hosts are captured here; external hosts get assigned on the External Hosts page."
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
        {error && <span className="text-[10px] text-rose-600">{error}</span>}
      </div>

      {current === "internal" && slot1 && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-blue-500/20 bg-blue-500/5 p-2">
          <label className="flex flex-col gap-0.5">
            <span className="font-mono text-[8px] text-zinc-500 uppercase tracking-widest">
              Name
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Host name"
              className="w-36 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="font-mono text-[8px] text-zinc-500 uppercase tracking-widest">
              Hours
            </span>
            <input
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              inputMode="decimal"
              placeholder="e.g. 6.5"
              className="w-20 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="font-mono text-[8px] text-zinc-500 uppercase tracking-widest">
              Rate $/hr
            </span>
            <input
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              inputMode="decimal"
              placeholder="e.g. 25"
              className="w-20 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <button
            type="button"
            onClick={saveCapture}
            disabled={pending}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Save
          </button>
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
