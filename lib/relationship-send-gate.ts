import "server-only";

/**
 * Relationship send-gate for the scheduled-send runner. [ReferenceDoc 7.15.2]
 *
 * The runner auto-sends the lifecycle drafts (T13-T17). T17 is the post-event
 * thank-you + NYE re-engagement: it must NEVER go to a venue x outreach-brand
 * pair that has been flagged 'bad' (a hard-no / unsubscribe, or an operator
 * post-event 'bad' flag). Re-pitching a venue that asked us to stop is exactly
 * what the relationship flag exists to prevent.
 *
 * shouldBlockLifecycleSend resolves the draft's template_code, venue_id, and
 * outreach_brand_id, then returns true when:
 *   - the template is relationship-gated (T17, and any future re-engagement
 *     template added to RELATIONSHIP_GATED_TEMPLATE_CODES), AND
 *   - getVenueBrandRelationship(venueId, outreachBrandId).status === 'bad'.
 *
 * Resolving outreach_brand_id -- chosen path + why:
 *   1. PRIMARY: draft.templateId -> email_templates.outreach_brand_id. This is
 *      the most reliable link: email_templates.outreach_brand_id is NOT NULL and
 *      is the brand that actually owns the template being sent (it is the same
 *      column the seed derives from the campaign). The same join also yields the
 *      template_code so the gate and the brand come from one query.
 *   2. FALLBACK: draft.cityCampaignId -> city_campaigns.campaign_id ->
 *      campaigns.outreach_brand_id. Used only when the draft has no templateId
 *      (freeform draft -- which is never a gated lifecycle template anyway, so in
 *      practice the fallback resolves the brand but the template_code stays null
 *      and the gate is a no-op). Kept for completeness / defense in depth.
 *
 * Fail-open: any resolution gap (no template, no venue, no brand, no template
 * code) returns false so a normal lifecycle send is never wrongly blocked. The
 * only thing this gate does is STOP a gated send to a known-bad pair.
 */

import { type EmailDraft, campaigns, cityCampaigns, emailTemplates } from "@/db/schema";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getVenueBrandRelationship } from "@/lib/venue-relationships";
import { eq } from "drizzle-orm";

/**
 * Template codes that must not be sent to a 'bad' venue x brand pair. T17 is the
 * post-event NYE re-engagement (the spec's named case, 7.15.2). Add other
 * re-engagement / re-pitch codes here if they are introduced.
 */
/** @deprecated 2026-06-11 audit: the relationship block now applies to
 *  EVERY scheduled venue send at dispatch, not just T17. Kept exported
 *  for reference; no longer gates participation. */
export const RELATIONSHIP_GATED_TEMPLATE_CODES: ReadonlySet<string> = new Set(["T17"]);

export async function shouldBlockLifecycleSend(args: {
  draft: Pick<EmailDraft, "templateId" | "venueId" | "cityCampaignId">;
}): Promise<boolean> {
  const { draft } = args;

  // No venue context -> nothing relationship-scoped to gate.
  if (!draft.venueId) return false;

  let templateCode: string | null = null;
  let outreachBrandId: string | null = null;

  // PRIMARY path: template id -> template_code + outreach_brand_id (NOT NULL).
  if (draft.templateId) {
    const [tpl] = await db
      .select({
        templateCode: emailTemplates.templateCode,
        outreachBrandId: emailTemplates.outreachBrandId,
      })
      .from(emailTemplates)
      .where(eq(emailTemplates.id, draft.templateId))
      .limit(1);
    if (tpl) {
      templateCode = tpl.templateCode;
      outreachBrandId = tpl.outreachBrandId;
    }
  }

  // FALLBACK path for the brand: draft city campaign -> campaign brand.
  if (!outreachBrandId && draft.cityCampaignId) {
    const [cc] = await db
      .select({ outreachBrandId: campaigns.outreachBrandId })
      .from(cityCampaigns)
      .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
      .where(eq(cityCampaigns.id, draft.cityCampaignId))
      .limit(1);
    outreachBrandId = cc?.outreachBrandId ?? null;
  }

  // 2026-06-11 audit: the bad-relationship block applies to EVERY
  // scheduled venue send at dispatch — T13/T14/T15/T17/any lifecycle
  // or queued cold send, template or no template. The interactive
  // composer already hard-blocks all of them (IMPLEMENTATION_STATUS
  // 3.10); the cron path previously re-checked only T17, so a venue
  // flagged 'bad' AFTER scheduling could still receive a non-T17
  // auto-send. Without a resolvable brand there is nothing
  // relationship-scoped to check.
  if (!outreachBrandId) return false;

  const rel = await getVenueBrandRelationship(draft.venueId, outreachBrandId);
  const blocked = rel?.status === "bad";
  if (blocked) {
    logger.info(
      { venueId: draft.venueId, outreachBrandId, templateCode: templateCode ?? "(none)" },
      "relationship-send-gate: blocking scheduled venue send to a bad venue x brand pair",
    );
  }
  return blocked;
}
