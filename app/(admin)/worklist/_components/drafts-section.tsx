/**
 * Worklist Section 1: Drafts to review and send (Phase 2.2).
 *
 * Renders the operator's queued drafts (engine-generated + manual); the
 * interactive rows live in the DraftsList client component. Empty state when
 * nothing is queued. Data is loaded once by the worklist page and passed in.
 */

import type { WorklistDraftRow } from "@/lib/worklist-data";
import { FileCheck2 } from "lucide-react";
import { DraftsList } from "./drafts-list";
import { WorklistEmpty, WorklistSection } from "./worklist-section";

export function DraftsSection({ drafts }: { drafts: WorklistDraftRow[] }) {
  return (
    <WorklistSection
      title="Drafts to review and send"
      subtitle="Engine-generated drafts queued for you"
      icon={<FileCheck2 className="h-4 w-4" />}
      count={drafts.length}
    >
      {drafts.length === 0 ? (
        <WorklistEmpty message="No drafts waiting. Engine drafts queued for you will show up here." />
      ) : (
        <DraftsList drafts={drafts} />
      )}
    </WorklistSection>
  );
}
