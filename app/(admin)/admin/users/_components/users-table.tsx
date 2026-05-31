"use client";

import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { Loader2, MoreVertical, ShieldOff, UserCog, UserMinus, UserPlus2 } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import {
  impersonateUser,
  resetUserPassword,
  setUserStatus,
  updateUserEmail,
  updateUserName,
  updateUserPassword,
  updateUserRole,
} from "../_actions";
import { InlineEditableCell } from "./inline-editable-cell";

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
  const toast = useToast();

  function resetAction() {
    setError(null);
    setResetLink(null);
    startTx(async () => {
      const fd = new FormData();
      fd.set("userId", user.id);
      const result = await resetUserPassword(null, fd);
      if (result.ok) {
        setResetLink(result.data.inviteLinkPath);
        toast.show({
          kind: "success",
          message: `Password reset link generated for ${user.displayName}.`,
        });
      } else {
        setError(result.error);
        toast.show({ kind: "error", message: result.error ?? "Couldn't reset password." });
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
      if (!result.ok) {
        setError(result.error);
        toast.show({ kind: "error", message: result.error ?? "Couldn't change status." });
      } else {
        toast.show({
          kind: "success",
          message:
            next === "active"
              ? `${user.displayName} activated.`
              : `${user.displayName} deactivated.`,
        });
      }
    });
  }

  return (
    <>
      <tr className={cn(stripe && "dark:bg-white/[0.015]")}>
        <td className="px-4 py-2.5 font-medium">
          <InlineEditableCell
            value={user.displayName}
            ariaLabel={`name for ${user.displayName}`}
            placeholder="Display name"
            commit={async (next) => {
              const fd = new FormData();
              fd.set("userId", user.id);
              fd.set("displayName", next);
              const result = await updateUserName(null, fd);
              return result.ok ? { ok: true } : { ok: false, error: result.error };
            }}
          />
        </td>
        <td className="px-4 py-2.5 font-mono text-xs text-zinc-600 dark:text-zinc-400">
          <InlineEditableCell
            value={user.primaryEmail}
            type="email"
            ariaLabel={`email for ${user.displayName}`}
            placeholder="user@example.com"
            commit={async (next) => {
              const fd = new FormData();
              fd.set("userId", user.id);
              fd.set("primaryEmail", next);
              const result = await updateUserEmail(null, fd);
              return result.ok ? { ok: true } : { ok: false, error: result.error };
            }}
          />
        </td>
        <td className="px-4 py-2.5">
          <RoleDropdown user={user} isSelf={isSelf} onError={setError} />
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
          <PasswordCell user={user} onError={setError} />
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

const ROLE_OPTIONS: Array<{ value: UserRow["role"]; label: string }> = [
  { value: "admin", label: "Admin" },
  { value: "lead", label: "Lead" },
  { value: "outreach", label: "Outreach" },
  { value: "readonly", label: "Read-only" },
];

/**
 * Role <select> dropdown. A constrained 4-value set, so a real
 * select is better UX than the text inline editor.
 *
 * Self-edit safeguard: an admin cannot change their OWN role away
 * from admin (mirrors the server-side check). The dropdown disables
 * non-admin options for the actor's own row so they don't get a
 * confusing "you can't change your own role" error after submission.
 */
function RoleDropdown({
  user,
  isSelf,
  onError,
}: {
  user: UserRow;
  isSelf: boolean;
  onError: (msg: string | null) => void;
}) {
  const [role, setRole] = useState<UserRow["role"]>(user.role);
  const [isPending, startTx] = useTransition();
  const toast = useToast();

  function onChange(next: UserRow["role"]) {
    if (next === role) return;
    const previous = role;
    setRole(next); // optimistic
    onError(null);
    startTx(async () => {
      const fd = new FormData();
      fd.set("userId", user.id);
      fd.set("role", next);
      const result = await updateUserRole(null, fd);
      if (!result.ok) {
        setRole(previous);
        onError(result.error);
        toast.show({ kind: "error", message: result.error ?? "Couldn't change role." });
      } else {
        toast.show({
          kind: "success",
          message: `${user.displayName} is now ${next}.`,
        });
      }
    });
  }

  return (
    <span className="inline-flex items-center gap-1">
      <select
        value={role}
        onChange={(e) => onChange(e.target.value as UserRow["role"])}
        disabled={isPending}
        className="rounded-md border border-zinc-300 bg-white px-2 py-0.5 font-mono text-[11px] uppercase tracking-widest focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-700 dark:bg-zinc-900"
        aria-label={`Role for ${user.displayName}`}
      >
        {ROLE_OPTIONS.map((opt) => (
          <option
            key={opt.value}
            value={opt.value}
            // Self can't pick non-admin on their own row.
            disabled={isSelf && opt.value !== "admin"}
          >
            {opt.label}
          </option>
        ))}
      </select>
      {isPending && <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />}
    </span>
  );
}

/**
 * Password cell — clicking opens an inline input that accepts a new
 * password. Empty input cancels; non-empty input is sent to
 * updateUserPassword, which validates length / strength server-side.
 *
 * The cell also surfaces the existing "set / pending invite" status
 * via the placeholder displayed in read mode. The actual password
 * is never sent to the client (and we never store the plaintext).
 */
function PasswordCell({
  user,
  onError,
}: {
  user: UserRow;
  onError: (msg: string | null) => void;
}) {
  const [savedAt, setSavedAt] = useState<Date | null>(user.passwordSetAt);
  const displayValue = savedAt ? "••••••••" : "pending invite";

  return (
    <InlineEditableCell
      // The "value" is never the password — we just pass the marker
      // so equality checks inside the cell don't accidentally short-
      // circuit. Real password input starts empty (see type="password"
      // behaviour in InlineEditableCell).
      value=""
      displayValue={displayValue}
      type="password"
      ariaLabel={`password for ${user.displayName}`}
      placeholder="New password (min 10 chars)"
      commit={async (next) => {
        const fd = new FormData();
        fd.set("userId", user.id);
        fd.set("password", next);
        const result = await updateUserPassword(null, fd);
        if (result.ok) {
          setSavedAt(new Date());
          onError(null);
          return { ok: true };
        }
        return { ok: false, error: result.error };
      }}
      className="font-mono text-[11px] uppercase tracking-widest"
    />
  );
}
