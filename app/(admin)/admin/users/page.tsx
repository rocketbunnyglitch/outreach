/**
 * /admin/users — user + invite management.
 *
 * Lists every user on the admin's team plus pending invites. Each row
 * exposes:
 *   - Reset password (issues a /set-password link, admin copies it)
 *   - Impersonate (sets a 60s grant cookie, redirects through NextAuth)
 *   - Deactivate / Reactivate
 *
 * Two flows for adding a user, exposed via the InviteUserModal:
 *   "set_now"   — admin enters a password inline; user can log in right away
 *   "send_link" — creates an invite_tokens row; admin gets a link to share
 *
 * Admin-only via requireAdmin (non-admins see 404).
 */

import { inviteTokens, users } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { and, asc, eq, isNull } from "drizzle-orm";
import { UserPlus } from "lucide-react";
import { InviteUserModal } from "./_components/invite-user-modal";
import { PendingInvitesList } from "./_components/pending-invites-list";
import { UsersTable } from "./_components/users-table";

export const metadata = { title: "Admin · Users" };
export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const { staff } = await requireAdmin();

  const userRows = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      primaryEmail: users.primaryEmail,
      role: users.role,
      status: users.status,
      passwordSetAt: users.passwordSetAt,
      lastSignedIn: users.passwordSetAt, // proxy until we add real lastLoginAt
    })
    .from(users)
    .where(eq(users.teamId, staff.teamId))
    .orderBy(asc(users.displayName));

  // Show only pending (not yet accepted, not expired) invites of kind='invite'.
  const pendingInvites = await db
    .select({
      id: inviteTokens.id,
      email: inviteTokens.email,
      role: inviteTokens.role,
      expiresAt: inviteTokens.expiresAt,
      createdAt: inviteTokens.createdAt,
    })
    .from(inviteTokens)
    .where(
      and(
        eq(inviteTokens.teamId, staff.teamId),
        eq(inviteTokens.kind, "invite"),
        isNull(inviteTokens.acceptedAt),
      ),
    )
    .orderBy(asc(inviteTokens.createdAt));
  const pendingActive = pendingInvites.filter((i) => new Date(i.expiresAt).getTime() > Date.now());

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-zinc-500 uppercase tracking-widest">Admin</p>
          <h1 className="mt-1 font-semibold text-4xl tracking-tight">Users</h1>
          <p className="mt-2 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
            Invite + manage team members. Either set a password directly (for users you'll tell
            out-of-band) or send them a one-time link to set their own.
          </p>
        </div>
        <InviteUserModal>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-sm text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200">
            <UserPlus className="h-3.5 w-3.5" />
            Invite user
          </span>
        </InviteUserModal>
      </header>

      {pendingActive.length > 0 && <PendingInvitesList invites={pendingActive} />}

      <UsersTable currentUserId={staff.id} rows={userRows} />
    </div>
  );
}
