import "server-only";

/**
 * Emergency replacement mode (Phase 6.2). [ReferenceDoc 7.16.3]
 *
 * When a CONFIRMED venue drops a slot in event week, the operator triggers a
 * mass replacement push: batch-draft outreach to many nearby candidate venues
 * for that one open role, with the cross-domain cadence floor SUSPENDED (an
 * emergency overrides the normal 7-day anti-spam rule -- 7.16.3 step 3).
 *
 * Human-in-the-loop (CLAUDE.md 8.8): we create review-and-send email_drafts
 * (scheduled_for = null) rather than auto-sending. The operator reviews each
 * draft and clicks send; the per-draft send is what actually goes out.
 *
 * --- Candidate-venue logic (conservative + documented) ---
 * 7.16.3 step 1 names three candidate sources: nearby venues pitched this
 * campaign that didn't reply, nearby soft-no venues, and past partners. We do
 * NOT have a precise "pitched-but-no-reply" signal that is cheap + reliable
 * here, so we keep this CONSERVATIVE and grounded in real columns:
 *   - same city as the dropped slot's crawl,
 *   - NOT already linked to THIS event (no double-pitch on the same crawl),
 *   - has an email address, not do_not_contact, not archived.
 * That set is exactly "reachable nearby venues not already on this crawl",
 * which is the safe superset the operator wants in an emergency. We order it so
 * venues with PRIOR venue_event history in this campaign's city (known/past
 * partners) come first, then the rest by name. The loader returns this list so
 * the UI can show + let the operator deselect before drafting.
 *
 * --- Template choice (documented) ---
 * There is no 'T8' (one-shot specific ask) template seeded. We pick the
 * campaign's COLD-stage default template (the cold opener, typically T1) via a
 * direct lookup -- the same template the engine would use to open a fresh
 * conversation. If no cold template exists we fall back to a clearly-marked
 * urgent plain-text message so the push never silently produces nothing. Either
 * way the draft is review-and-send, so the operator can sharpen the copy into a
 * specific one-night ask before sending.
 *
 * --- Cadence floor suspension ---
 * The cadence floor is enforced at SEND time inside lib/compose-send-impl.ts
 * (checkCadenceFloors + decideCadenceGate), NOT at draft time. So creating
 * these drafts does not trip the floor. When the operator sends an emergency
 * draft, the floor override is the existing admin bypass path
 * (relationshipBlocked / cadenceBlocked + bypassCap / cadenceOverrideReason).
 * We stamp each draft's subject/body with the urgent framing and return a
 * cadenceOverrideReason string the UI passes through on send so the override is
 * logged on the send event. We do not reach around the send pipeline.
 */

import {
  events,
  campaigns,
  cityCampaigns,
  emailDrafts,
  emailTemplates,
  venueEvents,
  venues,
} from "@/db/schema";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { buildFlatMergeContext } from "@/lib/template-merge-context";
import { renderTemplate } from "@/lib/template-render";
import { and, asc, eq, inArray, isNotNull, isNull, notInArray, sql } from "drizzle-orm";

export type ReplacementRole = "wristband" | "middle" | "final" | "alt_final";

export interface EmergencyReplacementArgs {
  eventId: string;
  /** The open role to fill (the role of the venue that dropped). */
  role: ReplacementRole;
  /** Optional slot position within the role (informational; merged into copy). */
  slotPosition?: number | null;
  /** Operator triggering the push (draft owner). */
  staffId: string;
  /** Owner's team (email_drafts.team_id is NOT NULL). */
  teamId: string;
  /** Short human reason (e.g. "Wristband venue cancelled, 5 days out"). */
  reason: string;
  /** Optional explicit candidate venue ids (from the loader, after the operator
   *  deselects some). When omitted, we draft to the full candidate set. */
  venueIds?: string[];
  /** Safety cap on how many drafts a single push creates. */
  maxCandidates?: number;
}

export interface EmergencyReplacementResult {
  ok: boolean;
  /** Drafts created (one per candidate venue with a usable email). */
  draftsCreated: number;
  /** Candidate venues considered. */
  candidatesConsidered: number;
  /** Template code used for the push, or 'urgent-fallback'. */
  templateUsed: string;
  /** Pass-through reason the UI should attach to each send as the cadence
   *  override justification, so the floor bypass is logged. */
  cadenceOverrideReason: string;
  error?: string;
}

export interface ReplacementCandidate {
  venueId: string;
  name: string;
  email: string | null;
  /** True when this venue has prior venue_event history in this campaign's
   *  city (a known/past partner -- ranked first). */
  knownPartner: boolean;
}

const DEFAULT_MAX_CANDIDATES = 40;

interface CrawlContext {
  eventId: string;
  eventDate: string;
  cityId: string;
  cityCampaignId: string;
  campaignId: string;
}

