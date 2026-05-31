"use client";

import { useToast } from "@/components/ui/toast";
import { Clock, Loader2, X } from "lucide-react";
import { useState, useTransition } from "react";
import { revokePendingInvite } from "../_actions";

interface PendingInvite {
  id: string;
  email: string;
  role: string | null;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * Pending-invite list, rendered above the user table when invites
 * exist. Each row shows email, role, time-until-expiry, and a
 * Revoke button. Revoking deletes the invite token AND
 * soft-deactivates the placeholder user so the email can be
 * re-invited without "already exists" friction.
 *
 * Auth on the server action is admin-only. The button surfaces a
 * confirm prompt before firing so admin can't bulk-revoke by
 * accident.
 */
export function PendingInvitesList({ invites }: { invites: PendingInvite[] }) {
  return (
    <section className="rounded-2xl border border-amber-200/60 bg-amber-50/40 p-4 dark:border-amber-900/40 dark:bg-amber-950/20">
      <header className="mb-3 flex items-center gap-2">
        <Clock className="h-3.5 w-3.5 text-amber-700 dark:text-amber-400" />
        <h2 className="font-mono text-[10px] text-amber-800 uppercase tracking-[0.12em] dark:text-amber-300">
          Pending invites ({invites.length})
        </h2>
      </header>
      <ul className="flex flex-col gap-1">
        {invites.map((inv) => (
          <PendingInviteRow key={inv.id} invite={inv} />
        ))}
      </ul>
    </section>
  );
}

function PendingInviteRow({ invite }: { invite: PendingInvite }) {
  const [pending, startTx] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  function handleRevoke() {
    if (!confirm(`Revoke invite for ${invite.email}? The email can be re-invited after.`)) {
      return;
    }
    setError(null);
    startTx(async () => {
      const fd = new FormData();
      fd.set("inviteId", invite.id);
      const res = await revokePendingInvite(null, fd);
      if (!res.ok) {
        setError(res.error);
        toast.show({
          kind: "error",
          message: res.error ?? "Couldn't revoke invite.",
          code: res.code,
        });
      } else {
        toast.show({ kind: "success", message: `Revoked invite for ${invite.email}.` });
      }
      // Successful revoke triggers revalidatePath('/admin/users') so
      // the row vanishes via re-render. No local state change needed.
    });
  }

  return (
    <li className="flex items-center justify-between gap-3 rounded-md bg-white/60 px-3 py-1.5 text-xs dark:bg-zinc-900/40">
      <span className="flex flex-1 items-center gap-3">
        <span className="font-mono">{invite.email}</span>
        {invite.role && (
          <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
            {invite.role}
          </span>
        )}
      </span>
      <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
        expires {formatRelative(invite.expiresAt)}
      </span>
      <button
        type="button"
        onClick={handleRevoke}
        disabled={pending}
        title="Revoke this invite (the email can be re-invited after)"
        aria-label={`Revoke invite for ${invite.email}`}
        className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 font-mono text-[10px] text-rose-700 hover:bg-rose-100 disabled:opacity-50 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-300"
      >
        {pending ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <X className="h-2.5 w-2.5" />}
        Revoke
      </button>
      {error && (
        <span className="font-mono text-[10px] text-rose-600 dark:text-rose-300">{error}</span>
      )}
    </li>
  );
}

function formatRelative(date: Date): string {
  const diff = date.getTime() - Date.now();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 0) return "expired";
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.round(hours / 24);
  return `in ${days}d`;
}
