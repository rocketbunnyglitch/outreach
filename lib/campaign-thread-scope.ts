import "server-only";

/**
 * Campaign gmail-label scoping for email_threads (operator request
 * 2026-06-10): "selecting a campaign should show all emails with that
 * label regardless of inbox". One shared helper so the inbox, the inbox
 * dashboard widget and every worklist queue scope identically.
 *
 * The label lives on campaigns.outreach_gmail_label (e.g. "halloween 2026")
 * and threads carry it via email_thread_labels -> team_labels.
 */

import { campaigns, emailThreads } from "@/db/schema";
import { getCurrentCampaign } from "@/lib/current-campaign";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { eq, sql } from "drizzle-orm";

/** The campaign's gmail label, or null when unset/unresolvable. */
export async function getCampaignLabel(campaignId: string): Promise<string | null> {
  try {
    const [row] = await db
      .select({ label: campaigns.outreachGmailLabel })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1);
    const label = row?.label?.trim();
    return label && label.length > 0 ? label : null;
  } catch (err) {
    logger.warn({ err, campaignId }, "campaign label lookup failed");
    return null;
  }
}

/** SQL fragment: this email_threads row carries the campaign's label.
 *  undefined when the campaign has no label configured. */
export async function campaignLabelScopeFor(campaignId: string) {
  const label = await getCampaignLabel(campaignId);
  if (!label) return undefined;
  return sql`EXISTS (
    SELECT 1 FROM email_thread_labels tl
    JOIN team_labels l ON l.id = tl.team_label_id
    WHERE tl.thread_id = ${emailThreads.id}
      AND lower(l.name) = lower(${label})
  )`;
}

/** Cookie-resolved variant for request-scoped loaders (worklist, widgets).
 *  Falls back to a campaign-era date cutoff when the campaign has no label,
 *  and to no filter at all if campaign resolution fails (surfaces must
 *  never go empty from a scoping hiccup). */
export async function currentCampaignThreadScope() {
  try {
    const current = await getCurrentCampaign();
    if (!current) return undefined;
    const scope = await campaignLabelScopeFor(current.campaign.id);
    return scope ?? sql`${emailThreads.lastMessageAt} >= '2026-06-01'::timestamptz`;
  } catch (err) {
    logger.warn({ err }, "campaign thread scope skipped");
    return undefined;
  }
}
