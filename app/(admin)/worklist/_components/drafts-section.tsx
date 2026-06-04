/**
 * Worklist Section 1: Drafts to review and send (Phase 2.1 scaffold).
 * Placeholder empty state; engine-draft query + rendering lands in Phase 2.2.
 */

import { FileCheck2 } from "lucide-react";
import { WorklistEmpty, WorklistSection } from "./worklist-section";

export function DraftsSection() {
  return (
    <WorklistSection
      title="Drafts to review and send"
      subtitle="Engine-generated drafts queued for you"
      icon={<FileCheck2 className="h-4 w-4" />}
    >
      <WorklistEmpty message="No drafts waiting. Engine drafts queued for you will show up here." />
    </WorklistSection>
  );
}
