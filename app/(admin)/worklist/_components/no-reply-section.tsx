/**
 * Worklist: No-reply follow-up reminders (Tier-2).
 *
 * Threads where we sent last and the venue has gone quiet for N business days,
 * and the cadence engine has no scheduled next touch. A REMINDER only -- opening
 * the thread lets the human decide whether to nudge; nothing is auto-drafted or
 * auto-sent. The list clears itself when the venue replies or we send again.
 */

import type { WorklistNoReplyRow } from "@/lib/worklist-data";
import { BellRing } from "lucide-react";
import Link from "next/link";
import { WorklistEmpty, WorklistSection } from "./worklist-section";

function NoReplyRow({ row }: { row: WorklistNoReplyRow }) {
  return (
    <Link
      href={`/inbox/${row.id}`}
      className="block rounded-xl border border-zinc-200 px-3 py-2.5 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="truncate font-medium text-sm">
          {row.venueName ?? "(no venue)"}
          {row.cityName ? <span className="text-zinc-500"> · {row.cityName}</span> : null}
        </span>
        <span className="shrink-0 rounded-md bg-zinc-100 px-1.5 py-0.5 font-medium text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {row.daysSilent}d no reply
        </span>
      </div>
      {row.subject ? (
        <p className="mt-1 truncate text-xs text-zinc-600 dark:text-zinc-400">{row.subject}</p>
      ) : null}
      {row.snippet ? <p className="mt-1 truncate text-xs text-zinc-500">{row.snippet}</p> : null}
    </Link>
  );
}

export function NoReplySection({ rows }: { rows: WorklistNoReplyRow[] }) {
  return (
    <WorklistSection
      title="No-reply nudges"
      subtitle="Threads gone quiet -- decide whether to follow up (nothing auto-sends)"
      icon={<BellRing className="h-4 w-4" />}
      count={rows.length}
    >
      {rows.length === 0 ? (
        <WorklistEmpty message="No silent threads need a nudge right now." />
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => (
            <NoReplyRow key={r.id} row={r} />
          ))}
        </div>
      )}
    </WorklistSection>
  );
}
