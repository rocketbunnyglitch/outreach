/**
 * Worklist Section 3: Follow-ups due (Phase 2.1 scaffold).
 * Placeholder empty state; cadence-due query wiring lands in Phase 2.4.
 */

import { CalendarClock } from "lucide-react";
import { WorklistEmpty, WorklistSection } from "./worklist-section";

export function FollowUpsSection() {
  return (
    <WorklistSection
      title="Follow-ups due"
      subtitle="Venues due for their next cadence touch"
      icon={<CalendarClock className="h-4 w-4" />}
    >
      <WorklistEmpty message="No follow-ups due today." />
    </WorklistSection>
  );
}
