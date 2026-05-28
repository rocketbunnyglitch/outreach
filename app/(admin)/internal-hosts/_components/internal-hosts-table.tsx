"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { type InternalHostRow, archiveInternalHost, upsertInternalHost } from "../_actions";

const PAYMENT_METHODS = ["venmo", "bank", "interac", "zelle", "paypal", "wise"] as const;

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
  } catch {
    // Unknown currency code → plain number + code.
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

interface DraftState {
  id?: string;
  name: string;
  payRate: string;
  hoursWorked: string;
  currency: string;
  paymentMethod: string;
  paymentDetails: string;
  notes: string;
}

const EMPTY_DRAFT: DraftState = {
  name: "",
  payRate: "",
  hoursWorked: "",
  currency: "CAD",
  paymentMethod: "",
  paymentDetails: "",
  notes: "",
};

export function InternalHostsTable({ hosts }: { hosts: InternalHostRow[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTx] = useTransition();

  const grandTotalByCurrency = hosts.reduce<Record<string, number>>((acc, h) => {
    acc[h.currency] = (acc[h.currency] ?? 0) + h.totalCents;
    return acc;
  }, {});

  function startAdd() {
    setError(null);
    setDraft({ ...EMPTY_DRAFT });
  }

  function startEdit(h: InternalHostRow) {
    setError(null);
    setDraft({
      id: h.id,
      name: h.name,
      payRate: (h.payRateCents / 100).toString(),
      hoursWorked: h.hoursWorked.toString(),
      currency: h.currency,
      paymentMethod: h.paymentMethod ?? "",
      paymentDetails: h.paymentDetails ?? "",
      notes: h.notes ?? "",
    });
  }

  function save() {
    if (!draft) return;
    if (!draft.name.trim()) {
      setError("Name is required.");
      return;
    }
    startTx(async () => {
      try {
        const result = await upsertInternalHost({
          id: draft.id,
          name: draft.name,
          payRate: Number(draft.payRate || 0),
          hoursWorked: Number(draft.hoursWorked || 0),
          currency: draft.currency || "CAD",
          paymentMethod: (draft.paymentMethod || undefined) as
            | "venmo"
            | "bank"
            | "interac"
            | "zelle"
            | "paypal"
            | "wise"
            | undefined,
          paymentDetails: draft.paymentDetails,
          notes: draft.notes,
        });
        if (!result.ok) {
          setError(result.error ?? "Couldn't save.");
          return;
        }
        setDraft(null);
        router.refresh();
      } catch (err) {
        console.error("[internal-hosts] save failed", err);
        setError("Couldn't save — try again.");
      }
    });
  }

  function remove(h: InternalHostRow) {
    if (!confirm(`Remove ${h.name} from internal hosts?`)) return;
    startTx(async () => {
      try {
        const result = await archiveInternalHost({ id: h.id });
        if (!result.ok) {
          setError(result.error ?? "Couldn't remove.");
          return;
        }
        router.refresh();
      } catch (err) {
        console.error("[internal-hosts] remove failed", err);
        setError("Couldn't remove — try again.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {Object.entries(grandTotalByCurrency).map(([cur, cents]) => (
            <span
              key={cur}
              className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-1.5 font-mono text-xs dark:bg-zinc-800/60"
            >
              <span className="text-zinc-500">Total {cur}</span>
              <span className="font-semibold tabular-nums">{formatMoney(cents, cur)}</span>
            </span>
          ))}
        </div>
        {!draft && (
          <Button type="button" onClick={startAdd} disabled={pending}>
            <Plus className="h-4 w-4" /> Add host
          </Button>
        )}
      </div>

      {error && <p className="text-rose-600 text-sm">{error}</p>}

      {draft && (
        <div className="card-surface-quiet flex flex-col gap-3 p-4">
          <h3 className="font-semibold text-sm tracking-tight">
            {draft.id ? "Edit host" : "New internal host"}
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Name">
              <input
                className={inputCls}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Host name"
                disabled={pending}
              />
            </Field>
            <Field label="Currency">
              <input
                className={inputCls}
                value={draft.currency}
                onChange={(e) => setDraft({ ...draft, currency: e.target.value.toUpperCase() })}
                placeholder="CAD"
                maxLength={8}
                disabled={pending}
              />
            </Field>
            <Field label="Rate / hour">
              <input
                type="number"
                min={0}
                step="0.01"
                className={inputCls}
                value={draft.payRate}
                onChange={(e) => setDraft({ ...draft, payRate: e.target.value })}
                placeholder="0.00"
                disabled={pending}
              />
            </Field>
            <Field label="Hours worked">
              <input
                type="number"
                min={0}
                step="0.25"
                className={inputCls}
                value={draft.hoursWorked}
                onChange={(e) => setDraft({ ...draft, hoursWorked: e.target.value })}
                placeholder="0"
                disabled={pending}
              />
            </Field>
            <Field label="Payment method">
              <select
                className={inputCls}
                value={draft.paymentMethod}
                onChange={(e) => setDraft({ ...draft, paymentMethod: e.target.value })}
                disabled={pending}
              >
                <option value="">—</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m.charAt(0).toUpperCase() + m.slice(1)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Payment details">
              <input
                className={inputCls}
                value={draft.paymentDetails}
                onChange={(e) => setDraft({ ...draft, paymentDetails: e.target.value })}
                placeholder="@handle / email"
                disabled={pending}
              />
            </Field>
          </div>
          <Field label="Notes">
            <input
              className={inputCls}
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              placeholder="Optional"
              disabled={pending}
            />
          </Field>
          <div className="flex items-center gap-2">
            <Button type="button" onClick={save} disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
              disabled={pending}
            >
              <X className="h-4 w-4" /> Cancel
            </Button>
          </div>
        </div>
      )}

      {hosts.length === 0 && !draft ? (
        <div className="card-surface-quiet p-10 text-center text-sm text-zinc-500">
          No internal hosts yet. Add one to start tracking payouts.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200/80 dark:border-zinc-800/60">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-zinc-200/60 border-b bg-zinc-50/60 text-left font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em] dark:border-zinc-800/40 dark:bg-zinc-900/30">
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2 text-right">Rate / hr</th>
                <th className="px-3 py-2 text-right">Hours</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2">Payment</th>
                <th className="w-16 px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {hosts.map((h) => (
                <tr
                  key={h.id}
                  className="group border-zinc-200/40 border-b last:border-0 dark:border-zinc-800/30"
                >
                  <td className="px-3 py-2">
                    <div className="font-medium">{h.name}</div>
                    {h.notes && <div className="text-[11px] text-zinc-500">{h.notes}</div>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {formatMoney(h.payRateCents, h.currency)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{h.hoursWorked}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">
                    {formatMoney(h.totalCents, h.currency)}
                  </td>
                  <td className="px-3 py-2">
                    {h.paymentMethod ? (
                      <span className="capitalize">{h.paymentMethod}</span>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                    {h.paymentDetails && (
                      <span className="ml-1 text-[11px] text-zinc-500">{h.paymentDetails}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => startEdit(h)}
                        disabled={pending}
                        className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
                        aria-label={`Edit ${h.name}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(h)}
                        disabled={pending}
                        className="rounded p-1 text-zinc-400 hover:bg-rose-500/[0.08] hover:text-rose-600"
                        aria-label={`Remove ${h.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const inputCls = cn(
  "w-full rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm",
  "focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20",
  "dark:border-zinc-700 dark:bg-zinc-900",
);

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed in as children and nested inside the label
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">{label}</span>
      {children}
    </label>
  );
}
