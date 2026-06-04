/**
 * Worklist Section 4: Calls to make today (Phase 2.5).
 *
 * High-priority venues the operator should phone: cold entries they own, in
 * priority 1-3 cities, due for a call and not phoned in the last 2 days, capped
 * at 8 and ranked by priority. Click-to-call reuses the existing QuoDialControls
 * (Quo / OpenPhone). Pure server component; the dial control is the only
 * interactive piece.
 */

import type { WorklistCallRow } from "@/lib/worklist-data";
import { PhoneCall } from "lucide-react";
import { QuoDialControls } from "../../city-campaigns/_components/quo-dial-controls";
import { WorklistEmpty, WorklistSection } from "./worklist-section";

// Priority badge colour. Per the engine palette we avoid rose/red for
// non-destructive signals, so P1 leads with amber rather than red.
function priorityBadgeClass(priority: number): string {
  if (priority === 1) return "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300";
  if (priority === 2) return "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300";
  return "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400";
}

function CallRow({ call }: { call: WorklistCallRow }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={`shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[11px] ${priorityBadgeClass(call.priority)}`}
        >
          P{call.priority}
        </span>
        <div className="min-w-0">
          <p className="truncate font-medium text-sm">
            {call.venueName}
            {call.cityName ? <span className="text-zinc-500"> · {call.cityName}</span> : null}
          </p>
          <p className="truncate text-xs text-zinc-500">{call.summary}</p>
        </div>
      </div>
      <div className="shrink-0">
        <QuoDialControls
          venueId={call.venueId}
          venueName={call.venueName}
          venuePhone={call.phoneE164}
          outreachBrandId={call.outreachBrandId}
          cityCampaignId={call.cityCampaignId}
          coldEntryId={call.coldEntryId}
          venueHours={call.venueHours}
          venueTimezone={call.venueTimezone ?? undefined}
        />
      </div>
    </div>
  );
}

export function CallsSection({ calls }: { calls: WorklistCallRow[] }) {
  return (
    <WorklistSection
      title="Calls to make"
      subtitle="High-priority venues to phone today"
      icon={<PhoneCall className="h-4 w-4" />}
      count={calls.length}
    >
      {calls.length === 0 ? (
        <WorklistEmpty message="No calls queued for today." />
      ) : (
        <div className="flex flex-col gap-2">
          {calls.map((c) => (
            <CallRow key={c.coldEntryId} call={c} />
          ))}
        </div>
      )}
    </WorklistSection>
  );
}
