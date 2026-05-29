/**
 * /admin/labels — team-label CRUD.
 *
 * Lists every label on the team plus a "+ Add label" trigger. Each
 * row supports rename + delete. New labels fan out to every
 * connected Gmail on the team automatically (lib/team-labels.createTeamLabel).
 */

import { requireAdmin } from "@/lib/auth";
import { listTeamLabels } from "@/lib/team-labels";
import { Tag } from "lucide-react";
import { AddLabelButton } from "./_components/add-label-button";
import { LabelList } from "./_components/label-list";

export const metadata = { title: "Admin · Labels" };
export const dynamic = "force-dynamic";

export default async function AdminLabelsPage() {
  const { staff } = await requireAdmin();
  const labels = await listTeamLabels(staff.teamId);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-zinc-500 uppercase tracking-widest">Admin</p>
          <h1 className="mt-1 font-semibold text-4xl tracking-tight">Labels</h1>
          <p className="mt-2 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
            Tags applied to threads, mirrored two-way with every connected Gmail on your team.
            Applying a label here pushes it to Gmail; labelling a thread in Gmail brings it back
            into the dashboard on the next poll.
          </p>
        </div>
        <AddLabelButton />
      </header>

      {labels.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 border-dashed p-12 text-center dark:border-zinc-800">
          <Tag className="mx-auto h-6 w-6 text-zinc-400" />
          <p className="mt-3 text-sm text-zinc-500">
            No labels yet. Add one with the "Add label" button above.
          </p>
        </div>
      ) : (
        <LabelList labels={labels} />
      )}
    </div>
  );
}
