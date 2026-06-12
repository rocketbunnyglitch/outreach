"use client";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { type ExternalHostRow, archiveExternalHost, upsertExternalHost } from "../_actions";

const PAYMENT_METHODS = ["venmo", "bank", "interac", "zelle", "paypal", "wise"] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

interface DraftState {
  id?: string;
  fullName: string;
  email: string;
  phoneE164: string;
  payRate: string;
  currency: string;
  address: string;
  paymentMethod: string;
  paymentContact: string;
  notes: string;
}

const EMPTY_DRAFT: DraftState = {
  fullName: "",
  email: "",
  phoneE164: "",
  payRate: "",
  currency: "USD",
  address: "",
  paymentMethod: "",
  paymentContact: "",
  notes: "",
};

export function ExternalHostsTable({ hosts }: { hosts: ExternalHostRow[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTx] = useTransition();
  const toast = useToast();

  function startEdit(h: ExternalHostRow) {
    setError(null);
    setDraft({
      id: h.id,
      fullName: h.fullName,
      email: h.email ?? "",
      phoneE164: h.phoneE164 ?? "",
      payRate: (h.payRateCents / 100).toString(),
      currency: h.currency,
      address: h.address ?? "",
      paymentMethod: h.paymentMethod ?? "",
      paymentContact: h.paymentContact ?? "",
      notes: h.notes ?? "",
    });
  }

  function save() {
    if (!draft) return;
    if (!draft.fullName.trim()) {
      setError("Full name is required.");
      return;
    }
    const wasEdit = !!draft.id;
    const nameForToast = draft.fullName.trim();
    startTx(async () => {
      try {
        const result = await upsertExternalHost({
          id: draft.id,
          fullName: draft.fullName,
          email: draft.email,
          phoneE164: draft.phoneE164,
          payRate: Number(draft.payRate || 0),
          currency: draft.currency || "USD",
          address: draft.address,
          paymentMethod: (draft.paymentMethod || undefined) as PaymentMethod | undefined,
          paymentContact: draft.paymentContact,
          notes: draft.notes,
        });
        if (!result.ok) {
          setError(result.error ?? "Couldn't save.");
          toast.show({
            kind: "error",
            message: result.error ?? "Couldn't save host.",
            code: result.code,
          });
          return;
        }
        setDraft(null);
        toast.show({
          kind: "success",
          message: wasEdit ? `Updated ${nameForToast}.` : `Added ${nameForToast}.`,
        });
        router.refresh();
      } catch (err) {
        console.error("[external-hosts] save failed", err);
        setError("Couldn't save — try again.");
        toast.show({ kind: "error", message: "Couldn't save — try again." });
      }
    });
  }

  function remove(h: ExternalHostRow) {
    if (!confirm(`Remove ${h.fullName} from external hosts?`)) return;
    startTx(async () => {
      try {
        const result = await archiveExternalHost({ id: h.id });
        if (!result.ok) {
          setError(result.error ?? "Couldn't remove.");
          toast.show({
            kind: "error",
            message: result.error ?? "Couldn't remove host.",
            code: result.code,
          });
          return;
        }
        toast.show({ kind: "success", message: `${h.fullName} removed from external hosts.` });
        router.refresh();
      } catch (err) {
        console.error("[external-hosts] remove failed", err);
        setError("Couldn't remove — try again.");
        toast.show({ kind: "error", message: "Couldn't remove — try again." });
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end">
        {!draft && (
          <Button type="button" onClick={() => setDraft({ ...EMPTY_DRAFT })} disabled={pending}>
            <Plus className="h-4 w-4" /> Add host
          </Button>
        )}
      </div>

      {error && <p className="text-rose-600 text-sm">{error}</p>}

      {draft && (
        <div className="card-surface-quiet flex flex-col gap-3 p-4">
          <h3 className="font-semibold text-sm tracking-tight">
            {draft.id ? "Edit host" : "New external host"}
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Full name">
              <input
                className={inputCls}
                value={draft.fullName}
                onChange={(e) => setDraft({ ...draft, fullName: e.target.value })}
                placeholder="Host name"
                disabled={pending}
              />
            </Field>
            <Field label="Email">
              <input
                className={inputCls}
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                placeholder="host@example.com"
                disabled={pending}
              />
            </Field>
            <Field label="Phone">
              <input
                className={inputCls}
                value={draft.phoneE164}
                onChange={(e) => setDraft({ ...draft, phoneE164: e.target.value })}
                placeholder="+1…"
                disabled={pending}
              />
            </Field>
            <Field label="Currency">
              <input
                className={inputCls}
                value={draft.currency}
                onChange={(e) => setDraft({ ...draft, currency: e.target.value.toUpperCase() })}
                placeholder="USD"
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
            <Field label="Payment contact">
              <input
                className={inputCls}
                value={draft.paymentContact}
                onChange={(e) => setDraft({ ...draft, paymentContact: e.target.value })}
                placeholder="Who/handle to pay"
                disabled={pending}
              />
            </Field>
          </div>
          <Field label="Address">
            <textarea
              className={cn(inputCls, "min-h-[3rem] resize-y")}
              value={draft.address}
              onChange={(e) => setDraft({ ...draft, address: e.target.value })}
              placeholder="Full mailing address"
              disabled={pending}
            />
          </Field>
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
          No external hosts yet. Add one to keep their contact + payment details.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200/80 dark:border-zinc-800/60">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-zinc-200/60 border-b bg-zinc-50/60 text-left font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em] dark:border-zinc-800/40 dark:bg-zinc-900/30">
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Contact</th>
                <th className="px-3 py-2 text-right">Rate / hr</th>
                <th className="px-3 py-2">Payment</th>
                <th className="w-16 px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {hosts.map((h) => (
                <tr
                  key={h.id}
                  className="group border-zinc-200/40 border-b align-top last:border-0 dark:border-zinc-800/30"
                >
                  <td className="px-3 py-2">
                    <div className="font-medium">{h.fullName}</div>
                    {h.address && (
                      <div className="whitespace-pre-line text-[11px] text-zinc-500">
                        {h.address}
                      </div>
                    )}
                    {h.notes && <div className="text-[11px] text-zinc-500">{h.notes}</div>}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
                    {h.email && <div className="truncate">{h.email}</div>}
                    {h.phoneE164 && <div>{h.phoneE164}</div>}
                    {!h.email && !h.phoneE164 && <span className="text-zinc-400">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {formatMoney(h.payRateCents, h.currency)}
                  </td>
                  <td className="px-3 py-2">
                    {h.paymentMethod ? (
                      <span className="capitalize">{h.paymentMethod}</span>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                    {h.paymentContact && (
                      <div className="text-[11px] text-zinc-500">{h.paymentContact}</div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 pointer-coarse:opacity-100">
                      <button
                        type="button"
                        onClick={() => startEdit(h)}
                        disabled={pending}
                        className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
                        aria-label={`Edit ${h.fullName}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(h)}
                        disabled={pending}
                        className="rounded p-1 text-zinc-400 hover:bg-rose-500/[0.08] hover:text-rose-600"
                        aria-label={`Remove ${h.fullName}`}
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
    // biome-ignore lint/a11y/noLabelWithoutControl: control is passed as children and nested inside the label
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">{label}</span>
      {children}
    </label>
  );
}
