"use server";

/**
 * AI-assisted outreach actions.
 *
 * draftOutreachEmail — given a cold-outreach row, gather everything
 * needed for personalization (venue facts, campaign + brand, prior
 * touches, upcoming crawl date) and ask Claude for a draft. Returns
 * { subject, body } the UI pre-fills into the existing email
 * composer.
 *
 * No DB writes — pure read + LLM call + return. The operator
 * decides whether to send.
 */

import { suggestSubjectLines } from "@/lib/ai-subject-suggest";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { sql } from "drizzle-orm";
import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

const schema = z.object({
  venueId: uuid,
  cityCampaignId: uuid,
  /** Optional — when present, narrows the draft to a specific slot. */
  intendedRole: z
    .enum(["wristband", "middle", "final", "alt_final", "unspecified"])
    .default("unspecified"),
  /**
   * Quality tier for the draft (Haiku ROI sprint #4):
   *   "fast"   = Haiku (default) — ~5x cheaper, fine for first-pass.
   *   "polish" = Opus — only when the operator clicks "Polish with
   *              Opus" on a specific draft they want to send clean.
   * The bulk-AI-draft modal omits this so it inherits "fast".
   */
  quality: z.enum(["fast", "polish"]).default("fast"),
});

interface DraftResult {
  subject: string;
  body: string;
}

