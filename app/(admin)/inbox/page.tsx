import { parseAccountIds } from "@/lib/account-filter";
import { hasMinimumRole, requireStaff } from "@/lib/auth";
import { getCurrentCampaign } from "@/lib/current-campaign";
import {
  FOLDER_LABELS,
  type InboxFolder,
  fetchDraftList,
  fetchFolderCounts,
  fetchInboxAliases,
  fetchInboxFilterFacets,
  fetchInboxThreads,
  fetchTeamGmailLabels,
  isInboxFolder,
} from "@/lib/inbox-data";
import { loadSavedSearches } from "@/lib/inbox-saved-searches";
import { countUnacknowledgedMentions } from "@/lib/thread-notes";
import { getUserPreferences } from "@/lib/user-preferences";
import { loadVisibleAccounts } from "@/lib/visible-accounts";
import { Inbox as InboxIcon } from "lucide-react";
import { AccountSwitcher } from "./_components/AccountSwitcher";
import { CampaignScopeBanner } from "./_components/CampaignScopeBanner";
import { DraftList } from "./_components/DraftList";
import { FolderList } from "./_components/FolderList";
import { InboxFilterBar } from "./_components/InboxFilterBar";
import { InboxLiveRefresh } from "./_components/InboxLiveRefresh";
import { InboxPresenceBar } from "./_components/InboxPresenceBar";
import { InboxScopeBar } from "./_components/InboxScopeBar";
import { InboxShell } from "./_components/InboxShell";
import { ThreadListWithBulk } from "./_components/ThreadListWithBulk";
import { UserPreferencesHydrator } from "./_components/UserPreferencesHydrator";
import { InboxKeyboardNav } from "./_components/inbox-keyboard-nav";

export const metadata = { title: "Inbox" };
export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{
    folder?: string;
    staff?: string;
    campaign?: string;
    brand?: string;
    /** team_labels.id — narrow the list to threads tagged with this label. */
    label?: string;
    /** connected_accounts.id — narrow the list to one Gmail alias. */
    alias?: string;
    /** Free-text search across subject, snippet, venue name, sender. */
    q?: string;
    /**
     * "1" -> show only threads flowing through the current user's
     * own connected_accounts rows. Default (absent) = show all
     * team inboxes so anyone can pick up a thread.
     */
    mine?: string;
    /**
     * Comma-separated list of connected_accounts.id — visibility
     * scope from the Gmail-style AccountSwitcher dropdown. Each id
     * validated as a UUID; non-UUIDs are dropped silently.
     */
    accounts?: string;
    /** "1" -> Unassigned scope preset from InboxScopeBar. */
    unassigned?: string;
    /** "1" -> Stale scope preset from InboxScopeBar. */
    stale?: string;
    /** "1" -> Unmatched scope preset (no venue linked yet). */
    unmatched?: string;
    /** "1" -> Mentioned scope preset (Phase D) — threads where
     *  the current user has unacknowledged @-mentions. */
    mentioned?: string;
    /**
     * "1" -> override the global campaign switcher and show
     * threads from EVERY campaign on the team. The default
     * behavior — when this is absent + no `?campaign=` is set —
     * scopes the inbox to whichever campaign the operator has
     * selected in the top-nav switcher, matching the rest of
     * the app. Operators who want the legacy "show everything"
     * behavior set `?allCampaigns=1`.
     */
    allCampaigns?: string;
  }>;
}

/**
 * /inbox — three-pane layout with no thread selected.
 *
 * URL params:
 *   folder    = needs_reply | waiting | follow_up | closed | all
 *   staff     = <user_id> | "mine" | undefined  (filter by ASSIGNED-to)
 *   mine      = "1"                              (filter by INBOX OWNER —
 *               restricts to connected accounts owned by current user)
 *   campaign  = <city_campaign_id>               (chip filter)
 *   brand     = <outreach_brand_id>              (chip filter)
 *   alias     = <connected_account_id>           (specific Gmail account)
 *   q         = <search text>                    (subject/snippet/venue/sender)
 *
 * The default scope is "every connected account on my team" so
 * operators see the shared inbox. Toggle `?mine=1` to narrow to
 * only their own inboxes.
 *
 * Default folder is needs_reply.
 */
