/**
 * Worklist Section 3: Follow-ups due (Phase 2.4).
 *
 * Cadence touches coming due over the next 7 days for the operator's owned
 * venues, plus scheduled drafts (lifecycle touches once Phase 3.x schedules
 * them). Grouped by day; rows are interactive (Draft now / Review) in the
 * FollowUpsList client component.
 */

import type { WorklistFollowUpRow } from "@/lib/worklist-data";
import { CalendarClock } from "lucide-react";
import { FollowUpsList } from "./follow-ups-list";
import { WorklistEmpty, WorklistSection } from "./worklist-section";

export function FollowUpsSection({ followUps }: { followUps: WorklistFollowUpRow[] }) {
  return (
    <WorklistSection
      title="Follow-ups due"
      subtitle="Venues due for their next cadence touch"
      icon={<CalendarClock className="h-4 w-4" />}
      count={followUps.length}
    >
      {followUps.length === 0 ? (
        <WorklistEmpty message="No follow-ups due in the next 7 days." />
      ) : (
        <FollowUpsList rows={followUps} />
      )}
    </WorklistSection>
  );
}