export async function draftOutreachEmail(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<DraftResult | { notConfigured: true }>> {
  const { staff } = await requireStaff();
  const parsed = schema.safeParse({
    venueId: formData.get("venueId"),
    cityCampaignId: formData.get("cityCampaignId"),
    intendedRole: formData.get("intendedRole") ?? "unspecified",
    quality: formData.get("quality") ?? "fast",
  });
  if (!parsed.success) return { ok: false, error: "Invalid draft payload." };

  const { isAiConfigured, draftOutreachEmail: aiDraft } = await import("@/lib/ai");
  if (!isAiConfigured()) {
    return { ok: true, data: { notConfigured: true } };
  }

  // Single query joining everything the draft needs. The outreach_log
  // sub-aggregate gives us the prior touches without a 1+N hit.
  const result = await db.execute<{
    venue_name: string;
    venue_address: string | null;
    venue_capacity: number | null;
    city_name: string;
    city_region: string | null;
    campaign_name: string;
    brand_name: string;
    sender_name: string;
    upcoming_crawl_date: string | null;
    history: string | null;
  }>(sql`
    WITH history AS (
      SELECT json_agg(
        json_build_object(
          'channel', ol.channel::text,
          'outcome', ol.outcome::text,
          'notes', ol.notes,
          'days_ago', EXTRACT(EPOCH FROM (NOW() - ol.created_at))::int / 86400
        )
        ORDER BY ol.created_at DESC
      ) AS history
      FROM outreach_log ol
      WHERE ol.venue_id = ${parsed.data.venueId}
        AND ol.created_at > NOW() - INTERVAL '180 days'
    ),
    upcoming AS (
      SELECT MIN(e.event_date)::text AS event_date
      FROM events e
      WHERE e.city_campaign_id = ${parsed.data.cityCampaignId}
        AND e.event_date >= CURRENT_DATE
    )
    SELECT
      v.name AS venue_name,
      v.address AS venue_address,
      v.capacity AS venue_capacity,
      c.name AS city_name,
      c.region AS city_region,
      cm.name AS campaign_name,
      ob.display_name AS brand_name,
      ${staff.displayName.split(/\s+/)[0]} AS sender_name,
      (SELECT event_date FROM upcoming) AS upcoming_crawl_date,
      (SELECT history::text FROM history) AS history
    FROM venues v
    JOIN city_campaigns cc ON cc.id = ${parsed.data.cityCampaignId}
    JOIN cities c ON c.id = cc.city_id
    JOIN campaigns cm ON cm.id = cc.campaign_id
    JOIN outreach_brands ob ON ob.id = cm.outreach_brand_id
    WHERE v.id = ${parsed.data.venueId}
    LIMIT 1
  `);

  type Row = {
    venue_name: string;
    venue_address: string | null;
    venue_capacity: number | null;
    city_name: string;
    city_region: string | null;
    campaign_name: string;
    brand_name: string;
    sender_name: string;
    upcoming_crawl_date: string | null;
    history: string | null;
  };
  const rows: Row[] = Array.isArray(result)
    ? (result as unknown as Row[])
    : ((result as unknown as { rows: Row[] }).rows ?? []);
  const ctx = rows[0];
  if (!ctx) return { ok: false, error: "Venue or campaign not found." };

  let history: Array<{
    channel: string;
    outcome: string;
    notes: string | null;
    daysAgo: number;
  }> = [];
  if (ctx.history) {
    try {
      const parsedHistory = JSON.parse(ctx.history) as Array<{
        channel: string;
        outcome: string;
        notes: string | null;
        days_ago: number;
      }> | null;
      history = (parsedHistory ?? []).map((h) => ({
        channel: h.channel,
        outcome: h.outcome,
        notes: h.notes,
        daysAgo: h.days_ago,
      }));
    } catch (err) {
      logger.warn({ err }, "draftOutreachEmail: history parse failed (non-fatal)");
    }
  }

  // -------------------------------------------------------------------
  // Slot inventory: for each upcoming event in this city campaign,
  // compute how many open slots remain by role. "Open" = required count
  // minus count of venue_events in 'confirmed' or 'contract_signed'
  // status. We only care about future events.
  // -------------------------------------------------------------------
  const inventoryResult = await db.execute<{
    event_date: string;
    day_part: string | null;
    open_wristband: number;
    open_middle: number;
    open_final: number;
  }>(sql`
    SELECT
      e.event_date::text AS event_date,
      e.day_part::text AS day_part,
      GREATEST(
        e.required_wristband_count - COALESCE((
          SELECT COUNT(*) FROM venue_events ve
          WHERE ve.event_id = e.id
            AND ve.role = 'wristband'
            AND ve.status IN ('confirmed', 'contract_signed')
        ), 0),
        0
      )::int AS open_wristband,
      GREATEST(
        e.required_middle_count - COALESCE((
          SELECT COUNT(*) FROM venue_events ve
          WHERE ve.event_id = e.id
            AND ve.role = 'middle'
            AND ve.status IN ('confirmed', 'contract_signed')
        ), 0),
        0
      )::int AS open_middle,
      GREATEST(
        e.required_final_count - COALESCE((
          SELECT COUNT(*) FROM venue_events ve
          WHERE ve.event_id = e.id
            AND ve.role = 'final'
            AND ve.status IN ('confirmed', 'contract_signed')
        ), 0),
        0
      )::int AS open_final
    FROM events e
    WHERE e.city_campaign_id = ${parsed.data.cityCampaignId}
      AND e.event_date >= CURRENT_DATE
      AND e.archived_at IS NULL
    ORDER BY e.event_date ASC
    LIMIT 8
  `);
  type InventoryRow = {
    event_date: string;
    day_part: string | null;
    open_wristband: number;
    open_middle: number;
    open_final: number;
  };
  const inventoryRows: InventoryRow[] = Array.isArray(inventoryResult)
    ? (inventoryResult as unknown as InventoryRow[])
    : ((inventoryResult as unknown as { rows: InventoryRow[] }).rows ?? []);
  const slotInventory = inventoryRows.map((row) => ({
    eventDate: row.event_date,
    dayPart: row.day_part,
    openWristband: row.open_wristband,
    openMiddle: row.open_middle,
    openFinal: row.open_final,
  }));

  const draft = await aiDraft({
    venue: {
      name: ctx.venue_name,
      address: ctx.venue_address,
      capacity: ctx.venue_capacity,
    },
    city: {
      name: ctx.city_name,
      region: ctx.city_region,
    },
    campaign: {
      name: ctx.campaign_name,
      brandName: ctx.brand_name,
      senderName: ctx.sender_name,
    },
    intendedRole: parsed.data.intendedRole,
    upcomingCrawlDate: ctx.upcoming_crawl_date,
    slotInventory,
    history,
    // Haiku for first-pass (~5x cheaper); operator can rerun with
    // quality="polish" to ask Opus for a final-pass cleanup.
    quality: parsed.data.quality,
  });

  if (!draft.ok) {
    // Surface the SPECIFIC reason instead of a generic message.
    // Operators need to see "auth: ANTHROPIC_API_KEY is invalid"
    // separately from "timeout" so they can fix the right thing.
    return { ok: false, error: messageForAiReason(draft.reason, draft.message) };
  }

  return { ok: true, data: draft.data };
}

/**
 * Translate an AI failure reason into operator-facing copy that hints
 * at the fix. The raw `message` is appended for engineers to see the
 * exact API response / request_id when debugging.
 */
function messageForAiReason(reason: import("@/lib/ai").AiReason, message: string): string {
  switch (reason) {
    case "not_configured":
      return "AI isn't configured. Add ANTHROPIC_API_KEY to /var/www/outreach/.env and restart the app (pm2 restart outreach).";
    case "auth":
      return `Anthropic rejected the API key — it may be revoked or wrong. Verify in https://console.anthropic.com/. Details: ${message}`;
    case "rate_limit":
      return `Anthropic rate limit hit. Wait a minute and try again. Details: ${message}`;
    case "overloaded":
      return `Anthropic is overloaded right now. Try again in a few seconds. Details: ${message}`;
    case "timeout":
      return `The model didn't respond in time. Try again, or shorten the prompt. Details: ${message}`;
    case "network":
      return `Network error reaching Anthropic. Check the server's internet. Details: ${message}`;
    case "bad_request":
      return `Anthropic rejected the request — likely a bad model name in ANTHROPIC_MODEL env, or a prompt that's too long. Details: ${message}`;
    case "model_error":
      return `Anthropic server error. Probably transient — try again. Details: ${message}`;
    case "empty_response":
      return `Claude returned an empty response. Details: ${message}`;
    case "parse_error":
      return `Claude returned text we couldn't parse as a draft. Try again. Details: ${message}`;
    default:
      return `AI failed: ${message}`;
  }
}

// =========================================================================
// Subject-line suggester (Haiku ROI #3)
// =========================================================================

/**
 * Suggest 3 subject lines for the operator's current draft. Reads
 * the body + optional recipient/venue context, returns 3 options
 * the operator can click to set as the subject.
 *
 * Returns ok:false (with a reason) when:
 *   - AI not configured
 *   - kill switch off
 *   - draft body is too short (< 30 chars — nothing to base
 *     a suggestion on)
 *   - rate limited
 *   - model failed
 *
 * The caller's reasonString is more useful in the UI than the
 * generic ActionResult.error, so we surface the failure mode.
 */
export async function suggestEmailSubject(input: {
  bodyText: string;
  recipientName?: string | null;
  recipientEmail?: string | null;
  venueName?: string | null;
  cityName?: string | null;
  currentSubject?: string;
  mode?: "cold" | "reply";
}): Promise<ActionResult<{ subjects: string[] }> & { reason?: string }> {
  const { staff } = await requireStaff();
  const result = await suggestSubjectLines({
    staffId: staff.id,
    bodyText: input.bodyText,
    recipientName: input.recipientName,
    recipientEmail: input.recipientEmail,
    venueName: input.venueName,
    cityName: input.cityName,
    currentSubject: input.currentSubject,
    mode: input.mode,
  });
  if (!result.ok) {
    const messages: Record<string, string> = {
      not_configured: "AI is not configured on this server.",
      disabled: "Subject suggestions are disabled.",
      too_short: "Write a few sentences first so AI has something to base a subject on.",
      rate_limited: "Too many subject requests — wait a moment and try again.",
      failed: "AI couldn't generate subjects right now. Try again.",
    };
    return {
      ok: false,
      error: messages[result.reason] ?? "Subject suggestions failed.",
      reason: result.reason,
    };
  }
  return { ok: true, data: { subjects: result.subjects } };
}
