import "server-only";

/**
 * External-host briefing emails (Phase 3.6 / 3.7). [ReferenceDoc 7.13]
 *
 * When an external host is assigned to a crawl, the engine drafts:
 *   - H0a (hire-time briefing): review-and-send now (scheduled_for = null) so
 *     the host manager confirms pay/identity details before it goes out.
 *   - H0b (week-of briefing): scheduled for the Monday of the event week, with
 *     the wristband venue address, full lineup, and host arrival time.
 *
 * Grounded to the real assignment flow: hosts link to a CRAWL (crawl_hosts by
 * event_id), not a venue_event, so the trigger is assignExternalHostToCrawl
 * (the host must be known). The wristband venue of that crawl is the venue the
 * host works -- used for the venue address + lineup merge fields. Both drafts
 * render through the real merge engine; every H0a/H0b field is in
 * MERGE_FIELD_KEYS so a missing piece renders blank, never a broken marker.
 */

import {
  events,
  campaigns,
  cityCampaigns,
  crawlHosts,
  emailDrafts,
  emailTemplates,
  externalHosts,
  venueEvents,
} from "@/db/schema";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { buildFlatMergeContext } from "@/lib/template-merge-context";
import { renderTemplate } from "@/lib/template-render";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

export interface HostBriefingArgs {
  crawlHostId: string;
  externalHostId: string;
  /** Draft owner (the operator assigning the host / host manager). */
  staffId: string;
  teamId: string;
}

export interface HostBriefingResult {
  createdDraftIds: string[];
  skipped: { code: string; reason: string }[];
}

/** Monday 13:00 UTC (~9am Eastern) of the event's week. */
function mondayOfEventWeek(eventDate: Date): Date {
  const d = new Date(eventDate);
  const day = d.getUTCDay(); // 0 = Sun .. 6 = Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diffToMonday);
  d.setUTCHours(13, 0, 0, 0);
  return d;
}

export async function scheduleHostBriefings(args: HostBriefingArgs): Promise<HostBriefingResult> {
  const createdDraftIds: string[] = [];
  const skipped: { code: string; reason: string }[] = [];

  const [ch] = await db
    .select({
      eventId: crawlHosts.eventId,
      eventDate: events.eventDate,
      cityCampaignId: events.cityCampaignId,
      campaignId: cityCampaigns.campaignId,
    })
    .from(crawlHosts)
    .innerJoin(events, eq(events.id, crawlHosts.eventId))
    .innerJoin(cityCampaigns, eq(cityCampaigns.id, events.cityCampaignId))
    .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
    .where(eq(crawlHosts.id, args.crawlHostId))
    .limit(1);
  if (!ch) {
    return { createdDraftIds, skipped: [{ code: "*", reason: "crawl host not found" }] };
  }

  // The wristband venue of this crawl is where the host works.
  const [wb] = await db
    .select({ venueId: venueEvents.venueId })
    .from(venueEvents)
    .where(and(eq(venueEvents.eventId, ch.eventId), eq(venueEvents.role, "wristband")))
    .limit(1);
  const wristbandVenueId = wb?.venueId ?? null;

  const [host] = await db
    .select({ email: externalHosts.email })
    .from(externalHosts)
    .where(eq(externalHosts.id, args.externalHostId))
    .limit(1);
  const hostEmail = host?.email ?? null;

  const ctx = await buildFlatMergeContext({
    hostExternalId: args.externalHostId,
    eventId: ch.eventId,
    cityCampaignId: ch.cityCampaignId,
    campaignId: ch.campaignId,
    venueId: wristbandVenueId,
    staffId: args.staffId,
  });

  const templates = await db
    .select({
      id: emailTemplates.id,
      code: emailTemplates.templateCode,
      subject: emailTemplates.subjectTemplate,
      bodyHtml: emailTemplates.bodyTemplateHtml,
      bodyText: emailTemplates.bodyTemplateText,
    })
    .from(emailTemplates)
    .where(
      and(
        eq(emailTemplates.campaignId, ch.campaignId),
        inArray(emailTemplates.templateCode, ["H0a", "H0b"]),
      ),
    );
  const byCode = new Map(templates.map((t) => [t.code, t]));

  const eventDate = new Date(`${ch.eventDate}T00:00:00Z`);
  const plan: { code: "H0a" | "H0b"; scheduledFor: Date | null }[] = [
    { code: "H0a", scheduledFor: null }, // review + send now
    { code: "H0b", scheduledFor: mondayOfEventWeek(eventDate) },
  ];

  for (const { code, scheduledFor } of plan) {
    const tpl = byCode.get(code);
    if (!tpl) {
      skipped.push({ code, reason: "template not seeded" });
      continue;
    }

    // Idempotent re-assign: drop any prior unsent draft of this template to the
    // same host before re-creating (email_drafts has no host link, so we match
    // on the recipient address).
    if (hostEmail) {
      await db
        .delete(emailDrafts)
        .where(
          and(
            eq(emailDrafts.templateId, tpl.id),
            isNull(emailDrafts.sentAt),
            sql`${emailDrafts.toAddresses} @> ARRAY[${hostEmail}]::text[]`,
          ),
        );
    }

    const subject = renderTemplate(tpl.subject, ctx).output;
    const bodyText = renderTemplate(tpl.bodyText, ctx).output;
    const bodyHtml = tpl.bodyHtml ? renderTemplate(tpl.bodyHtml, ctx).output : null;

    const [inserted] = await db
      .insert(emailDrafts)
      .values({
        ownerUserId: args.staffId,
        teamId: args.teamId,
        toAddresses: hostEmail ? [hostEmail] : [],
        subject,
        bodyText,
        bodyHtml,
        venueId: wristbandVenueId,
        cityCampaignId: ch.cityCampaignId,
        templateId: tpl.id,
        scheduledFor,
      })
      .returning({ id: emailDrafts.id });
    if (inserted) createdDraftIds.push(inserted.id);
  }

  logger.info(
    {
      crawlHostId: args.crawlHostId,
      externalHostId: args.externalHostId,
      created: createdDraftIds.length,
      skipped,
    },
    "host briefings scheduled",
  );
  return { createdDraftIds, skipped };
}
