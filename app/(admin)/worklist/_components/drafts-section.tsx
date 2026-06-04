/**
 * Worklist Section 1: Drafts to review and send (Phase 2.2).
 *
 * Loads the operator's queued drafts (engine-generated + manual) and renders
 * them; the interactive rows live in the DraftsList client component. Empty
 * state when nothing is queued.
 */

import { loadWorklistDrafts } from "@/lib/worklist-data";
import { FileCheck2 } from "lucide-react";
import { DraftsList } from "./drafts-list";
import { WorklistEmpty, WorklistSection } from "./worklist-section";

export async function DraftsSection({ staffId }: { staffId: string }) {
  const drafts = await loadWorklistDrafts({ staffId });

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
