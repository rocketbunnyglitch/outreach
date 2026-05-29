"use client";

import { cn } from "@/lib/cn";
import { Loader2, MoreVertical, ShieldOff, UserCog, UserMinus, UserPlus2 } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { impersonateUser, resetUserPassword, setUserStatus } from "../_actions";

interface UserRow {
  id: string;
  displayName: string;
  primaryEmail: string;
  role: "admin" | "lead" | "outreach" | "readonly";
  status: "active" | "inactive";
  passwordSetAt: Date | null;
  lastSignedIn: Date | null;
}

export function UsersTable({
  rows,
  currentUserId,
}: {
  rows: UserRow[];
  currentUserId: string;
}) {
  return (
    <section>
      <div className="card-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-zinc-200 border-b text-left font-mono text-[10px] text-zinc-500 uppercase tracking-widest dark:border-zinc-800/60">
              <th className="px-4 py-2.5">Name</th>
              <th className="px-4 py-2.5">Email</th>
              <th className="px-4 py-2.5">Role</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Password</th>
              <th className="px-4 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u, i) => (
              <UserRowEl key={u.id} user={u} stripe={i % 2 === 1} isSelf={u.id === currentUserId} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function UserRowEl({
  user,
  stripe,
  isSelf,
}: {
  user: UserRow;
  stripe: boolean;
  isSelf: boolean;
}) {
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTx] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function resetAction() {
    setError(null);
    setResetLink(null);
    startTx(async () => {
      const fd = new FormData();
      fd.set("userId", user.id);
      const result = await resetUserPassword(null, fd);
      if (result.ok) {
        setResetLink(result.data.inviteLinkPath);
      } else {
        setError(result.error);
      }
    });
  }

  function toggleStatus(next: "active" | "inactive") {
    if (isSelf) return;
    setError(null);
    startTx(async () => {
      const fd = new FormData();
      fd.set("userId", user.id);
      fd.set("status", next);
      const result = await setUserStatus(null, fd);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <>
      <tr className={cn(stripe && "dark:bg-white/[0.015]")}>
        <td className="px-4 py-2.5 font-medium">{user.displayName}</td>
        <td className="px-4 py-2.5 font-mono text-xs text-zinc-600 dark:text-zinc-400">
          {user.primaryEmail}
        </td>
        <td className="px-4 py-2.5">
          <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
            {user.role}
          </span>
        </td>
        <td className="px-4 py-2.5">
          <span
            className={cn(
              "font-mono text-[10px] uppercase tracking-widest",
              user.status === "active" ? "text-emerald-500" : "text-zinc-500",
            )}
          >
            {user.status}
          </span>
        </td>
        <td className="px-4 py-2.5">
          <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
            {user.passwordSetAt ? "set" : "pending invite"}
          </span>
        </td>
        <td className="px-4 py-2.5">
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={resetAction}
              disabled={isPending}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
              title="Issue a one-time password reset link"
            >
              <UserCog className="h-3 w-3" />
              Reset
            </button>
            {!isSelf && (
              <form action={impersonateUser} ref={formRef}>
                <input type="hidden" name="userId" value={user.id} />
                <button
                  type="submit"
                  disabled={isPending || user.status !== "active"}
                  className="inline-flex items-center gap-1 rounded-md border border-amber-300/60 bg-amber-50 px-2 py-1 text-amber-800 text-xs hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300 dark:hover:bg-amber-950/50"
                  title="Sign in as this user (60-second grant)"
                >
                  <UserPlus2 className="h-3 w-3" />
                  Impersonate
                </button>
              </form>
            )}
            {!isSelf && user.status === "active" && (
              <button
                type="button"
                onClick={() => toggleStatus("inactive")}
                disabled={isPending}
                className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-rose-700 text-xs hover:bg-rose-100 disabled:opacity-50 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-400 dark:hover:bg-rose-950/50"
              >
                <UserMinus className="h-3 w-3" />
                Deactivate
              </button>
            )}
            {!isSelf && user.status === "inactive" && (
              <button
                type="button"
                onClick={() => toggleStatus("active")}
                disabled={isPending}
                className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-emerald-700 text-xs hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-300 dark:hover:bg-emerald-950/50"
              >
                Reactivate
              </button>
            )}
            {isPending && <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />}
          </div>
        </td>
      </tr>
      {(resetLink || error) && (
        <tr className={cn(stripe && "dark:bg-white/[0.015]")}>
          <td colSpan={6} className="px-4 pb-3">
            {resetLink && (
              <div className="flex flex-col gap-1 rounded-md bg-blue-50 px-3 py-2 text-blue-900 text-xs dark:bg-blue-950/40 dark:text-blue-200">
                <span>
                  One-time reset link for <strong>{user.primaryEmail}</strong> (expires in 1 hour).
                  Copy + send out-of-band:
                </span>
                <code className="break-all font-mono text-[11px]">{resetLink}</code>
              </div>
            )}
            {error && (
              <div className="rounded-md bg-rose-50 px-3 py-2 text-rose-700 text-xs dark:bg-rose-950/40 dark:text-rose-300">
                {error}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// Silence unused-import warnings for icons currently kept for future use.
void ShieldOff;
void MoreVertical;
