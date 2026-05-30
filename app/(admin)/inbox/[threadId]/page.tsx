import { requireStaff } from "@/lib/auth";
import { suggestCampaignsForThread } from "@/lib/campaign-matcher";
import {
  FOLDER_LABELS,
  type InboxFolder,
  fetchFolderCounts,
  fetchInboxAliases,
  fetchInboxFilterFacets,
  fetchInboxThreads,
  fetchThreadDetail,
  fetchVenueOutreachHistory,
  isInboxFolder,
} from "@/lib/inbox-data";
import { listTeamLabels, listThreadLabels } from "@/lib/team-labels";
import { notFound } from "next/navigation";
import { FolderList } from "../_components/FolderList";
import { InboxFilterBar } from "../_components/InboxFilterBar";
import { InboxPresenceBar } from "../_components/InboxPresenceBar";
import { InboxShell } from "../_components/InboxShell";
import { ThreadListWithBulk } from "../_components/ThreadListWithBulk";
import { ThreadPane } from "../_components/ThreadPane";
import { InboxKeyboardNav } from "../_components/inbox-keyboard-nav";

export const metadata = { title: "Inbox" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ threadId: string }>;
  searchParams: Promise<{
    folder?: string;
    staff?: string;
    campaign?: string;
    brand?: string;
    label?: string;
    alias?: string;
    q?: string;
    mine?: string;
  }>;
}

/**
 * /inbox/[threadId] — same three-pane shell, with the requested thread
 * loaded in the right pane.
 *
 * The middle pane re-runs the list query so the active folder context
 * is preserved when navigating between threads. We don't fight to keep
 * scroll position on the list — Gmail doesn't either; the cost of
 * client-side state for this is more than the benefit.
 */
export default async function InboxThreadPage({ params, searchParams }: Props) {
  const { threadId } = await params;
  const search = await searchParams;
  const { staff: currentStaff } = await requireStaff();

  const folder: InboxFolder = isInboxFolder(search.folder) ? search.folder : "inbox";
  const mine = search.mine === "1";
  const assignedStaffId =
    search.staff === "mine"
      ? currentStaff.id
      : search.staff === currentStaff.id
        ? currentStaff.id
        : undefined;
  const mineAssigned = assignedStaffId === currentStaff.id;

  const [detail, threads, counts, aliases, facets] = await Promise.all([
    fetchThreadDetail(threadId),
    fetchInboxThreads({
      folder,
      currentTeamId: currentStaff.teamId,
      currentUserId: currentStaff.id,
      mine,
      assignedStaffId,
      cityCampaignId: search.campaign,
      outreachBrandId: search.brand,
      labelId: search.label,
      aliasId: search.alias,
      search: search.q,
    }),
    fetchFolderCounts({
      currentTeamId: currentStaff.teamId,
      currentUserId: currentStaff.id,
      mine,
    }),
    fetchInboxAliases({
      currentTeamId: currentStaff.teamId,
      currentUserId: currentStaff.id,
    }),
    fetchInboxFilterFacets({
      currentTeamId: currentStaff.teamId,
      currentUserId: currentStaff.id,
      mine,
    }),
  ]);

  if (!detail) notFound();

  // When the thread isn't matched to a venue yet (poll worker
  // couldn't resolve the sender domain), there's no per-venue
  // outreach history to fetch. Empty list keeps ThreadPane happy.
  const outreachHistory = detail.thread.venueId
    ? await fetchVenueOutreachHistory(detail.thread.venueId)
    : [];

  // Labels applied to THIS thread + the full team-label catalogue so
  // the inline picker can render checked/unchecked state without an
  // extra round trip. Both queries are small (single-team scope).
  // Smart-detection runs in parallel: rule-based scorer that surfaces
  // the most plausible active city_campaign for the thread. Returns
  // empty list when the thread is already attributed or nothing
  // crosses the confidence threshold.
  const [threadLabels, teamLabelsAll, campaignSuggestions] = await Promise.all([
    listThreadLabels(threadId),
    listTeamLabels(currentStaff.teamId),
    suggestCampaignsForThread({
      threadId,
      currentCityCampaignId: detail.thread.cityCampaignId,
      venueId: detail.thread.venueId,
      subject: detail.thread.subject,
      teamId: currentStaff.teamId,
    }),
  ]);

  const preservedQuery = new URLSearchParams();
  preservedQuery.set("folder", folder);
  if (mine) preservedQuery.set("mine", "1");
  if (mineAssigned) preservedQuery.set("staff", currentStaff.id);
  if (search.campaign) preservedQuery.set("campaign", search.campaign);
  if (search.brand) preservedQuery.set("brand", search.brand);
  if (search.label) preservedQuery.set("label", search.label);
  if (search.alias) preservedQuery.set("alias", search.alias);
  if (search.q) preservedQuery.set("q", search.q);

  return (
    <InboxShell
      left={
        <div className="flex h-full flex-col">
          <FolderList
            activeFolder={folder}
            counts={counts}
            mineOnly={mineAssigned}
            currentStaffId={currentStaff.id}
            facets={facets}
            activeBrandId={search.brand}
            activeCampaignId={search.campaign}
            activeLabelId={search.label}
            preservedQueryBase={(() => {
              const p = new URLSearchParams(preservedQuery.toString());
              p.delete("folder");
              p.delete("brand");
              p.delete("campaign");
              p.delete("label");
              return p.toString();
            })()}
          />
          <InboxPresenceBar currentStaffId={currentStaff.id} />
        </div>
      }
      middle={
        <div className="flex h-full flex-col">
          <InboxFilterBar
            aliases={aliases}
            currentStaffId={currentStaff.id}
            mineAssigned={mineAssigned}
            mineInbox={mine}
            activeAliasId={search.alias}
            initialSearch={search.q}
          />
          <div className="flex-1 overflow-y-auto">
            <ThreadListWithBulk
              threads={threads}
              activeThreadId={threadId}
              folderLabel={FOLDER_LABELS[folder]}
              preservedQuery={preservedQuery.toString()}
              isTrashView={folder === "trash"}
            />
            {/* j/k navigation between threads in the current folder
                + ? for the shortcut help dialog. Mounts here so it
                runs from the detail view too. */}
            <InboxKeyboardNav
              threadIds={threads.map((t) => t.id)}
              activeThreadId={threadId}
              preservedQuery={preservedQuery.toString()}
            />
          </div>
        </div>
      }
      right={
        <ThreadPane
          detail={detail}
          outreachHistory={outreachHistory}
          threadLabels={threadLabels}
          allTeamLabels={teamLabelsAll}
          campaignSuggestions={campaignSuggestions}
          isAdmin={currentStaff.role === "admin"}
        />
      }
    />
  );
}
