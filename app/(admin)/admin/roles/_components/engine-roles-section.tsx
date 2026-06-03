"use client";

/**
 * EngineRolesSection - assign each engine FUNCTION-role to a user. One picker
 * per role; optimistic, reverts on server error. Distinct from the system-role
 * editor (which lives in the reused UsersTable below it on the page).
 */

import { useToast } from "@/components/ui/toast";
import { useState, useTransition } from "react";
import { setEngineRole } from "../_actions";

interface RoleRow {
  key: string;
  label: string;
  description: string;
  userId: string | null;
}
interface UserOption {
  id: string;
  displayName: string;
  role: string;
}

export function EngineRolesSection({
  roles: initial,
  users,
}: {
  roles: RoleRow[];
  users: UserOption[];
}) {
  const [roles, setRoles] = useState<RoleRow[]>(initial);
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="card-surface overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-zinc-200 border-b text-left font-mono text-[10px] text-zinc-500 uppercase tracking-widest dark:border-zinc-800/60">
            <th className="px-4 py-2.5">Engine function</th>
            <th className="px-4 py-2.5">Assigned to</th>
          </tr>
        </thead>
        <tbody>
          {roles.map((r) => (
            <Row
              key={r.key}
              row={r}
              users={users}
              onUpdate={(next) => {
                setRoles((prev) => prev.map((x) => (x.key === next.key ? next : x)));
                setError(null);
              }}
              onError={setError}
            />
          ))}
        </tbody>
      </table>
      {error && (
        <div className="border-rose-200 border-t bg-rose-50 px-4 py-2 text-rose-700 text-xs dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      )}
    </section>
  );
}

function Row({
  row,
  users,
  onUpdate,
  onError,
}: {
  row: RoleRow;
  users: UserOption[];
  onUpdate: (next: RoleRow) => void;
  onError: (msg: string | null) => void;
}) {
  const [isPending, startTx] = useTransition();
  const toast = useToast();

  function change(userId: string) {
    const previous = row;
    onUpdate({ ...row, userId: userId || null });
    startTx(async () => {
      const fd = new FormData();
      fd.set("roleKey", row.key);
      fd.set("userId", userId);
      const result = await setEngineRole(null, fd);
      if (!result.ok) {
        onUpdate(previous);
        onError(result.error);
        toast.show({
          kind: "error",
          message: result.error ?? "Couldn't update assignment.",
          code: result.code,
        });
      }
    });
  }

  return (
    <tr>
      <td className="px-4 py-3 align-top">
        <div className="font-medium">{row.label}</div>
        <div className="mt-0.5 max-w-md text-xs text-zinc-500">{row.description}</div>
      </td>
      <td className="px-4 py-3">
        <select
          value={row.userId ?? ""}
          onChange={(e) => change(e.target.value)}
          disabled={isPending}
          aria-label={`Assignee for ${row.label}`}
          className="rounded-md border border-zinc-300 bg-white px-2 py-0.5 text-xs focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="">Unassigned</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName} ({u.role})
            </option>
          ))}
        </select>
      </td>
    </tr>
  );
}