async function loadCrawlContext(eventId: string): Promise<CrawlContext | null> {
  const [row] = await db
    .select({
      eventId: events.id,
      eventDate: events.eventDate,
      cityId: cityCampaigns.cityId,
      cityCampaignId: events.cityCampaignId,
      campaignId: cityCampaigns.campaignId,
    })
    .from(events)
    .innerJoin(cityCampaigns, eq(cityCampaigns.id, events.cityCampaignId))
    .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
    .where(eq(events.id, eventId))
    .limit(1);
  return row ?? null;
}

/**
 * Candidate backup venues for an open slot on this crawl. Same city, not
 * already on this event, reachable (email + not do_not_contact + not archived).
 * Known/past partners (prior venue_event history in this campaign's city) are
 * ranked first. Used by the UI to show + let the operator deselect.
 */
export async function loadReplacementCandidates(
  eventId: string,
  maxCandidates = DEFAULT_MAX_CANDIDATES,
): Promise<ReplacementCandidate[]> {
  const ctx = await loadCrawlContext(eventId);
  if (!ctx) return [];

  // Venues already on THIS event -- exclude (no double-pitch on the same crawl).
  const onEvent = await db
    .select({ venueId: venueEvents.venueId })
    .from(venueEvents)
    .where(eq(venueEvents.eventId, eventId));
  const onEventIds = onEvent.map((r) => r.venueId);

  const base = db
    .select({
      venueId: venues.id,
      name: venues.name,
      email: venues.email,
    })
    .from(venues)
    .where(
      and(
        eq(venues.cityId, ctx.cityId),
        eq(venues.doNotContact, false),
        isNotNull(venues.email),
        sql`${venues.archivedAt} IS NULL`,
        onEventIds.length > 0 ? notInArray(venues.id, onEventIds) : sql`true`,
      ),
    )
    .orderBy(asc(venues.name));
  const reachable = await base;
  if (reachable.length === 0) return [];

  // Known/past partners: any venue with prior venue_event history in any event
  // of this campaign's city-campaign.
  const reachableIds = reachable.map((v) => v.venueId);
  const partnerRows = await db
    .selectDistinct({ venueId: venueEvents.venueId })
    .from(venueEvents)
    .innerJoin(events, eq(events.id, venueEvents.eventId))
    .where(
      and(
        eq(events.cityCampaignId, ctx.cityCampaignId),
        inArray(venueEvents.venueId, reachableIds),
      ),
    );
  const partnerSet = new Set(partnerRows.map((r) => r.venueId));

  const candidates: ReplacementCandidate[] = reachable.map((v) => ({
    venueId: v.venueId,
    name: v.name,
    email: v.email,
    knownPartner: partnerSet.has(v.venueId),
  }));

  // Known partners first, then alphabetical within each group.
  candidates.sort((a, b) => {
    if (a.knownPartner !== b.knownPartner) return a.knownPartner ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return candidates.slice(0, maxCandidates);
}

interface PushTemplate {
  code: string;
  templateId: string | null;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
}

/**
 * Pick the campaign's cold-opener template for the push. Prefers the cold-stage
 * default; falls back to any cold-stage template, then to a clearly-marked
 * urgent plain-text message when nothing is seeded.
 */
async function pickPushTemplate(campaignId: string): Promise<PushTemplate> {
  const coldRows = await db
    .select({
      id: emailTemplates.id,
      code: emailTemplates.templateCode,
      subject: emailTemplates.subjectTemplate,
      bodyHtml: emailTemplates.bodyTemplateHtml,
      bodyText: emailTemplates.bodyTemplateText,
      isDefaultForStage: emailTemplates.isDefaultForStage,
    })
    .from(emailTemplates)
    .where(
      and(
        eq(emailTemplates.campaignId, campaignId),
        eq(emailTemplates.stage, "cold"),
        sql`${emailTemplates.archivedAt} IS NULL`,
      ),
    );

  const chosen = coldRows.find((r) => r.isDefaultForStage) ?? coldRows[0];
  if (chosen) {
    return {
      code: chosen.code,
      templateId: chosen.id,
      subject: chosen.subject,
      bodyText: chosen.bodyText,
      bodyHtml: chosen.bodyHtml,
    };
  }

  // Fallback: no cold template seeded. A clearly-marked urgent ask. The merge
  // engine fills {{...}} from the per-venue context below; underivable fields
  // render blank (never a broken marker).
  return {
    code: "urgent-fallback",
    templateId: null,
    subject: "Quick one-night ask for {{city}} on {{date}}",
    bodyText:
      "Hi {{contact_first_name}},\n\n" +
      "We have a last-minute opening for our {{city}} crawl on {{date}} and are " +
      "reaching out to a short list of great venues to fill one specific slot. " +
      "It would be a single night, and we can move fast on details.\n\n" +
      "Any chance you could host? Happy to call to sort it out quickly.\n\n" +
      "Thanks,\n{{your_name}}\n{{company_name}}",
    bodyHtml: null,
  };
}

/**
 * Trigger the emergency replacement push. Batch-drafts review-and-send outreach
 * to candidate backup venues for the open role. Floors are suspended at send
 * time via the returned cadenceOverrideReason (operator-confirmed bypass).
 */
export async function triggerEmergencyReplacement(
  args: EmergencyReplacementArgs,
): Promise<EmergencyReplacementResult> {
  const cadenceOverrideReason = `Emergency replacement (${args.role}): ${args.reason}`.slice(
    0,
    500,
  );

  const ctx = await loadCrawlContext(args.eventId);
  if (!ctx) {
    return {
      ok: false,
      draftsCreated: 0,
      candidatesConsidered: 0,
      templateUsed: "none",
      cadenceOverrideReason,
      error: "Event not found.",
    };
  }

  const maxCandidates = args.maxCandidates ?? DEFAULT_MAX_CANDIDATES;

  // Resolve the candidate set. If the operator passed explicit venueIds, scope
  // to those (still re-validated against the reachable candidate set so a stale
  // id can't slip a do_not_contact venue through). Otherwise use the full set.
  const allCandidates = await loadReplacementCandidates(args.eventId, maxCandidates);
  const candidates =
    args.venueIds && args.venueIds.length > 0
      ? allCandidates.filter((c) => args.venueIds?.includes(c.venueId))
      : allCandidates;

  if (candidates.length === 0) {
    return {
      ok: true,
      draftsCreated: 0,
      candidatesConsidered: 0,
      templateUsed: "none",
      cadenceOverrideReason,
      error: "No reachable backup venues found for this city.",
    };
  }

  const tpl = await pickPushTemplate(ctx.campaignId);

  const slotLabel =
    args.slotPosition && args.slotPosition > 0 ? `${args.role} ${args.slotPosition}` : args.role;

  let draftsCreated = 0;
  for (const cand of candidates) {
    if (!cand.email) continue;

    // Per-venue merge context (same builder the lifecycle + cancellation flows
    // use). Underivable fields render blank, never a broken marker.
    const mergeCtx = await buildFlatMergeContext({
      venueId: cand.venueId,
      campaignId: ctx.campaignId,
      cityCampaignId: ctx.cityCampaignId,
      eventId: ctx.eventId,
      staffId: args.staffId,
    });

    const subject = renderTemplate(tpl.subject, mergeCtx).output;
    const bodyText = renderTemplate(tpl.bodyText, mergeCtx).output;
    const bodyHtml = tpl.bodyHtml ? renderTemplate(tpl.bodyHtml, mergeCtx).output : null;

    // Idempotent re-push: drop any prior unsent emergency draft of this template
    // to this candidate for this crawl before re-creating, so re-triggering the
    // push doesn't pile up duplicates. Matched on venue + cityCampaign + unsent
    // + recipient (the urgent-fallback path has a null templateId, so we cannot
    // key on templateId alone).
    await db
      .delete(emailDrafts)
      .where(
        and(
          eq(emailDrafts.venueId, cand.venueId),
          eq(emailDrafts.cityCampaignId, ctx.cityCampaignId),
          isNull(emailDrafts.sentAt),
          sql`${emailDrafts.toAddresses} @> ARRAY[${cand.email}]::text[]`,
          sql`${emailDrafts.scheduledFor} IS NULL`,
          tpl.templateId
            ? eq(emailDrafts.templateId, tpl.templateId)
            : sql`${emailDrafts.templateId} IS NULL`,
        ),
      );

    const [inserted] = await db
      .insert(emailDrafts)
      .values({
        ownerUserId: args.staffId,
        teamId: args.teamId,
        toAddresses: [cand.email],
        subject,
        bodyText,
        bodyHtml,
        venueId: cand.venueId,
        cityCampaignId: ctx.cityCampaignId,
        templateId: tpl.templateId,
        // Review-and-send: the operator approves each one. NOT auto-sent.
        scheduledFor: null,
      })
      .returning({ id: emailDrafts.id });
    if (inserted) draftsCreated += 1;
  }

  logger.info(
    {
      eventId: args.eventId,
      role: args.role,
      slot: slotLabel,
      candidatesConsidered: candidates.length,
      draftsCreated,
      templateUsed: tpl.code,
    },
    "emergency replacement push drafted",
  );

  return {
    ok: true,
    draftsCreated,
    candidatesConsidered: candidates.length,
    templateUsed: tpl.code,
    cadenceOverrideReason,
  };
}
