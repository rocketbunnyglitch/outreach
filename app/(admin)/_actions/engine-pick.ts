"use server";

/**
 * Engine template auto-pick for the composer (Phase 1.5).
 *
 * Wraps the server-only `pickTemplate` (lib/template-picker.ts) in a server
 * action the client composer can call. Given the composer's attribution
 * (venueId + cityCampaignId, or a reply threadId), it derives a PickContext
 * from the venue's booking + city-campaign data and returns the engine's pick
 * plus alternatives. The composer pre-loads the pick and lets the operator
 * keep it, swap to an alternative, or use a blank draft.
 *
 * [ReferenceDoc Section 7 + Section 8.7] the engine picks a template for the
 * operator; the operator can always override. We never auto-send; this only
 * pre-fills the composer.
 *
 * The pick is intentionally a best-effort hint: when we cannot determine the
 * city-campaign (no booking, no attribution) we return a null pick rather than
 * guess, and the composer falls back to a blank draft.
 */

import { events, cityCampaigns, emailTemplates, emailThreads, venueEvents } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { type PickContext, pickTemplate } from "@/lib/template-picker";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EnginePickInput {
  /** Venue the composer is attributed to (cold-outreach send). */
  venueId?: string | null;
  /** City-campaign the composer is attributed to. */
  cityCampaignId?: string | null;
  /** Reply thread (inbox reply). Used to resolve a venue when no venueId. */
  threadId?: string | null;
}

export interface EnginePickAlternative {
  templateId: string;
  templateCode: string;
  reason: string;
}

export interface EnginePickResult {
  /** Null when the engine has no confident pick (composer stays blank). */
  pick: {
    templateId: string;
    templateCode: string;
    reason: string;
    matchScore: number;
  } | null;
  /** Up to 3 alternative templates for the "see alternatives" dropdown. */
  alternatives: EnginePickAlternative[];
  /** Human-readable summary of the derived context (banner tooltip / debug). */
  contextSummary: string;
}

const EMPTY: EnginePickResult = { pick: null, alternatives: [], contextSummary: "" };

/** UTC whole-day delta between an ISO date (YYYY-MM-DD) and today. */
function daysFromToday(eventDate: string): number {
  const event = Date.parse(`${eventDate}T00:00:00Z`);
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((event - today) / 86_400_000);
}

function clampPriority(p: number): 1 | 2 | 3 | 4 | 5 | 6 {
  return Math.min(6, Math.max(1, p)) as 1 | 2 | 3 | 4 | 5 | 6;
}

/**
 * Resolve the composer's attribution to a concrete PickContext by reading the
 * venue's booking (venue_events -> events -> city_campaigns). Returns null when
 * the city-campaign cannot be determined, which is the engine's "no pick"
 * signal.
 */
