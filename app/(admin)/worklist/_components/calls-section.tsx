/**
 * Worklist Section 4: Calls to make (Phase 2.1 scaffold).
 * Placeholder empty state; call-task / callback queue wiring lands in Phase 2.5.
 */

import { PhoneCall } from "lucide-react";
import { WorklistEmpty, WorklistSection } from "./worklist-section";

export function CallsSection() {
  return (
    <WorklistSection
      title="Calls to make"
      subtitle="Callbacks requested and scheduled call tasks"
      icon={<PhoneCall className="h-4 w-4" />}
    >
      <WorklistEmpty message="No calls queued." />
    </WorklistSection>
  );
}
