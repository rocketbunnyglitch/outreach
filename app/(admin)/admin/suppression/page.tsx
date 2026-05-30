/**
 * /admin/suppression — list + manage the team's email suppression
 * list. Admin-only.
 *
 * Hard-blocks at send time on any address in this list. Reasons:
 *   manual       operator marked
 *   bounced      hard-bounce (auto-populated by the Gmail poll worker
 *                via lib/gmail-poll-worker.ts → classifyBounce; soft
 *                bounces also escalate here after 3 consecutive
 *                failures per migration 0053)
 *   complained   spam complaint
 *   unsubscribe  RFC 8058 List-Unsubscribe click / inbound STOP reply
 *                 (the auto-detector populates this from the poll worker)
 */

import { emailSuppression, users } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { desc, eq } from "drizzle-orm";
import { ShieldOff } from "lucide-react";
import { AddSuppressionForm } from "./_components/add-suppression-form";
import { SuppressionTable } from "./_components/suppression-table";

export const metadata = { title: "Admin · Suppression" };
export const dynamic = "force-dynamic";

export default async function SuppressionPage() {
  const ctx = await requireAdmin();
  const rows = await db
    .select({
      id: emailSuppression.id,
      email: emailSuppression.email,
      reason: emailSuppression.reason,
      notes: emailSuppression.notes,
      sourceThreadId: emailSuppression.sourceThreadId,
      createdAt: emailSuppression.createdAt,
      createdByName: users.displayName,
    })
    .from(emailSuppression)
    .leftJoin(users, eq(users.id, emailSuppression.createdBy))
    .where(eq(emailSuppression.teamId, ctx.staff.teamId))
    .orderBy(desc(emailSuppression.createdAt));

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-zinc-500 uppercase tracking-widest">Admin</p>
          <h1 className="mt-1 font-semibold text-4xl tracking-tight">Suppression</h1>
          <p className="mt-2 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
            Email addresses on this list are HARD-BLOCKED at send time across every connected inbox
            on the team. Use for unsubscribes, hard bounces, spam complaints, and operator-marked
            do-not-contact addresses that aren't tied to a specific venue.
          </p>
        </div>
      </header>

      <AddSuppressionForm />

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 border-dashed p-12 text-center dark:border-zinc-800">
          <ShieldOff className="mx-auto h-6 w-6 text-zinc-400" />
          <p className="mt-3 text-sm text-zinc-500">No suppressed addresses yet.</p>
        </div>
      ) : (
        <SuppressionTable rows={rows} />
      )}
    </div>
  );
}
