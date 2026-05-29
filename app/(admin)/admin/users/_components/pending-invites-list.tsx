"use client";

import { Clock } from "lucide-react";

interface PendingInvite {
  id: string;
  email: string;
  role: string | null;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * Pending-invite list, rendered above the user table when invites
 * exist. Each row shows email, role, and time-until-expiry. Click
 * does nothing for now — the admin already has the link from the
 * invite modal; if they lost it, the workflow is to reset (which
 * issues a new token) or revoke + reinvite (not yet exposed).
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
          <li
            key={inv.id}
            className="flex items-center justify-between gap-3 rounded-md bg-white/60 px-3 py-1.5 text-xs dark:bg-zinc-900/40"
          >
            <span className="flex flex-1 items-center gap-3">
              <span className="font-mono">{inv.email}</span>
              {inv.role && (
                <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
                  {inv.role}
                </span>
              )}
            </span>
            <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
              expires {formatRelative(inv.expiresAt)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatRelative(d: Date): string {
  const ms = new Date(d).getTime() - Date.now();
  if (ms < 0) return "expired";
  const hours = ms / 3_600_000;
  if (hours < 1) return `in ${Math.max(1, Math.round(ms / 60_000))} min`;
  if (hours < 24) return `in ${Math.round(hours)} h`;
  return `in ${Math.round(hours / 24)} d`;
}
