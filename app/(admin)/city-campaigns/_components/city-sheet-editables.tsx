"use client";

import { cn } from "@/lib/cn";
import { Pencil, User2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { reassignCityCampaign, updateDashboardNote } from "../../_actions-tracker";

/** Inline-editable "Assigned" tile — pick the lead staffer right on the sheet. */
export function AssignStatCard({
  cityCampaignId,
  leadStaffId,
  staff,
}: {
  cityCampaignId: string;
  leadStaffId: string | null;
  staff: Array<{ id: string; displayName: string }>;
}) {
  const router = useRouter();
  const [pending, startTx] = useTransition();
  const [value, setValue] = useState(leadStaffId ?? "");

  function handle(next: string) {
    setValue(next);
    startTx(async () => {
      const fd = new FormData();
      fd.set("cityCampaignId", cityCampaignId);
      fd.set("leadStaffId", next);
      const res = await reassignCityCampaign(null, fd);
      if (res.ok) router.refresh();
    });
  }

  return (
    <div
      title="The lead staffer responsible for this city. Change it here anytime."
      className={cn(
        "flex flex-col justify-between rounded-xl border border-zinc-200/60 p-3 dark:border-zinc-800/40",
        value ? "bg-blue-50/30 dark:bg-blue-950/15" : "bg-zinc-50/40 dark:bg-zinc-900/30",
      )}
    >
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
        <User2 className="h-3 w-3" /> Assigned
      </span>
      <select
        value={value}
        onChange={(e) => handle(e.target.value)}
        disabled={pending}
        className={cn(
          "mt-2 w-full appearance-none rounded-md border border-transparent bg-transparent font-semibold text-base tracking-tight transition-colors",
          "hover:border-zinc-300 focus:border-zinc-400 focus:outline-none dark:hover:border-zinc-700",
          pending && "opacity-50",
        )}
      >
        <option value="">Unassigned</option>
        {staff.map((s) => (
          <option key={s.id} value={s.id}>
            {s.displayName}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Inline-editable dashboard note for the city sheet (click to edit). */
export function EditableDashboardNote({
  cityCampaignId,
  note,
}: {
  cityCampaignId: string;
  note: string | null;
}) {
  const router = useRouter();
  const [pending, startTx] = useTransition();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(note ?? "");

  function save() {
    startTx(async () => {
      const fd = new FormData();
      fd.set("cityCampaignId", cityCampaignId);
      fd.set("note", value);
      const res = await updateDashboardNote(null, fd);
      if (res.ok) {
        setEditing(false);
        router.refresh();
      }
    });
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="Click to edit this city's dashboard note"
        className="mt-4 inline-flex w-full items-center gap-2 rounded-lg border border-zinc-200/60 bg-zinc-50/40 px-3 py-2 text-left text-xs text-zinc-700 italic transition-colors hover:border-zinc-300 dark:border-zinc-800/40 dark:bg-zinc-900/30 dark:text-zinc-300 dark:hover:border-zinc-700"
      >
        <Pencil className="h-3 w-3 shrink-0 text-zinc-400" />
        {value ? `“${value}”` : <span className="text-zinc-400">Add a dashboard note…</span>}
      </button>
    );
  }

  return (
    <div className="mt-4 flex items-center gap-2">
      <input
        // biome-ignore lint/a11y/noAutofocus: editor opens on explicit click
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") {
            setValue(note ?? "");
            setEditing(false);
          }
        }}
        maxLength={500}
        placeholder="Dashboard note"
        className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-900"
      />
      <button
        type="button"
        onClick={save}
        disabled={pending}
        className="rounded-md bg-zinc-900 px-3 py-2 text-xs text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        Save
      </button>
    </div>
  );
}
