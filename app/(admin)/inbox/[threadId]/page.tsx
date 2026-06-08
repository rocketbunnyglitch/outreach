import { ComposeEmailButton } from "@/app/(admin)/_components/composer/compose-email-button";
import { parseAccountIds } from "@/lib/account-filter";
import { enrichNextActionAsync } from "@/lib/ai-next-action";
import { generateQuickRepliesAsync, isEligibleForQuickReplies } from "@/lib/ai-quick-replies";
import { summarizeThreadAsync } from "@/lib/ai-summarize";
import { hasMinimumRole, requireStaff } from "@/lib/auth";
import { suggestCampaignsForThread } from "@/lib/campaign-matcher";
import { getCurrentCampaign } from "@/lib/current-campaign";
import { loadAppliedGmailLabelsForThread } from "@/lib/gmail-thread-labels";
import {
  FOLDER_LABELS,
  type InboxFolder,
  fetchFolderCounts,
  fetchInboxFilterFacets,
  fetchInboxThreads,
  fetchTeamGmailLabels,
  fetchThreadDetail,
  fetchThreadTasks,
  fetchVenueOutreachHistory,
  isInboxFolder,
} from "@/lib/inbox-data";
import { loadSavedSearches } from "@/lib/inbox-saved-searches";
import { listTeamLabels, listThreadLabels } from "@/lib/team-labels";
import {
  acknowledgeThreadMentions,
  countUnacknowledgedMentions,
  loadThreadNotes,
} from "@/lib/thread-notes";
import { getUserPreferences } from "@/lib/user-preferences";
import { loadVenueCommunication } from "@/lib/venue-communication";
import { loadVisibleAccounts } from "@/lib/visible-accounts";
import { Pencil } from "lucide-react";
import { notFound } from "next/navigation";
import { AccountSwitcher } from "../_components/AccountSwitcher";
import { CampaignScopeBanner } from "../_components/CampaignScopeBanner";
import { FolderList } from "../_components/FolderList";
import { InboxFilterBar } from "../_components/InboxFilterBar";
import { InboxLiveRefresh } from "../_components/InboxLiveRefresh";
import { InboxPresenceBar } from "../_components/InboxPresenceBar";
import { InboxScopeBar } from "../_components/InboxScopeBar";
import { InboxShell } from "../_components/InboxShell";
import { ThreadListWithBulk } from "../_components/ThreadListWithBulk";
import { ThreadPane } from "../_components/ThreadPane";
import { UserPreferencesHydrator } from "../_components/UserPreferencesHydrator";
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
    accounts?: string;
    unassigned?: string;
    stale?: string;
    unmatched?: string;
    mentioned?: string;
    /** "1" -> override the global campaign switcher (see /inbox page). */
    allCampaigns?: string;
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

  // Account-switcher scope from the ?accounts=<id>,<id> URL param.
  const accountIds = parseAccountIds(search.accounts);

  // Global campaign scope — mirrors /inbox page.tsx behavior so
  // operators don't lose scope when clicking into a thread. See
  // app/(admin)/inbox/page.tsx for the full rules; in short:
  //   1. ?campaign=<city_campaign_id> wins
  //   2. ?allCampaigns=1 wins (explicit broad)
  //   3. otherwise, fall back to getCurrentCampaign()
  const allCampaignsExplicit = search.allCampaigns === "1";
  const currentCampaignContext =
    !search.campaign && !allCampaignsExplicit ? await getCurrentCampaign() : null;
  const scopeCampaignId: string | undefined = currentCampaignContext?.campaign.id;

  const [detail, threads, counts, facets, gmailLabels, visibleAccounts, userPrefs] =
    await Promise.all([
      fetchThreadDetail(threadId, currentStaff.teamId),
      fetchInboxThreads({
        folder,
        currentTeamId: currentStaff.teamId,
        currentUserId: currentStaff.id,
        mine,
        assignedStaffId,
        cityCampaignId: search.campaign,
        campaignId: scopeCampaignId,
        outreachBrandId: search.brand,
        labelId: search.label,
        aliasId: search.alias,
        accountIds,
        unassigned: search.unassigned === "1",
        staleOnly: search.stale === "1",
        unmatchedOnly: search.unmatched === "1",
        mentionedOnly: search.mentioned === "1",
        search: search.q,
      }),
      fetchFolderCounts({
        currentTeamId: currentStaff.teamId,
        currentUserId: currentStaff.id,
        mine,
        accountIds,
        campaignId: scopeCampaignId,
      }),
      fetchInboxFilterFacets({
        currentTeamId: currentStaff.teamId,
        currentUserId: currentStaff.id,
        mine,
      }),
      fetchTeamGmailLabels({ currentTeamId: currentStaff.teamId }),
      loadVisibleAccounts({
        currentUserId: currentStaff.id,
        currentTeamId: currentStaff.teamId,
        // VISIBILITY: admin + lead see every team account (matches
        // the inbox LIST page gate -- list and detail must agree on
        // which team accounts are visible for a given role). Staff
        // see only their own.
        canSeeAllTeamAccounts: hasMinimumRole(currentStaff, "lead"),
        // SEND authority is narrower than visibility: admin override
        // only (owned-or-admin). Lead visibility != send.
        isAdmin: hasMinimumRole(currentStaff, "admin"),
      }),
      getUserPreferences(currentStaff.id),
    ]);

  if (!detail) notFound();

  // When the thread isn't matched to a venue yet (poll worker
  // couldn't resolve the sender domain), there's no per-venue
  // outreach history to fetch. Empty list keeps ThreadPane happy.
  const outreachHistory = detail.thread.venueId
    ? await fetchVenueOutreachHistory(detail.thread.venueId)
    : [];

  // Related threads — every OTHER thread tied to this thread's
  // venue, across every connected Gmail account. Gmail breaks
  // threading on subject changes; the engine stitches them back
  // together so operators see the full relationship history in
  // the CRM rail. Skipped when the thread isn't venue-matched yet
  // (the rail's empty-state covers that case). Try/catch so a
  // venue-side issue degrades to "no related threads" instead of
  // 500-ing the whole thread page (CLAUDE.md §12.3).
  const relatedCommunication = detail.thread.venueId
    ? await loadVenueCommunication(detail.thread.venueId, currentStaff.teamId).catch(() => null)
    : null;

  // Open tasks on this thread — both manual and AI-extracted
  // (Phase A.2). Surfaces in the CRM rail so operators see at a
  // glance what they've committed to do. Try/catch wrapped so a
  // tasks-table issue degrades gracefully.
  const threadTasks = await fetchThreadTasks(threadId).catch(() => []);

  // Internal team notes + mentions (Phase D). Notes show in the
  // CRM rail above tasks. Auto-ack any unread @-mentions for the
  // viewing operator — opening the thread counts as "I saw it."
  // Both lookups + the ack are independent of each other; failures
  // degrade gracefully.
  const threadNotes = await loadThreadNotes(threadId).catch(() => []);
  await acknowledgeThreadMentions({ threadId }).catch(() => {
    // best-effort; the next page-load will retry
  });

  // Lazy AI thread summary (Phase A.3). On every page-load,
  // fire a background refresh if the thread is long enough AND
  // the cached summary is stale (or missing). The page itself
  // shows whatever summary is currently persisted on the row —
  // the next visit picks up the fresh one. This way the first
  // viewer doesn't pay the model latency.
  if (
    detail.thread.messageCount >= 10 &&
    detail.thread.aiSummaryMessageCount !== detail.thread.messageCount &&
    process.env.AI_INBOX_SUMMARIZE_ENABLED !== "0"
  ) {
    void summarizeThreadAsync({ threadId });
  }

  // Lazy AI next-action enrichment (Phase A.4). Fires when:
  //   - thread is in an enrichable classification
  //     (interested / warm / confirmed / question / callback_requested)
  //   - the cached enrichment is stale (different message_count or
  //     classification changed since the last generation)
  // The cache + classification check live inside enrichNextAction,
  // so we just kick it off here and trust the function to no-op
  // when it's already current.
  if (process.env.AI_INBOX_NEXT_ACTION_ENABLED !== "0") {
    void enrichNextActionAsync({ threadId });
  }

  // Lazy AI smart-reply chips (Tier S #1 of the Haiku ROI sprint).
  // Generate ONCE per (thread, message_count) and cache on the row.
  // The eligibility check inside isEligibleForQuickReplies handles:
  //   - classification (skip decline/unsubscribe/spam/auto_reply)
  //   - existing cache freshness (skip when up-to-date chips exist)
  //   - AI configured + AI_QUICK_REPLIES_ENABLED env flag
  // The generator itself also re-checks the last-message direction
  // (skip when outbound — operator just sent into this thread), so
  // we don't need to compute that here.
  // Fire-and-forget — page renders cached chips (if any) right now;
  // a fresh batch shows on the next visit if the model produces them.
  if (
    isEligibleForQuickReplies({
      messageCount: detail.thread.messageCount,
      classification: detail.thread.classification,
      aiClassification: detail.thread.aiClassification ?? null,
      aiQuickRepliesMessageCount: detail.thread.aiQuickRepliesMessageCount ?? null,
    })
  ) {
    void generateQuickRepliesAsync({
      threadId,
      messageCountAtGeneration: detail.thread.messageCount,
    });
  }

  // Labels applied to THIS thread + the full team-label catalogue so
  // the inline picker can render checked/unchecked state without an
  // extra round trip. Both queries are small (single-team scope).
  // Smart-detection runs in parallel: rule-based scorer that surfaces
  // the most plausible active city_campaign for the thread. Returns
  // empty list when the thread is already attributed or nothing
  // crosses the confidence threshold.
  const [
    threadLabels,
    teamLabelsAll,
    campaignSuggestions,
    appliedGmailLabels,
    savedSearches,
    mentionCount,
  ] = await Promise.all([
    listThreadLabels(threadId),
    listTeamLabels(currentStaff.teamId),
    suggestCampaignsForThread({
      threadId,
      currentCityCampaignId: detail.thread.cityCampaignId,
      venueId: detail.thread.venueId,
      subject: detail.thread.subject,
      teamId: currentStaff.teamId,
    }),
    loadAppliedGmailLabelsForThread(threadId),
    loadSavedSearches(currentStaff.id),
    countUnacknowledgedMentions(currentStaff.id),
  ]);

  const preservedQuery = new URLSearchParams();
  preservedQuery.set("folder", folder);
  if (mine) preservedQuery.set("mine", "1");
  if (mineAssigned) preservedQuery.set("staff", currentStaff.id);
  if (search.campaign) preservedQuery.set("campaign", search.campaign);
  if (search.brand) preservedQuery.set("brand", search.brand);
  if (search.label) preservedQuery.set("label", search.label);
  if (search.alias) preservedQuery.set("alias", search.alias);
  if (search.accounts) preservedQuery.set("accounts", search.accounts);
  if (search.unassigned === "1") preservedQuery.set("unassigned", "1");
  if (search.stale === "1") preservedQuery.set("stale", "1");
  if (search.unmatched === "1") preservedQuery.set("unmatched", "1");
  // Preserve the explicit "show all campaigns" override across
  // intra-inbox navigation. Without this, clicking from a thread
  // back to a list view would silently revert to the
  // global-switcher default scope, surprising the operator.
  if (search.allCampaigns === "1") preservedQuery.set("allCampaigns", "1");
  if (search.q) preservedQuery.set("q", search.q);

  return (
    <>
      <UserPreferencesHydrator userId={currentStaff.id} />
      <InboxShell
        hasThreadSelected={true}
        view={userPrefs?.inboxView ?? "outlook"}
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
              gmailLabels={gmailLabels}
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
            <div className="flex items-center gap-2">
              {/* Always-visible Compose (the rail's is hidden below lg / when
                  collapsed). */}
              <ComposeEmailButton
                ariaLabel="New email"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-indigo-600 px-3 py-1.5 font-medium text-white text-xs shadow-sm transition-colors hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-400"
              >
                <Pencil className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Compose</span>
              </ComposeEmailButton>
              <div className="min-w-0 flex-1">
                <InboxScopeBar mentionCount={mentionCount} />
              </div>
              {/* Live-refresh indicator + subscriber (Phase E). */}
              <div className="shrink-0 px-3">
                <InboxLiveRefresh currentStaffId={currentStaff.id} />
              </div>
            </div>
            <InboxFilterBar
              initialSearch={search.q}
              savedSearches={savedSearches}
              inboxPicker={
                allCampaignsExplicit ? <AccountSwitcher accounts={visibleAccounts} /> : null
              }
            />
            {currentCampaignContext && (
              <CampaignScopeBanner
                campaignName={currentCampaignContext.campaign.name}
                showAllHref={(() => {
                  const p = new URLSearchParams(preservedQuery.toString());
                  p.set("allCampaigns", "1");
                  return `/inbox?${p.toString()}`;
                })()}
              />
            )}
            <div className="flex-1 overflow-y-auto">
              <ThreadListWithBulk
                threads={threads}
                activeThreadId={threadId}
                folderLabel={FOLDER_LABELS[folder]}
                preservedQuery={preservedQuery.toString()}
                isTrashView={folder === "trash"}
                isArchiveView={folder === "archive"}
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
            relatedCommunication={relatedCommunication}
            threadTasks={threadTasks}
            threadNotes={threadNotes}
            threadLabels={threadLabels}
            allTeamLabels={teamLabelsAll}
            appliedGmailLabels={appliedGmailLabels}
            campaignSuggestions={campaignSuggestions}
            isAdmin={hasMinimumRole(currentStaff, "admin")}
            currentStaffId={currentStaff.id}
          />
        }
      />
    </>
  );
}
