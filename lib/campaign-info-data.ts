/**
 * Campaign Info page data loader.
 *
 * Fetches:
 *   - all connected_accounts on the user's team (the inbox catalogue)
 *   - which of those are currently assigned to the active campaign
 *   - per-account owner (users row, if set)
 *   - all team members so the assignment dropdowns can render the
 *     full list of candidate owners
 *
 * The page renders the list to everyone on the team; only the
 * assignment actions are admin-gated.
 */

import "server-only";
import { campaignConnectedAccounts, staffOutreachEmails, users } from "@/db/schema";
import { db } from "@/lib/db";
import { and, asc, eq, inArray } from "drizzle-orm";

export interface CampaignInboxRow {
  id: string;
  emailAddress: string;
  status: "connected" | "needs_reauth" | "disconnected";
  ownerUserId: string | null;
  ownerDisplayName: string | null;
  /** True when this inbox is assigned to the active campaign via
   *  campaign_connected_accounts. */
  assignedToCampaign: boolean;
}

export interface TeamMemberOption {
  id: string;
  displayName: string;
  role: string;
}

export interface CampaignInfoData {
  inboxes: CampaignInboxRow[];
  teamMembers: TeamMemberOption[];
}

export async function loadCampaignInfo(opts: {
  teamId: string;
  campaignId: string;
}): Promise<CampaignInfoData> {
  // All inboxes on the team.
  const inboxRows = await db
    .select({
      id: staffOutreachEmails.id,
      emailAddress: staffOutreachEmails.emailAddress,
      status: staffOutreachEmails.status,
      ownerUserId: staffOutreachEmails.ownerUserId,
    })
    .from(staffOutreachEmails)
    .where(eq(staffOutreachEmails.teamId, opts.teamId))
    .orderBy(asc(staffOutreachEmails.emailAddress));

  // Owners — one query for all distinct ownerUserIds.
  const ownerIds = Array.from(
    new Set(inboxRows.map((r) => r.ownerUserId).filter(Boolean) as string[]),
  );
  const ownerRows = ownerIds.length
    ? await db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(inArray(users.id, ownerIds))
    : [];
  const ownerMap = new Map<string, string>();
  for (const o of ownerRows) ownerMap.set(o.id, o.displayName);

  // Which inboxes are assigned to this campaign.
  const assignmentRows = inboxRows.length
    ? await db
        .select({ connectedAccountId: campaignConnectedAccounts.connectedAccountId })
        .from(campaignConnectedAccounts)
        .where(
          and(
            eq(campaignConnectedAccounts.campaignId, opts.campaignId),
            inArray(
              campaignConnectedAccounts.connectedAccountId,
              inboxRows.map((r) => r.id),
            ),
          ),
        )
    : [];
  const assigned = new Set(assignmentRows.map((r) => r.connectedAccountId));

  const inboxes: CampaignInboxRow[] = inboxRows.map((r) => ({
    id: r.id,
    emailAddress: r.emailAddress,
    status: r.status as CampaignInboxRow["status"],
    ownerUserId: r.ownerUserId,
    ownerDisplayName: r.ownerUserId ? (ownerMap.get(r.ownerUserId) ?? null) : null,
    assignedToCampaign: assigned.has(r.id),
  }));

  // Team members for the owner-dropdown.
  const teamMembers = await db
    .select({ id: users.id, displayName: users.displayName, role: users.role })
    .from(users)
    .where(and(eq(users.teamId, opts.teamId), eq(users.status, "active")))
    .orderBy(asc(users.displayName));

  return { inboxes, teamMembers };
}
