"use client";

import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { AlertTriangle, Check, Loader2, Package, Pencil, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { upsertWristbandShipping } from "../_actions";

export interface WristbandRowData {
  venueEventId: string;
  venueId: string;
  venueName: string;
  cityName: string;
  campaignName: string;
  eventDate: string;
  veStatus: string;
  wristbandId: string | null;
  quantity: number | null;
  status: string | null;
  recipientName: string | null;
  recipientPhone: string | null;
  shippingAddress: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  expectedDeliveryDate: string | null;
}

const STATUS_OPTIONS = ["pending", "ready_to_ship", "shipped", "delivered", "issue"] as const;
type WbStatus = (typeof STATUS_OPTIONS)[number];

const STATUS_TONE: Record<WbStatus, string> = {
  pending: "bg-zinc-500/10 text-zinc-600 ring-zinc-500/20 dark:text-zinc-300",
  ready_to_ship: "bg-blue-500/10 text-blue-700 ring-blue-500/20 dark:text-blue-300",
  shipped: "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300",
  delivered: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300",
  issue: "bg-rose-500/10 text-rose-700 ring-rose-500/20 dark:text-rose-300",
};

const STATUS_LABEL: Record<WbStatus, string> = {
  pending: "Pending",
  ready_to_ship: "Ready",
  shipped: "Shipped",
  delivered: "Delivered",
  issue: "Issue",
};

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function WristbandShippingRow({
  row,
  striped,
}: {
  row: WristbandRowData;
  striped: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTx] = useTransition();
  const toast = useToast();
  const noSetup = !row.wristbandId;

  const [form, setForm] = useState({
    recipientName: row.recipientName ?? "",
    recipientPhone: row.recipientPhone ?? "",
    shippingAddress: row.shippingAddress ?? "",
    carrier: row.carrier ?? "",
    trackingNumber: row.trackingNumber ?? "",
    quantity: row.quantity != null ? String(row.quantity) : "",
    status: (row.status ?? "pending") as WbStatus,
  });

  function save() {
    startTx(async () => {
      try {
        const result = await upsertWristbandShipping({
          venueEventId: row.venueEventId,
          recipientName: form.recipientName,
          recipientPhone: form.recipientPhone,
          shippingAddress: form.shippingAddress,
          carrier: form.carrier,
          trackingNumber: form.trackingNumber,
          quantity: form.quantity ? Number(form.quantity) : 0,
          status: form.status,
        });
        if (!result.ok) {
          setError(result.error ?? "Couldn't save.");
          toast.show({
            kind: "error",
            message: result.error ?? "Couldn't save wristband shipping.",
          });
          return;
        }
        setEditing(false);
        setError(null);
        toast.show({
          kind: "success",
          message: `Wristband for ${row.venueName} saved (${form.status.replace(/_/g, " ")}).`,
        });
        router.refresh();
      } catch (err) {
        console.error("[wristbands] save failed", err);
        setError("Couldn't save — try again.");
        toast.show({ kind: "error", message: "Couldn't save — try again." });
      }
    });
  }

  if (editing) {
    return (
      <tr className="border-zinc-200/40 border-b bg-blue-500/[0.03] dark:border-zinc-800/30">
        <td className="px-4 py-2.5 align-top">
          <div className="font-medium">{row.venueName}</div>
          <p className="font-mono text-[10px] text-zinc-500">{row.cityName}</p>
        </td>
        <td className="px-4 py-2.5 align-top" colSpan={4}>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
            <input
              className={inputCls}
              value={form.recipientName}
              onChange={(e) => setForm({ ...form, recipientName: e.target.value })}
              placeholder="Recipient name"
              disabled={pending}
            />
            <input
              className={inputCls}
              value={form.recipientPhone}
              onChange={(e) => setForm({ ...form, recipientPhone: e.target.value })}
              placeholder="Phone"
              disabled={pending}
            />
            <input
              type="number"
              min={0}
              className={inputCls}
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
              placeholder="Qty"
              disabled={pending}
            />
            <input
              className={cn(inputCls, "col-span-2 lg:col-span-3")}
              value={form.shippingAddress}
              onChange={(e) => setForm({ ...form, shippingAddress: e.target.value })}
              placeholder="Mailing address"
              disabled={pending}
            />
            <input
              className={inputCls}
              value={form.carrier}
              onChange={(e) => setForm({ ...form, carrier: e.target.value })}
              placeholder="Carrier"
              disabled={pending}
            />
            <input
              className={cn(inputCls, "col-span-2")}
              value={form.trackingNumber}
              onChange={(e) => setForm({ ...form, trackingNumber: e.target.value })}
              placeholder="Tracking number"
              disabled={pending}
            />
          </div>
          {error && <p className="mt-1 text-[11px] text-rose-600">{error}</p>}
        </td>
        <td className="px-4 py-2.5 align-top">
          <div className="flex flex-col items-stretch gap-2">
            <select
              className={inputCls}
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as WbStatus })}
              disabled={pending}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={save}
                disabled={pending}
                className="inline-flex flex-1 items-center justify-center gap-1 rounded-md bg-blue-600 px-2 py-1 font-medium text-[11px] text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {pending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Check className="h-3 w-3" />
                )}
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setError(null);
                }}
                disabled={pending}
                className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
                aria-label="Cancel"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className={cn("group", striped && "dark:bg-white/[0.015]")}>
      <td className="px-4 py-2.5">
        <Link href={`/venues/${row.venueId}`} className="font-medium hover:underline">
          {row.venueName}
        </Link>
        <p className="font-mono text-[10px] text-zinc-500">{row.cityName}</p>
      </td>
      <td className="px-4 py-2.5">
        {row.recipientName || row.recipientPhone ? (
          <div className="text-xs">
            {row.recipientName && <div>{row.recipientName}</div>}
            {row.recipientPhone && (
              <div className="font-mono text-[11px] text-zinc-500">{row.recipientPhone}</div>
            )}
          </div>
        ) : (
          <span className="text-zinc-400">—</span>
        )}
      </td>
      <td className="px-4 py-2.5">
        {row.shippingAddress ? (
          <span className="text-xs">{truncate(row.shippingAddress, 36)}</span>
        ) : (
          <span className="font-mono text-[10px] text-rose-500 uppercase tracking-widest">
            <AlertTriangle className="mr-1 inline h-3 w-3" />
            missing
          </span>
        )}
      </td>
      <td className="px-4 py-2.5">
        {row.trackingNumber ? (
          <span className="font-mono text-xs">
            {row.carrier && <span className="text-zinc-500">{row.carrier} </span>}
            {row.trackingNumber}
          </span>
        ) : row.status === "shipped" ? (
          <span className="font-mono text-[10px] text-rose-500 uppercase tracking-widest">
            <AlertTriangle className="mr-1 inline h-3 w-3" />
            missing
          </span>
        ) : (
          <span className="text-zinc-500">—</span>
        )}
      </td>
      <td className="px-4 py-2.5">
        {noSetup ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] text-amber-500 uppercase tracking-widest ring-1 ring-amber-500/20 ring-inset">
            <Package className="h-3 w-3" />
            Needs setup
          </span>
        ) : (
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ring-1 ring-inset",
              STATUS_TONE[(row.status ?? "pending") as WbStatus],
            )}
          >
            {STATUS_LABEL[(row.status ?? "pending") as WbStatus]}
          </span>
        )}
      </td>
      <td className="px-2 py-2.5">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded p-1 text-zinc-400 opacity-0 transition-opacity hover:bg-zinc-100 hover:text-zinc-700 group-hover:opacity-100 dark:hover:bg-zinc-800"
          aria-label={`Edit shipping for ${row.venueName}`}
          title="Edit shipping"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  );
}

const inputCls = cn(
  "w-full rounded-md border border-zinc-300 px-2 py-1 text-xs",
  "focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20",
  "dark:border-zinc-700 dark:bg-zinc-900",
);
