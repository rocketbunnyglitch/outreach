/**
 * Worklist data loaders (Phase 2).
 *
 * Server-only queries backing the /worklist sections. Section 1 (drafts) lands
 * here in Phase 2.2; replies / follow-ups / calls join in 2.3-2.5.
 */

import "server-only";
import { cities, cityCampaigns, emailDrafts, emailTemplates, venues } from "@/db/schema";
import { db } from "@/lib/db";
import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";

export interface WorklistDraftRow {
  id: string;
  subject: string;
  toAddress: string | null;
  templateCode: string | null;
  templateName: string | null;
  venueName: string | null;
  cityName: string | null;
  scheduledFor: string | null;
  /** scheduled_for is in the past -- this draft is overdue to go out. */
  overdue: boolean;
}

/**
 * Drafts queued for the operator to review + send (Phase 2.2). The engine's
 * cadence-advance cron generates these as replies on due threads; manually
 * started drafts surface here too. Window: unsent, and either unscheduled or
 * scheduled within the next 24h (a draft scheduled further out is not yet
 * today's work).
 *
 * Sort: overdue (scheduled in the past) first, then upcoming-scheduled soonest
 * first, then unscheduled oldest first. NOTE: the spec's "cadence floor closest
 * to violation" tie-breaker is intentionally simplified to scheduled/created
 * time -- per-draft floor computation is expensive and the touch log is empty
 * until campaign sends begin; revisit when there is floor data to sort on.
 */
export async function loadWorklistDrafts(opts: { staffId: string }): Promise<WorklistDraftRow[]> {
  const now = new Date();
  const horizon = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // Resolve the template via the engine pick, falling back to a manually
  // chosen template id.
  const templateJoin = sql`${emailTemplates.id} = coalesce(${emailDrafts.enginePickedTemplateId}, ${emailDrafts.templateId})`;

  const rows = await db
    .select({
      id: emailDrafts.id,
      subject: emailDrafts.subject,
      toAddresses: emailDrafts.toAddresses,
      scheduledFor: emailDrafts.scheduledFor,
      createdAt: emailDrafts.createdAt,
      templateCode: emailTemplates.templateCode,
      templateName: emailTemplates.name,
      venueName: venues.name,
      cityName: cities.name,
    })
    .from(emailDrafts)
    .leftJoin(emailTemplates, templateJoin)
    .leftJoin(venues, eq(venues.id, emailDrafts.venueId))
    .leftJoin(cityCampaigns, eq(cityCampaigns.id, emailDrafts.cityCampaignId))
    .leftJoin(cities, eq(cities.id, cityCampaigns.cityId))
    .where(
      and(
        eq(emailDrafts.ownerUserId, opts.staffId),
        isNull(emailDrafts.sentAt),
        or(isNull(emailDrafts.scheduledFor), lte(emailDrafts.scheduledFor, horizon)),
      ),
    )
    .orderBy(
      sql`CASE
        WHEN ${emailDrafts.scheduledFor} IS NOT NULL AND ${emailDrafts.scheduledFor} <= now() THEN 0
        WHEN ${emailDrafts.scheduledFor} IS NOT NULL THEN 1
        ELSE 2 END`,
      asc(emailDrafts.scheduledFor),
      asc(emailDrafts.createdAt),
    );

  return rows.map((r) => ({
    id: r.id,
    subject: r.subject,
    toAddress: r.toAddresses?.[0] ?? null,
    templateCode: r.templateCode ?? null,
    templateName: r.templateName ?? null,
    venueName: r.venueName ?? null,
    cityName: r.cityName ?? null,
    scheduledFor: r.scheduledFor ? r.scheduledFor.toISOString() : null,
    overdue: r.scheduledFor ? r.scheduledFor.getTime() <= now.getTime() : false,
  }));
}