export default async function InboxPage({ searchParams }: Props) {
  const params = await searchParams;
  const { staff: currentStaff } = await requireStaff();

  const folder: InboxFolder = isInboxFolder(params.folder) ? params.folder : "inbox";

  // "?mine=1" — show only threads flowing through MY OWN connected
  // accounts (the new inbox owner toggle). Distinct from the
  // existing "staff=mine" filter, which filters by the
  // thread.assignedStaffId (who's working it). Both can be set.
  const mine = params.mine === "1";

  // "mine" → current user id; explicit id → that id; otherwise no filter.
  // This filters by who the thread is ASSIGNED to.
  const assignedStaffId =
    params.staff === "mine"
      ? currentStaff.id
      : params.staff === currentStaff.id
        ? currentStaff.id
        : undefined;
  const mineAssigned = assignedStaffId === currentStaff.id;

  const isDraftFolder = folder === "drafts" || folder === "scheduled";

  // Parse the ?accounts=<id>,<id> visibility scope from the
  // AccountSwitcher dropdown. Validate each id as a UUID to keep
  // SQL safe + drop garbage silently. Empty list => no filter
  // (default = every account the operator can see).
  const accountIds = parseAccountIds(params.accounts);

  // -------- Global campaign scope --------
  //
  // The top-nav campaign switcher sets a cookie that
  // getCurrentCampaign() reads. Every other major surface
  // (/dashboard, /all-crawls, /campaign-info, /support-hours)
  // honors it by default — the inbox used to be the lone
  // exception, which made it feel like a different app.
  //
  // Rules (matching the spec's "Inbox defaults to selected
  // campaign; All Campaigns must be explicit"):
  //
  //   1. URL ?campaign=<city_campaign_id> wins.
  //      That URL param exists for the campaign chip click in the
  //      left-rail filter chips, which sets a narrow city_campaign
  //      filter (not a broader campaign-wide filter). When set, we
  //      use it directly and skip the global-switcher default —
  //      the operator explicitly narrowed; respect that.
  //
  //   2. URL ?allCampaigns=1 wins (explicit "show me everything").
  //      Reserved escape hatch so an operator can opt out of the
  //      switcher's default scope without clearing the cookie.
  //
  //   3. Otherwise, fall back to getCurrentCampaign(). If the
  //      operator has a campaign selected globally, scope by it.
  //      If no campaign is selected (fresh login, new operator),
  //      the inbox shows everything — same as before this change.
  //
  // The narrow `?campaign=` (cityCampaignId) and the broad
  // `campaignId` (from the switcher) are both threaded through
  // fetchInboxThreads + fetchFolderCounts. The data layer skips
  // the broad filter when the narrow one is also set (see
  // lib/inbox-data.ts).
  const allCampaignsExplicit = params.allCampaigns === "1";
  // Hoist the full campaign context so we can use it for BOTH the
  // scope filter AND the visible banner below. When the operator
  // narrowed via ?campaign= or opted out via ?allCampaigns=1, we
  // don't call getCurrentCampaign() at all — neither feature applies.
  const currentCampaignContext =
    !params.campaign && !allCampaignsExplicit ? await getCurrentCampaign() : null;
  const scopeCampaignId: string | undefined = currentCampaignContext?.campaign.id;

  const [
    threads,
    counts,
    aliases,
    facets,
    gmailLabels,
    drafts,
    visibleAccounts,
    userPrefs,
    savedSearches,
    mentionCount,
  ] = await Promise.all([
    fetchInboxThreads({
      folder,
      currentTeamId: currentStaff.teamId,
      currentUserId: currentStaff.id,
      mine,
      assignedStaffId,
      cityCampaignId: params.campaign,
      campaignId: scopeCampaignId,
      outreachBrandId: params.brand,
      labelId: params.label,
      aliasId: params.alias,
      accountIds,
      unassigned: params.unassigned === "1",
      staleOnly: params.stale === "1",
      unmatchedOnly: params.unmatched === "1",
      mentionedOnly: params.mentioned === "1",
      search: params.q,
    }),
    fetchFolderCounts({
      currentTeamId: currentStaff.teamId,
      currentUserId: currentStaff.id,
      mine,
      accountIds,
      campaignId: scopeCampaignId,
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
    fetchTeamGmailLabels({ currentTeamId: currentStaff.teamId }),
    isDraftFolder
      ? fetchDraftList({
          currentUserId: currentStaff.id,
          currentTeamId: currentStaff.teamId,
          mode: folder === "scheduled" ? "scheduled" : "drafts",
        })
      : Promise.resolve([]),
    loadVisibleAccounts({
      currentUserId: currentStaff.id,
      currentTeamId: currentStaff.teamId,
      // Admin / lead see every team account. Staff see only their
      // own. Future: a finer-grained "team accounts I have access
      // to" model will go here.
      canSeeAllTeamAccounts: hasMinimumRole(currentStaff, "admin"),
    }),
    getUserPreferences(currentStaff.id),
    loadSavedSearches(currentStaff.id),
    countUnacknowledgedMentions(currentStaff.id),
  ]);

  // AccountSwitcher seed selection: prefer the per-campaign
  // server-side entry when present. The "_default" key is used when
  // viewing the no-campaign / all-campaigns mode. Null = let the
  // component fall back through URL > localStorage > all-selected.
  const accountFilterCampaignKey = params.campaign ?? "_default";
  const initialAccountSelection = userPrefs?.inboxAccountFilters[accountFilterCampaignKey] ?? null;

  const preservedQuery = new URLSearchParams();
  preservedQuery.set("folder", folder);
  if (mine) preservedQuery.set("mine", "1");
  if (mineAssigned) preservedQuery.set("staff", currentStaff.id);
  if (params.campaign) preservedQuery.set("campaign", params.campaign);
  if (params.brand) preservedQuery.set("brand", params.brand);
  if (params.label) preservedQuery.set("label", params.label);
  if (params.alias) preservedQuery.set("alias", params.alias);
  if (params.accounts) preservedQuery.set("accounts", params.accounts);
  if (params.unassigned === "1") preservedQuery.set("unassigned", "1");
  if (params.stale === "1") preservedQuery.set("stale", "1");
  if (params.unmatched === "1") preservedQuery.set("unmatched", "1");
  if (params.allCampaigns === "1") preservedQuery.set("allCampaigns", "1");
  if (params.q) preservedQuery.set("q", params.q);

  return (
    <>
      <UserPreferencesHydrator userId={currentStaff.id} />
      <InboxShell
        hasThreadSelected={false}
        topRight={
          <AccountSwitcher
            accounts={visibleAccounts}
            currentUserInitial={(currentStaff.displayName ?? currentStaff.primaryEmail ?? "?")
              .trim()
              .charAt(0)}
            currentCampaignId={params.campaign ?? null}
            initialSelection={initialAccountSelection}
          />
        }
        left={
          <div className="flex h-full flex-col">
            <FolderList
              activeFolder={folder}
              counts={counts}
              mineOnly={mineAssigned}
              currentStaffId={currentStaff.id}
              facets={facets}
              activeBrandId={params.brand}
              activeCampaignId={params.campaign}
              activeLabelId={params.label}
              gmailLabels={gmailLabels}
              preservedQueryBase={(() => {
                // Strip folder/brand/campaign/label since FolderList sets
                // them per-chip. Preserve mine, staff, alias, q.
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
              <div className="flex-1">
                <InboxScopeBar
                  currentUserId={currentStaff.id}
                  isAdmin={hasMinimumRole(currentStaff, "admin")}
                  mentionCount={mentionCount}
                />
              </div>
              {/* Live-refresh indicator + subscriber (Phase E). */}
              <div className="shrink-0 px-3">
                <InboxLiveRefresh currentStaffId={currentStaff.id} />
              </div>
            </div>
            <InboxFilterBar
              aliases={aliases}
              currentStaffId={currentStaff.id}
              mineAssigned={mineAssigned}
              mineInbox={mine}
              unassignedOnly={params.unassigned === "1"}
              unassignedCount={counts.unassigned}
              assignedToMeCount={counts.assignedToMe}
              unreadThreadIds={threads.filter((t) => t.unreadCount > 0).map((t) => t.id)}
              activeAliasId={params.alias}
              initialSearch={params.q}
              savedSearches={savedSearches}
            />
            {/* Surface the active campaign scope above the list. Only
                renders when the inbox is implicitly scoped by the
                global switcher — explicit URL filters and the
                allCampaigns override skip the banner. */}
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
              {isDraftFolder ? (
                <DraftList
                  drafts={drafts}
                  mode={folder === "scheduled" ? "scheduled" : "drafts"}
                  folderLabel={FOLDER_LABELS[folder]}
                />
              ) : (
                <ThreadListWithBulk
                  threads={threads}
                  activeThreadId={null}
                  folderLabel={FOLDER_LABELS[folder]}
                  preservedQuery={preservedQuery.toString()}
                  isTrashView={folder === "trash"}
                  isArchiveView={folder === "archive"}
                />
              )}
              {/* Mounts at the bottom so it's always rendered but
                contributes no layout. j/k navigation + help. */}
              <InboxKeyboardNav
                threadIds={threads.map((t) => t.id)}
                activeThreadId={null}
                preservedQuery={preservedQuery.toString()}
              />
            </div>
          </div>
        }
        right={<EmptyRightPane />}
      />
    </>
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
