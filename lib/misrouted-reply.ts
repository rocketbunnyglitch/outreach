import "server-only";

/**
 * Misrouted positive-reply routing (Phase 4.9). [ReferenceDoc 9.5]
 *
 * A venue often replies to whichever alias/inbox is top of their thread, which
 * may not be the alias that originally pitched them (especially after a
 * cross-domain handoff). When an inbound reply lands on a venue-matched thread
 * that nobody owns yet, route it to the ORIGINAL pitcher -- the owner of the
 * inbox that sent the most recent touch to this venue in this campaign -- so it
 * surfaces in their worklist. Only acts when the receiving inbox differs from
 * the original sending inbox. Best-effort: never blocks ingestion.
 */

import { cityCampaigns, connectedAccounts, emailThreads, venueCampaignTouchLog } from "@/db/schema";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { and, desc, eq, isNull } from "drizzle-orm";

export async function routeMisroutedReply(threadId: string): Promise<void> {
  const [t] = await db
    .select({
      venueId: emailThreads.venueId,
      receivingAccountId: emailThreads.staffOutreachEmailId,
      cityCampaignId: emailThreads.cityCampaignId,
      assignedStaffId: emailThreads.assignedStaffId,
    })
    .from(emailThreads)
    .where(eq(emailThreads.id, threadId))
    .limit(1);
  // Only route a venue-matched thread that nobody owns yet.
  if (!t || !t.venueId || t.assignedStaffId) return;

  if (!t.cityCampaignId) return; // can't attribute the campaign -> leave it
  const [cc] = await db
    .select({ campaignId: cityCampaigns.campaignId })
    .from(cityCampaigns)
    .where(eq(cityCampaigns.id, t.cityCampaignId))
    .limit(1);
  if (!cc?.campaignId) return;

  // Most recent outbound to this venue in this campaign.
  const [touch] = await db
    .select({ sendingAccountId: venueCampaignTouchLog.staffOutreachEmailId })
    .from(venueCampaignTouchLog)
    .where(
      and(
        eq(venueCampaignTouchLog.venueId, t.venueId),
        eq(venueCampaignTouchLog.campaignId, cc.campaignId),
      ),
    )
    .orderBy(desc(venueCampaignTouchLog.sentAt))
    .limit(1);
  // Only route when the reply landed on a DIFFERENT inbox than the original pitch.
  if (!touch?.sendingAccountId || touch.sendingAccountId === t.receivingAccountId) return;

  const [orig] = await db
    .select({ ownerUserId: connectedAccounts.ownerUserId })
    .from(connectedAccounts)
    .where(eq(connectedAccounts.id, touch.sendingAccountId))
    .limit(1);
  if (!orig?.ownerUserId) return;

  await db
    .update(emailThreads)
    .set({ assignedStaffId: orig.ownerUserId })
    .where(and(eq(emailThreads.id, threadId), isNull(emailThreads.assignedStaffId)));
  logger.info(
    {
      threadId,
      routedTo: orig.ownerUserId,
      receivingAccountId: t.receivingAccountId,
      originalAccountId: touch.sendingAccountId,
    },
    "misrouted reply routed to original pitcher",
  );
}
