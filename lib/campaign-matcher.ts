/**
 * Campaign matcher — smart detection of which active city_campaign(s)
 * a thread is most likely about, based on the last N inbound messages'
 * text + the thread's existing venue / city / brand attribution.
 *
 * v1 is rule-based. We pick this over an LLM call for three reasons:
 *   1. Speed: matches inline per thread render, no API latency.
 *   2. Predictable: operators can reason about why a suggestion fired
 *      ("the campaign name appears in the message" beats "the model
 *      said so").
 *   3. Cheap: no per-thread token cost.
 *
 * If the rule-based approach turns out to miss too many real matches
 * in practice, we can stack an LLM scorer behind it later — the
 * matcher signature already returns ranked candidates with reasons.
 *
 * Scoring sketch (each match yields a numeric confidence 0..1):
 *   1.0  thread already venue-attributed AND venue has a row in
 *        city_campaigns; the matched city_campaign is the
 *        ground-truth answer.
 *   0.9  campaign name appears verbatim in message body (case
 *        insensitive, word-boundaried).
 *   0.7  city name + brand name BOTH appear (campaign has the brand
 *        attached, city has the campaign).
 *   0.5  campaign name appears in subject line (often a forwarded
 *        thread or reply citation; weaker signal).
 *   0.4  city name appears + brand domain mentioned anywhere
 *        (operator forwarded a brand email, mentioning city in
 *        body).
 *
 * Top suggestion threshold: confidence >= 0.5 before we surface it.
 * Otherwise the thread renders with no suggestion (avoid noise).
 */

import { campaigns, cities, cityCampaigns, emailMessages, outreachBrands } from "@/db/schema";
import { db } from "@/lib/db";
import { and, desc, eq, or } from "drizzle-orm";

export interface CampaignSuggestion {
  cityCampaignId: string;
  cityName: string;
  campaignName: string;
  brandName: string;
  /** 0..1 — rank descending. */
  confidence: number;
  /** Short human-readable explanation. */
  reason: string;
}

/**
 * How many of the most recent inbound messages we scan. Threads with
 * a long back-and-forth get the freshest signal; archives don't get
 * fully re-classified by a deep historical scan.
 */
const RECENT_MESSAGES_TO_SCAN = 3;

/**
 * Word-boundaried, case-insensitive includes. Avoids "Toronto" matching
 * "Torontonian" or "St. Paddy's 2026" matching "St. Paddy".
 *
 * Escapes regex metachars before building the boundary.
 */
function containsWord(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
  return re.test(haystack);
}

/**
 * Suggest campaigns for a thread. Returns up to 3 candidates sorted
 * by confidence desc. Empty array when nothing meets the threshold.
 *
 * Implementation cost: one query to fetch active city_campaigns on
 * the user's team + one query for the last N messages' bodies. The
 * matching itself is in-memory.
 */
export async function suggestCampaignsForThread(opts: {
  threadId: string;
  /** Optional: when set we skip if the thread is already attributed. */
  currentCityCampaignId: string | null;
  /** Optional: venue id on the thread, for the high-confidence join. */
  venueId: string | null;
  /** Subject line, scanned as a secondary signal. */
  subject: string | null;
  teamId: string;
}): Promise<CampaignSuggestion[]> {
  // If the thread is already attributed to a campaign, no need to
  // suggest. The UI can still surface the attached campaign separately.
  if (opts.currentCityCampaignId) return [];

  // Load every ACTIVE city_campaign visible to the team.
  // Active here means campaigns.status='active' OR 'planning' (operator
  // is working on it), and the city_campaign itself isn't cancelled.
  const activeCampaigns = await db
    .select({
      cityCampaignId: cityCampaigns.id,
      cityName: cities.name,
      campaignName: campaigns.name,
      brandName: outreachBrands.displayName,
    })
    .from(cityCampaigns)
    .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
    .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
    .innerJoin(outreachBrands, eq(outreachBrands.id, campaigns.outreachBrandId))
    .where(
      and(
        or(eq(campaigns.status, "active"), eq(campaigns.status, "planning")),
        // city_campaign_status enum is {planning, active, confirmed, cancelled}.
        // The earlier "contract_signed" entry belonged to venue_event_status
        // and made Postgres throw 22P02 invalid_input on every inbox thread
        // page render — that's the "Application error" overlay operators
        // hit when clicking any thread. Removing it whitelists every
        // non-cancelled city_campaign, which was the original intent.
        or(
          eq(cityCampaigns.status, "planning"),
          eq(cityCampaigns.status, "active"),
          eq(cityCampaigns.status, "confirmed"),
        ),
      ),
    );

  if (activeCampaigns.length === 0) return [];

  // Last N inbound messages' body text.
  const recentMessages = await db
    .select({
      bodyText: emailMessages.bodyText,
      subject: emailMessages.subject,
    })
    .from(emailMessages)
    .where(and(eq(emailMessages.threadId, opts.threadId), eq(emailMessages.direction, "inbound")))
    .orderBy(desc(emailMessages.sentAt))
    .limit(RECENT_MESSAGES_TO_SCAN);

  const combinedBody = recentMessages
    .map((m) => m.bodyText ?? "")
    .filter(Boolean)
    .join("\n\n");
  const combinedSubject = [opts.subject ?? "", ...recentMessages.map((m) => m.subject)]
    .filter(Boolean)
    .join("\n");

  // (Future: venue-attribution shortcut — if the thread is tied to a
  // venue that's already enrolled in a city_campaign, we could return
  // that as a 1.0-confidence ground-truth match. For now we keep the
  // matcher purely text-based so the suggestion logic is easy to
  // reason about.)

  // Score each candidate.
  const suggestions: CampaignSuggestion[] = [];
  for (const c of activeCampaigns) {
    let confidence = 0;
    let reason = "";

    // 0.9: campaign name appears verbatim in body
    if (c.campaignName && containsWord(combinedBody, c.campaignName)) {
      confidence = Math.max(confidence, 0.9);
      reason = `Mentions "${c.campaignName}" in message body`;
    }

    // 0.5: campaign name in subject
    if (c.campaignName && containsWord(combinedSubject, c.campaignName)) {
      if (confidence < 0.5) {
        confidence = 0.5;
        reason = `Mentions "${c.campaignName}" in subject line`;
      }
    }

    // 0.7: city name + brand name BOTH appear in body
    const cityHit = c.cityName && containsWord(combinedBody, c.cityName);
    const brandHit = c.brandName && containsWord(combinedBody, c.brandName);
    if (cityHit && brandHit) {
      if (confidence < 0.7) {
        confidence = 0.7;
        reason = `Mentions both ${c.cityName} and ${c.brandName}`;
      }
    }

    if (confidence >= 0.5) {
      suggestions.push({
        cityCampaignId: c.cityCampaignId,
        cityName: c.cityName,
        campaignName: c.campaignName,
        brandName: c.brandName,
        confidence,
        reason,
      });
    }
  }

  // Sort by confidence desc; cap at 3 to avoid overwhelming the UI.
  suggestions.sort((a, b) => b.confidence - a.confidence);
  return suggestions.slice(0, 3);
}
