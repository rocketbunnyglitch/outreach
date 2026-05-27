import { requireStaff } from "@/lib/auth";
import {
  FOLDER_LABELS,
  type InboxFolder,
  fetchFolderCounts,
  fetchInboxAliases,
  fetchInboxThreads,
  isInboxFolder,
} from "@/lib/inbox-data";
import { Inbox as InboxIcon } from "lucide-react";
import { FolderList } from "./_components/FolderList";
import { InboxFilterBar } from "./_components/InboxFilterBar";
import { InboxPresenceBar } from "./_components/InboxPresenceBar";
import { InboxShell } from "./_components/InboxShell";
import { ThreadList } from "./_components/ThreadList";

export const metadata = { title: "Inbox · Crawl Engine" };
export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{
    folder?: string;
    staff?: string;
    campaign?: string;
    brand?: string;
    /** staff_outreach_emails.id — narrow the list to one Gmail alias. */
    alias?: string;
    /** Free-text search across subject, snippet, venue name, sender. */
    q?: string;
  }>;
}

/**
 * /inbox — three-pane layout with no thread selected.
 *
 * URL params:
 *   folder    = needs_reply | waiting | follow_up | closed | all
 *   staff     = <staff_id> | "mine" | undefined  (filter to assigned-to-staff)
 *   campaign  = <city_campaign_id>               (chip filter)
 *   brand     = <outreach_brand_id>              (chip filter)
 *   alias     = <staff_outreach_email_id>        (#027 — Bryle has 3)
 *   q         = <search text>                    (subject/snippet/venue/sender)
 *
 * Default folder is needs_reply — what the operator landing here cares
 * about first.
 */
export default async function InboxPage({ searchParams }: Props) {
  const params = await searchParams;
  const { staff: currentStaff } = await requireStaff();

  const folder: InboxFolder = isInboxFolder(params.folder) ? params.folder : "needs_reply";

  // "mine" → current staff id; explicit id → that id; otherwise no filter
  const assignedStaffId =
    params.staff === "mine"
      ? currentStaff.id
      : params.staff === currentStaff.id
        ? currentStaff.id
        : undefined;
  const mineOnly = assignedStaffId === currentStaff.id;

  const [threads, counts, aliases] = await Promise.all([
    fetchInboxThreads({
      folder,
      assignedStaffId,
      cityCampaignId: params.campaign,
      outreachBrandId: params.brand,
      aliasId: params.alias,
      search: params.q,
    }),
    fetchFolderCounts(),
    fetchInboxAliases({
      staffMemberId: currentStaff.id,
      isAdmin: currentStaff.role === "admin",
    }),
  ]);

  const preservedQuery = new URLSearchParams();
  preservedQuery.set("folder", folder);
  if (mineOnly) preservedQuery.set("staff", currentStaff.id);
  if (params.campaign) preservedQuery.set("campaign", params.campaign);
  if (params.brand) preservedQuery.set("brand", params.brand);
  if (params.alias) preservedQuery.set("alias", params.alias);
  if (params.q) preservedQuery.set("q", params.q);

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
            activeAliasId={params.alias}
            initialSearch={params.q}
          />
          <div className="flex-1 overflow-y-auto">
            <ThreadList
              threads={threads}
              activeThreadId={null}
              folderLabel={FOLDER_LABELS[folder]}
              preservedQuery={preservedQuery.toString()}
            />
          </div>
        </div>
      }
      right={<EmptyRightPane />}
    />
  );
}

function EmptyRightPane() {
  return (
    <div className="flex h-full min-h-[24rem] flex-col items-center justify-center p-12 text-center">
      <InboxIcon className="h-10 w-10 text-zinc-300 dark:text-zinc-700" />
      <h2 className="mt-4 font-semibold text-xl tracking-tight">Pick a thread</h2>
      <p className="mt-1 max-w-sm text-sm text-zinc-500">
        Select a conversation on the left to read the full thread, the venue's outreach history, and
        recommended next actions.
      </p>
    </div>
  );
}
