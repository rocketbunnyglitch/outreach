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
import { campaignConnectedAccounts, outreachBrands, staffOutreachEmails, users } from "@/db/schema";
import { db } from "@/lib/db";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

export interface CampaignInboxRow {
  id: string;
  emailAddress: string;
  status: "connected" | "needs_reauth" | "disconnected";
  ownerUserId: string | null;
  ownerDisplayName: string | null;
  /** True when this inbox is assigned to the active campaign via
   *  campaign_connected_accounts. */
  assignedToCampaign: boolean;
  /** Outreach brand this inbox presents for the active campaign, driving the
   *  {{company_name}} merge field. NULL = falls back to the template's brand. */
  outreachBrandId: string | null;
  outreachBrandName: string | null;
  /** Sender persona for this email + campaign (drives {{your_name}} + the From
   *  display name). NULL = falls back to the sending user's display name. */
  aliasName: string | null;
}

export interface TeamMemberOption {
  id: string;
  displayName: string;
  role: string;
}

export interface BrandOption {
  id: string;
  displayName: string;
}

export interface CampaignInfoData {
  inboxes: CampaignInboxRow[];
  teamMembers: TeamMemberOption[];
  /** Outreach brands available to assign per inbox. */
  brands: BrandOption[];
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

  // Which inboxes are assigned to this campaign, and the brand each presents.
  const assignmentRows = inboxRows.length
    ? await db
        .select({
          connectedAccountId: campaignConnectedAccounts.connectedAccountId,
          outreachBrandId: campaignConnectedAccounts.outreachBrandId,
          aliasName: campaignConnectedAccounts.aliasName,
        })
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
  const brandByAccount = new Map<string, string | null>();
  const aliasByAccount = new Map<string, string | null>();
  for (const a of assignmentRows) {
    brandByAccount.set(a.connectedAccountId, a.outreachBrandId);
    aliasByAccount.set(a.connectedAccountId, a.aliasName);
  }

  // Outreach brand catalogue for the per-inbox dropdown.
  const brands = await db
    .select({ id: outreachBrands.id, displayName: outreachBrands.displayName })
    .from(outreachBrands)
    .where(isNull(outreachBrands.archivedAt))
    .orderBy(asc(outreachBrands.displayName));
  const brandName = new Map(brands.map((b) => [b.id, b.displayName]));

  const inboxes: CampaignInboxRow[] = inboxRows.map((r) => {
    const brandId = brandByAccount.get(r.id) ?? null;
    return {
      id: r.id,
      emailAddress: r.emailAddress,
      status: r.status as CampaignInboxRow["status"],
      ownerUserId: r.ownerUserId,
      ownerDisplayName: r.ownerUserId ? (ownerMap.get(r.ownerUserId) ?? null) : null,
      assignedToCampaign: assigned.has(r.id),
      outreachBrandId: brandId,
      outreachBrandName: brandId ? (brandName.get(brandId) ?? null) : null,
      aliasName: aliasByAccount.get(r.id) ?? null,
    };
  });

  // Team members for the owner-dropdown.
  const teamMembers = await db
    .select({ id: users.id, displayName: users.displayName, role: users.role })
    .from(users)
    .where(and(eq(users.teamId, opts.teamId), eq(users.status, "active")))
    .orderBy(asc(users.displayName));

  return { inboxes, teamMembers, brands };
}
