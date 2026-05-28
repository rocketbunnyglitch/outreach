import { requireStaff } from "@/lib/auth";
import {
  FOLDER_LABELS,
  type InboxFolder,
  fetchFolderCounts,
  fetchInboxAliases,
  fetchInboxThreads,
  fetchThreadDetail,
  fetchVenueOutreachHistory,
  isInboxFolder,
} from "@/lib/inbox-data";
import { notFound } from "next/navigation";
import { FolderList } from "../_components/FolderList";
import { InboxFilterBar } from "../_components/InboxFilterBar";
import { InboxPresenceBar } from "../_components/InboxPresenceBar";
import { InboxShell } from "../_components/InboxShell";
import { ThreadList } from "../_components/ThreadList";
import { ThreadPane } from "../_components/ThreadPane";

export const metadata = { title: "Inbox" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ threadId: string }>;
  searchParams: Promise<{
    folder?: string;
    staff?: string;
    campaign?: string;
    brand?: string;
    alias?: string;
    q?: string;
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

  const folder: InboxFolder = isInboxFolder(search.folder) ? search.folder : "needs_reply";
  const assignedStaffId =
    search.staff === "mine"
      ? currentStaff.id
      : search.staff === currentStaff.id
        ? currentStaff.id
        : undefined;
  const mineOnly = assignedStaffId === currentStaff.id;

  const [detail, threads, counts, aliases] = await Promise.all([
    fetchThreadDetail(threadId),
    fetchInboxThreads({
      folder,
      assignedStaffId,
      cityCampaignId: search.campaign,
      outreachBrandId: search.brand,
      aliasId: search.alias,
      search: search.q,
    }),
    fetchFolderCounts(),
    fetchInboxAliases({
      staffMemberId: currentStaff.id,
      isAdmin: currentStaff.role === "admin",
    }),
  ]);

  if (!detail) notFound();

  const outreachHistory = await fetchVenueOutreachHistory(detail.thread.venueId);

  const preservedQuery = new URLSearchParams();
  preservedQuery.set("folder", folder);
  if (mineOnly) preservedQuery.set("staff", currentStaff.id);
  if (search.campaign) preservedQuery.set("campaign", search.campaign);
  if (search.brand) preservedQuery.set("brand", search.brand);
  if (search.alias) preservedQuery.set("alias", search.alias);
  if (search.q) preservedQuery.set("q", search.q);

  return (
    <InboxShell
      left={
        <div className="flex h-full flex-col">
          <FolderList
            activeFolder={folder}
            counts={counts}
            mineOnly={mineOnly}
            currentStaffId={currentStaff.id}
          />
          <InboxPresenceBar currentStaffId={currentStaff.id} />
        </div>
      }
      middle={
        <div className="flex h-full flex-col">
          <InboxFilterBar
            aliases={aliases}
            currentStaffId={currentStaff.id}
            mineOnly={mineOnly}
            activeAliasId={search.alias}
            initialSearch={search.q}
          />
          <div className="flex-1 overflow-y-auto">
            <ThreadList
              threads={threads}
              activeThreadId={threadId}
              folderLabel={FOLDER_LABELS[folder]}
              preservedQuery={preservedQuery.toString()}
            />
          </div>
        </div>
      }
      right={<ThreadPane detail={detail} outreachHistory={outreachHistory} />}
    />
  );
}
