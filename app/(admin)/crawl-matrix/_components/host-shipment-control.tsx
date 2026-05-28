"use client";

import { cn } from "@/lib/cn";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setExternalHostShipment } from "../_actions";

const STATUSES = ["pending", "ready_to_ship", "shipped", "delivered", "issue"] as const;
type ShipStatus = (typeof STATUSES)[number];

const LABEL: Record<ShipStatus, string> = {
  pending: "Pending",
  ready_to_ship: "Ready",
  shipped: "Shipped",
  delivered: "Delivered",
  issue: "Issue",
};

const TONE: Record<ShipStatus, string> = {
  pending: "bg-zinc-500/10 text-zinc-600 ring-zinc-500/20 dark:text-zinc-300",
  ready_to_ship: "bg-sky-500/10 text-sky-700 ring-sky-500/25 dark:text-sky-300",
  shipped: "bg-amber-500/15 text-amber-700 ring-amber-500/30 dark:text-amber-300",
  delivered: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-400",
  issue: "bg-rose-500/15 text-rose-700 ring-rose-500/30 dark:text-rose-300",
};

export function HostShipmentControl({
  externalHostId,
  cityCampaignId,
  status,
  trackingNumber,
  wristbandCount,
}: {
  externalHostId: string;
  cityCampaignId: string;
  status: ShipStatus;
  trackingNumber: string | null;
  wristbandCount: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTx] = useTransition();
  const [s, setS] = useState<ShipStatus>(status);
  const [tracking, setTracking] = useState(trackingNumber ?? "");
  const [count, setCount] = useState(wristbandCount != null ? String(wristbandCount) : "");
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    const qty = count.trim();
    startTx(async () => {
      const res = await setExternalHostShipment({
        externalHostId,
        cityCampaignId,
        status: s,
        trackingNumber: tracking.trim() || undefined,
        wristbandCount: qty && !Number.isNaN(Number(qty)) ? Number(qty) : undefined,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] ring-1 ring-inset",
          TONE[status],
        )}
      >
        {LABEL[status]}
        {wristbandCount != null ? ` · ${wristbandCount}` : ""}
        {trackingNumber ? " · ☑" : ""}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-zinc-200 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-900">
      <select
        value={s}
        onChange={(e) => setS(e.target.value as ShipStatus)}
        className="h-7 rounded border border-zinc-200 bg-transparent px-1.5 text-xs dark:border-zinc-700"
      >
        {STATUSES.map((opt) => (
          <option key={opt} value={opt}>
            {LABEL[opt]}
          </option>
        ))}
      </select>
      <input
        value={tracking}
        onChange={(e) => setTracking(e.target.value)}
        placeholder="Tracking #"
        className="h-7 rounded border border-zinc-200 bg-transparent px-1.5 text-xs dark:border-zinc-700"
      />
      <input
        value={count}
        onChange={(e) => setCount(e.target.value)}
        placeholder="Qty"
        inputMode="numeric"
        className="h-7 w-20 rounded border border-zinc-200 bg-transparent px-1.5 text-xs dark:border-zinc-700"
      />
      {error ? <p className="text-[10px] text-rose-500">{error}</p> : null}
      <div className="flex gap-1">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="h-7 rounded bg-zinc-900 px-2 text-white text-xs disabled:opacity-50 dark:bg-white dark:text-zinc-900"
        >
          {pending ? "…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="h-7 rounded border border-zinc-200 px-2 text-xs dark:border-zinc-700"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
