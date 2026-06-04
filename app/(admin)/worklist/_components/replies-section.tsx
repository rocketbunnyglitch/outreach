/**
 * Worklist Section 2: Replies needing attention (Phase 2.1 scaffold).
 * Placeholder empty state; needs_attention / suggested-classification queue
 * wiring lands in Phase 2.3.
 */

import { MessageSquareReply } from "lucide-react";
import { WorklistEmpty, WorklistSection } from "./worklist-section";

export function RepliesSection() {
  return (
    <WorklistSection
      title="Replies needing attention"
      subtitle="Inbound replies the engine flagged for you to triage"
      icon={<MessageSquareReply className="h-4 w-4" />}
    >
      <WorklistEmpty message="No replies need attention right now." />
    </WorklistSection>
  );
}
