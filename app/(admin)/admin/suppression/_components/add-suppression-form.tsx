"use client";

import { Loader2, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { addSuppression } from "../_actions";

const REASONS: Array<{ value: string; label: string }> = [
  { value: "manual", label: "Manual" },
  { value: "unsubscribe", label: "Unsubscribed" },
  { value: "bounced", label: "Bounced" },
  { value: "complained", label: "Spam complaint" },
];

export function AddSuppressionForm() {
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("manual");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTx] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const fd = new FormData();
    fd.set("email", email);
    fd.set("reason", reason);
    if (notes.trim()) fd.set("notes", notes);
    startTx(async () => {
      const result = await addSuppression(null, fd);
      if (result.ok) {
        setEmail("");
        setNotes("");
        setReason("manual");
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form
      onSubmit={submit}
      className="card-surface flex flex-col gap-3 p-4 sm:flex-row sm:items-end"
    >
      <label className="flex flex-1 flex-col gap-1">
        <span className="font-medium text-xs">Email</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          placeholder="badaddress@example.com"
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-medium text-xs">Reason</span>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-700 dark:bg-zinc-900"
        >
          {REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-1 flex-col gap-1">
        <span className="font-medium text-xs">Notes (optional)</span>
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Why is this suppressed?"
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>
      <button
        type="submit"
        disabled={isPending || !email.trim()}
        className="inline-flex items-center gap-1.5 self-end rounded-md bg-zinc-900 px-3 py-2 font-medium text-sm text-zinc-50 hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Plus className="h-3.5 w-3.5" />
        )}
        Add
      </button>
      {error && (
        <span className="basis-full rounded-md bg-rose-50 px-3 py-1.5 text-rose-700 text-xs dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </span>
      )}
    </form>
  );
}