async function derivePickContext(input: EnginePickInput): Promise<PickContext | null> {
  let venueId = input.venueId && UUID_RE.test(input.venueId) ? input.venueId : null;
  const threadId = input.threadId && UUID_RE.test(input.threadId) ? input.threadId : null;
  let cityCampaignId =
    input.cityCampaignId && UUID_RE.test(input.cityCampaignId) ? input.cityCampaignId : null;

  // Inbox reply: resolve the venue off the thread when not passed directly.
  if (!venueId && threadId) {
    const [t] = await db
      .select({ venueId: emailThreads.venueId })
      .from(emailThreads)
      .where(eq(emailThreads.id, threadId))
      .limit(1);
    venueId = t?.venueId ?? null;
  }

  if (!venueId) return null;

  // Pull this venue's bookings, scoped to the city-campaign when known.
  const bookingFilters = [eq(venueEvents.venueId, venueId), isNull(events.archivedAt)];
  if (cityCampaignId) bookingFilters.push(eq(events.cityCampaignId, cityCampaignId));

  const bookings = await db
    .select({
      role: venueEvents.role,
      status: venueEvents.status,
      cityCampaignId: events.cityCampaignId,
      eventDate: events.eventDate,
      crawlFormat: events.crawlFormat,
    })
    .from(venueEvents)
    .innerJoin(events, eq(events.id, venueEvents.eventId))
    .where(and(...bookingFilters))
    .orderBy(asc(events.eventDate));

  // Prefer the soonest upcoming booking; fall back to the latest past one.
  const upcoming = bookings.filter((b) => daysFromToday(b.eventDate) >= 0);
  const chosen = upcoming[0] ?? bookings[bookings.length - 1] ?? null;

  // City-campaign comes from the booking, or the explicit attribution.
  cityCampaignId = chosen?.cityCampaignId ?? cityCampaignId;
  if (!cityCampaignId) return null;

  const [cc] = await db
    .select({ campaignId: cityCampaigns.campaignId, priority: cityCampaigns.priority })
    .from(cityCampaigns)
    .where(eq(cityCampaigns.id, cityCampaignId))
    .limit(1);
  if (!cc) return null;

  // crawlCount = number of crawls (events) in this city-campaign.
  const crawls = await db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.cityCampaignId, cityCampaignId), isNull(events.archivedAt)));

  const ctx: PickContext = {
    campaignId: cc.campaignId,
    venueId,
    threadId: threadId ?? undefined,
    cityPriority: clampPriority(cc.priority),
    crawlCount: crawls.length,
  };
  if (chosen) {
    ctx.slotType = chosen.role;
    ctx.eventType = chosen.crawlFormat === "day_party" ? "day_party" : "night";
    ctx.daysToEvent = daysFromToday(chosen.eventDate);
    // A venue still at "lead" has never been contacted -> this is the cold
    // opener (a big open ask); anything later is a slot-detail follow-up.
    // [ReferenceDoc Section 7] openers vs detail follow-ups.
    if (chosen.status === "lead") ctx.askSize = "big_open";
  }
  return ctx;
}

function summarize(ctx: PickContext): string {
  const bits: string[] = [`Prio ${ctx.cityPriority ?? "?"}`];
  if (ctx.crawlCount != null)
    bits.push(`${ctx.crawlCount} crawl${ctx.crawlCount === 1 ? "" : "s"}`);
  if (ctx.eventType) bits.push(ctx.eventType.replace(/_/g, " "));
  if (ctx.slotType) bits.push(ctx.slotType.replace(/_/g, " "));
  if (ctx.daysToEvent != null) bits.push(`${ctx.daysToEvent}d out`);
  return bits.join(", ");
}

/**
 * Compute the engine's template pick for a composer context. Always returns
 * ok:true with a possibly-null pick (a missing pick is a normal outcome, not
 * an error). Errors are logged and degrade to an empty result so the composer
 * can still open.
 */
export async function pickTemplateForComposer(
  input: EnginePickInput,
): Promise<ActionResult<EnginePickResult>> {
  await requireStaff();
  try {
    const ctx = await derivePickContext(input);
    if (!ctx) return { ok: true, data: EMPTY };

    const picked = await pickTemplate(ctx);
    if (!picked) return { ok: true, data: { ...EMPTY, contextSummary: summarize(ctx) } };

    // Resolve alternative codes -> ids so the client can swap without another
    // round trip. Codes are scoped to the same campaign as the pick.
    const altCodes = picked.alternatives.map((a) => a.templateCode);
    const idByCode = new Map<string, string>();
    if (altCodes.length > 0) {
      const rows = await db
        .select({ id: emailTemplates.id, templateCode: emailTemplates.templateCode })
        .from(emailTemplates)
        .where(
          and(
            eq(emailTemplates.campaignId, ctx.campaignId),
            inArray(emailTemplates.templateCode, altCodes),
          ),
        );
      for (const r of rows) idByCode.set(r.templateCode, r.id);
    }

    const alternatives: EnginePickAlternative[] = picked.alternatives
      .map((a) => {
        const id = idByCode.get(a.templateCode);
        return id ? { templateId: id, templateCode: a.templateCode, reason: a.reason } : null;
      })
      .filter((a): a is EnginePickAlternative => a !== null);

    return {
      ok: true,
      data: {
        pick: {
          templateId: picked.template.id,
          templateCode: picked.template.templateCode,
          reason: picked.reason,
          matchScore: picked.matchScore,
        },
        alternatives,
        contextSummary: summarize(ctx),
      },
    };
  } catch (err) {
    logger.error({ err, input }, "pickTemplateForComposer failed");
    return { ok: true, data: EMPTY };
  }
}
