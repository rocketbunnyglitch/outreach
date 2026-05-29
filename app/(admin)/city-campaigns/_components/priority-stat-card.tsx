"use client";

import { cn } from "@/lib/cn";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateCityCampaignPriority } from "../../_actions-tracker";

/** Inline-editable Priority tile on the city sheet header (1 = highest). */
export function PriorityStatCard({
  cityCampaignId,
  priority,
}: {
  cityCampaignId: string;
  priority: number;
}) {
  const router = useRouter();
  const [pending, startTx] = useTransition();
  const [value, setValue] = useState(String(priority));

  function handle(next: string) {
    setValue(next);
    startTx(async () => {
      const fd = new FormData();
      fd.set("cityCampaignId", cityCampaignId);
      fd.set("priority", next);
      const res = await updateCityCampaignPriority(null, fd);
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="flex flex-col justify-between rounded-xl border border-zinc-200/60 bg-zinc-50/40 p-3 dark:border-zinc-800/40 dark:bg-zinc-900/30">
      <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
        Priority
      </span>
      <select
        value={value}
        onChange={(e) => handle(e.target.value)}
        disabled={pending}
        title="Priority — 1 is highest, 10 is lowest. Change to re-rank this city."
        className={cn(
          "mt-2 w-14 appearance-none rounded-md border border-transparent bg-transparent font-mono text-lg tabular-nums transition-colors",
          "hover:border-zinc-300 focus:border-zinc-400 focus:outline-none dark:focus:border-zinc-600 dark:hover:border-zinc-700",
          pending && "opacity-50",
        )}
      >
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </div>
  );
}
