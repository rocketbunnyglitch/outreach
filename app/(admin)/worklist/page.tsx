/**
 * /worklist - the operator's daily worklist.
 *
 * The single dummy-proofing surface: everything an operator needs to do today,
 * grouped into four queues (drafts, replies, follow-ups, calls). The four
 * datasets are loaded once here and passed into the (presentational) sections;
 * when all four are empty the page shows a celebratory "all caught up" state
 * with today's completion stats (Phase 2.6).
 *
 * Intended as the primary landing for the outreach + lead roles; that default
 * post-login redirect is deliberately deferred until later, so operators are
 * not dropped onto an empty page.
 */

import { requireStaff } from "@/lib/auth";
import { loadCityFocus } from "@/lib/city-focus";
import {
  loadWorklistCalls,
  loadWorklistComebacks,
  loadWorklistDrafts,
  loadWorklistFloorStaffCalls,
  loadWorklistFollowUps,
  loadWorklistNoReplyNudges,
  loadWorklistRelationshipFlags,
  loadWorklistReplies,
  loadWorklistSlotChanges,
} from "@/lib/worklist-data";
import { CallsSection } from "./_components/calls-section";
import { CityFocusSection } from "./_components/city-focus-section";
import { ComebacksSection } from "./_components/comebacks-section";
import { DraftsSection } from "./_components/drafts-section";
import { FloorStaffCallsSection } from "./_components/floor-staff-calls-section";
import { FollowUpsSection } from "./_components/follow-ups-section";
import { NoReplySection } from "./_components/no-reply-section";
import { RelationshipFlagsSection } from "./_components/relationship-flags-section";
import { RepliesSection } from "./_components/replies-section";
import { SlotChangeSection } from "./_components/slot-change-section";
import { WorklistAllCaughtUp } from "./_components/worklist-all-caught-up";

export const metadata = { title: "Daily worklist" };
export const dynamic = "force-dynamic";

export default async function WorklistPage() {
  const { staff } = await requireStaff();

  // Load all four queues once so we can detect the all-empty state without
  // double-querying; the sections render the data passed in.
  const [
    drafts,
    replies,
    followUps,
    calls,
    relationshipFlags,
    comebacks,
    floorStaffCalls,
    slotChanges,
    noReplyNudges,
    cityFocus,
  ] = await Promise.all([
    loadWorklistDrafts({ staffId: staff.id }),
    loadWorklistReplies({ staffId: staff.id }),
    loadWorklistFollowUps({ staffId: staff.id }),
    loadWorklistCalls({ staffId: staff.id }),
    loadWorklistRelationshipFlags({ staffId: staff.id }),
    loadWorklistComebacks({ staffId: staff.id }),
    loadWorklistFloorStaffCalls({ staffId: staff.id }),
    loadWorklistSlotChanges({ staffId: staff.id }),
    loadWorklistNoReplyNudges({ staffId: staff.id }),
    loadCityFocus({ staffId: staff.id }),
  ]);
  const allEmpty =
    drafts.length === 0 &&
    replies.length === 0 &&
    followUps.length === 0 &&
    calls.length === 0 &&
    relationshipFlags.length === 0 &&
    comebacks.length === 0 &&
    floorStaffCalls.length === 0 &&
    slotChanges.length === 0 &&
    noReplyNudges.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="font-mono text-xs text-zinc-500 uppercase tracking-widest">Current Crawl</p>
        <h1 className="mt-1 font-semibold text-4xl tracking-tight">Daily worklist</h1>
        <p className="mt-2 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
          Everything you need to do today.
        </p>
      </header>

      {/* Always first: which cities to cold-email today. Renders even when
          the reactive queues are empty -- proactive outreach IS the job on a
          quiet day. */}
      <CityFocusSection focus={cityFocus} />

      {allEmpty ? (
        <WorklistAllCaughtUp staffId={staff.id} />
      ) : (
        <div className="flex flex-col gap-4">
          <SlotChangeSection slotChanges={slotChanges} />
          <FloorStaffCallsSection calls={floorStaffCalls} />
          <ComebacksSection comebacks={comebacks} />
          <RelationshipFlagsSection flags={relationshipFlags} />
          <DraftsSection drafts={drafts} />
          <RepliesSection replies={replies} />
          <FollowUpsSection followUps={followUps} />
          <NoReplySection rows={noReplyNudges} />
          <CallsSection calls={calls} />
        </div>
      )}
    </div>
  );
}
