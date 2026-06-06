/**
 * GET /api/engine/lineup?campaign=<slug>[&campaignId=<uuid>][&cityId=<uuid>]
 *
 * Public JSON API (Spec phase 5.7): the confirmed, publish-safe lineup for a
 * campaign, consumed by EXTERNAL systems -- the Smart Map (5.10) and the
 * Eventbrite venue-block push (5.9). Returns one entry per crawl night.
 *
 * SAFETY (CLAUDE.md section 8 rule #6): the DTO is built by lib/lineup-state.ts,
 * which selects ONLY public-safe columns. This route never returns internal
 * notes, do-not-contact reasons, financials, contact info, or outreach history.
 * Scoped to one campaign => one CrawlBrand; no cross-brand history (section 7).
 *
 * AUTH: a static engine API key in the `X-Engine-Api-Key` header, matched
 * against env ENGINE_API_KEY. This mirrors the cron routes' shared-secret
 * pattern (app/api/cron/eventbrite-sync/route.ts reads process.env.CRON_SECRET
 * and compares a header). External pullers (Smart Map, Eventbrite pusher) are
 * machine clients with no Google session, so the staff-cookie auth used by the
 * internal routes (app/api/reference/search/route.ts -> getCurrentStaff) does
 * not apply here. Fails closed: missing/blank ENGINE_API_KEY => 500.
 *
 * Examples:
 *   curl -H "X-Engine-Api-Key: $ENGINE_API_KEY" \
 *     "https://outreach.barcrawlconnect.com/api/engine/lineup?campaign=halloween-2026"
 */

import { getCampaignLineup } from "@/lib/lineup-state";
import { logger } from "@/lib/logger";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorize(req: Request): NextResponse | null {
  const expected = process.env.ENGINE_API_KEY;
  if (!expected || expected.length === 0) {
    // Fail closed: an unconfigured key must not become an open endpoint.
    return NextResponse.json({ error: "ENGINE_API_KEY not configured on server" }, { status: 500 });
  }
  const got = req.headers.get("x-engine-api-key");
  if (got !== expected) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  return null;
}

export async function GET(req: Request): Promise<Response> {
  const denied = authorize(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const campaignSlug = url.searchParams.get("campaign")?.trim() || undefined;
  const campaignId = url.searchParams.get("campaignId")?.trim() || undefined;
  const cityId = url.searchParams.get("cityId")?.trim() || undefined;

  if (!campaignSlug && !campaignId) {
    return NextResponse.json(
      { error: "Provide a 'campaign' slug (or 'campaignId') query param" },
      { status: 400 },
    );
  }

  try {
    const lineups = await getCampaignLineup({ campaignSlug, campaignId, cityId });
    if (lineups.length === 0) {
      // Unknown campaign vs. a real campaign with no confirmed venues are both
      // 404 here: an external puller treats both as "nothing to render yet".
      return NextResponse.json(
        { error: "No confirmed lineup found for that campaign" },
        { status: 404 },
      );
    }
    return NextResponse.json({ campaign: campaignSlug ?? campaignId, events: lineups });
  } catch (err) {
    logger.error({ err, campaignSlug, campaignId, cityId }, "engine lineup API failed");
    return NextResponse.json({ error: "Failed to load lineup" }, { status: 500 });
  }
}
