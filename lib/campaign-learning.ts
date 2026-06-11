import "server-only";

/**
 * Post-campaign learning reports (CRM plan E1) — turns this campaign's
 * outcomes into training data for the next one.
 *
 * Reply attribution: a send "got a reply" when its thread saw an
 * inbound AFTER the send went out (thread.last_inbound_at > sent_at).
 * Confirm attribution: the thread's classification reached confirmed.
 * Both are conservative, send-event-grounded measures — no opens (we
 * never track opens on cold mail), no guessing.
 */

import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export interface TemplateStat {
  code: string;
  name: string;
  sends: number;
  replied: number;
  confirmed: number;
  replyRate: number;
}

export interface SenderStat {
  email: string;
  brand: string | null;
  sends: number;
  replied: number;
  replyRate: number;
}

export interface RoleStat {
  role: string;
  assigned: number;
  confirmed: number;
  cancelled: number;
}

export interface PriorityStat {
  priority: number;
  coldEntries: number;
  interested: number;
  confirmedVenues: number;
}

export interface CancellationCause {
  cause: string;
  n: number;
}

export interface ReplacementStats {
  total: number;
  filled: number;
  superseded: number;
  open: number;
  avgFillHours: number | null;
}

export interface VenueListRow {
  venueId: string;
  name: string;
  cityName: string;
  detail: string;
}

export interface CampaignLearning {
  byTemplate: TemplateStat[];
  bySender: SenderStat[];
  byRole: RoleStat[];
  byPriority: PriorityStat[];
  cancellationCauses: CancellationCause[];
  replacements: ReplacementStats;
  venuesToReuse: VenueListRow[];
  venuesToAvoid: VenueListRow[];
}

function rowsOf<T>(res: unknown): T[] {
  return Array.isArray(res) ? (res as T[]) : ((res as { rows?: T[] }).rows ?? []);
}

export async function loadCampaignLearning(campaignId: string): Promise<CampaignLearning> {
  const [tpl, snd, role, prio, cancel, repl, reuse, avoid] = await Promise.all([
    db.execute(sql`
      SELECT et.template_code AS code,
             et.name AS name,
             count(*)::int AS sends,
             count(*) FILTER (WHERE t.last_inbound_at > se.sent_at)::int AS replied,
             count(*) FILTER (WHERE t.classification::text = 'confirmed')::int AS confirmed
      FROM email_send_events se
      JOIN email_templates et ON et.id = se.template_id
      JOIN email_threads t ON t.id = se.thread_id
      JOIN city_campaigns cc ON cc.id = t.city_campaign_id
      WHERE cc.campaign_id = ${campaignId}::uuid
      GROUP BY et.template_code, et.name
      HAVING count(*) >= 3
      ORDER BY count(*) FILTER (WHERE t.last_inbound_at > se.sent_at)::numeric / count(*) DESC
    `),
    db.execute(sql`
      SELECT ca.email_address AS email,
             ob.display_name AS brand,
             count(*)::int AS sends,
             count(*) FILTER (WHERE t.last_inbound_at > se.sent_at)::int AS replied
      FROM email_send_events se
      JOIN connected_accounts ca ON ca.id = se.connected_account_id
      JOIN email_threads t ON t.id = se.thread_id
      JOIN city_campaigns cc ON cc.id = t.city_campaign_id
      LEFT JOIN campaign_connected_accounts cca
        ON cca.connected_account_id = ca.id AND cca.campaign_id = cc.campaign_id
      LEFT JOIN outreach_brands ob ON ob.id = cca.outreach_brand_id
      WHERE cc.campaign_id = ${campaignId}::uuid
      GROUP BY ca.email_address, ob.display_name
      HAVING count(*) >= 3
      ORDER BY count(*) DESC
    `),
    db.execute(sql`
      SELECT ve.role::text AS role,
             count(*)::int AS assigned,
             count(*) FILTER (WHERE ve.status = 'confirmed')::int AS confirmed,
             count(*) FILTER (WHERE ve.status = 'cancelled')::int AS cancelled
      FROM venue_events ve
      JOIN events e ON e.id = ve.event_id
      JOIN city_campaigns cc ON cc.id = e.city_campaign_id
      WHERE cc.campaign_id = ${campaignId}::uuid
      GROUP BY ve.role
      ORDER BY ve.role
    `),
    db.execute(sql`
      SELECT cc.priority::int AS priority,
             count(DISTINCT coe.id)::int AS cold_entries,
             count(DISTINCT coe.id) FILTER (WHERE coe.status::text = 'interested')::int AS interested,
             count(DISTINCT ve.venue_id) FILTER (WHERE ve.status = 'confirmed')::int AS confirmed_venues
      FROM city_campaigns cc
      LEFT JOIN cold_outreach_entries coe
        ON coe.city_campaign_id = cc.id AND coe.archived_at IS NULL
      LEFT JOIN events e ON e.city_campaign_id = cc.id AND e.archived_at IS NULL
      LEFT JOIN venue_events ve ON ve.event_id = e.id
      WHERE cc.campaign_id = ${campaignId}::uuid
      GROUP BY cc.priority
      ORDER BY cc.priority
    `),
    db.execute(sql`
      SELECT CASE
               WHEN ve.cancellation_reason ILIKE 'cancelled by venue%' THEN 'Venue pulled out'
               WHEN ve.cancellation_reason ILIKE 'cancelled by us%' THEN 'We cancelled'
               WHEN ve.cancellation_reason ILIKE '%cancelled (marked from inbox)%' THEN 'Marked from inbox'
               WHEN ve.cancellation_reason IS NULL OR ve.cancellation_reason = '' THEN 'No reason recorded'
               ELSE 'Other'
             END AS cause,
             count(*)::int AS n
      FROM venue_events ve
      JOIN events e ON e.id = ve.event_id
      JOIN city_campaigns cc ON cc.id = e.city_campaign_id
      WHERE cc.campaign_id = ${campaignId}::uuid AND ve.status = 'cancelled'
      GROUP BY 1 ORDER BY 2 DESC
    `),
    db.execute(sql`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE rp.status = 'filled')::int AS filled,
             count(*) FILTER (WHERE rp.status = 'closed')::int AS superseded,
             count(*) FILTER (WHERE rp.status = 'open')::int AS open,
             avg(EXTRACT(EPOCH FROM (rp.closed_at - rp.created_at)) / 3600)
               FILTER (WHERE rp.status = 'filled') AS avg_fill_hours
      FROM replacement_pushes rp
      JOIN events e ON e.id = rp.event_id
      JOIN city_campaigns cc ON cc.id = e.city_campaign_id
      WHERE cc.campaign_id = ${campaignId}::uuid
    `),
    // Venues to reuse next campaign: confirmed at least once, never
    // cancelled on us, and they answer email.
    db.execute(sql`
      SELECT v.id::text AS venue_id, v.name, c.name AS city_name,
             count(*) FILTER (WHERE ve.status = 'confirmed')::int || ' confirmed slot(s)' AS detail
      FROM venues v
      JOIN venue_events ve ON ve.venue_id = v.id
      JOIN events e ON e.id = ve.event_id
      JOIN city_campaigns cc ON cc.id = e.city_campaign_id
      JOIN cities c ON c.id = v.city_id
      WHERE cc.campaign_id = ${campaignId}::uuid
        AND v.archived_at IS NULL AND v.do_not_contact = false
      GROUP BY v.id, v.name, c.name
      HAVING count(*) FILTER (WHERE ve.status = 'confirmed') > 0
         AND count(*) FILTER (
               WHERE ve.status = 'cancelled'
                 AND ve.cancellation_reason ILIKE 'cancelled by venue%') = 0
      ORDER BY count(*) FILTER (WHERE ve.status = 'confirmed') DESC, v.name
      LIMIT 25
    `),
    // Venues to avoid: pulled out on us, or hard-declined + flagged bad.
    db.execute(sql`
      SELECT v.id::text AS venue_id, v.name, c.name AS city_name,
             string_agg(DISTINCT
               CASE
                 WHEN ve.cancellation_reason ILIKE 'cancelled by venue%' THEN 'pulled out'
                 WHEN ve.status = 'cancelled' THEN 'cancelled'
                 ELSE NULL
               END, ', ') AS detail
      FROM venues v
      JOIN venue_events ve ON ve.venue_id = v.id
      JOIN events e ON e.id = ve.event_id
      JOIN city_campaigns cc ON cc.id = e.city_campaign_id
      JOIN cities c ON c.id = v.city_id
      WHERE cc.campaign_id = ${campaignId}::uuid
        AND ve.status = 'cancelled'
        AND ve.cancellation_reason ILIKE 'cancelled by venue%'
      GROUP BY v.id, v.name, c.name
      ORDER BY v.name
      LIMIT 25
    `),
  ]);

  const tplRows = rowsOf<{
    code: string;
    name: string;
    sends: number;
    replied: number;
    confirmed: number;
  }>(tpl);
  const sndRows = rowsOf<{ email: string; brand: string | null; sends: number; replied: number }>(
    snd,
  );
  const replRow = rowsOf<{
    total: number;
    filled: number;
    superseded: number;
    open: number;
    avg_fill_hours: number | null;
  }>(repl)[0];

  return {
    byTemplate: tplRows.map((r) => ({
      code: r.code,
      name: r.name,
      sends: Number(r.sends),
      replied: Number(r.replied),
      confirmed: Number(r.confirmed),
      replyRate: Number(r.sends) > 0 ? Number(r.replied) / Number(r.sends) : 0,
    })),
    bySender: sndRows.map((r) => ({
      email: r.email,
      brand: r.brand,
      sends: Number(r.sends),
      replied: Number(r.replied),
      replyRate: Number(r.sends) > 0 ? Number(r.replied) / Number(r.sends) : 0,
    })),
    byRole: rowsOf<{ role: string; assigned: number; confirmed: number; cancelled: number }>(
      role,
    ).map((r) => ({
      role: r.role,
      assigned: Number(r.assigned),
      confirmed: Number(r.confirmed),
      cancelled: Number(r.cancelled),
    })),
    byPriority: rowsOf<{
      priority: number;
      cold_entries: number;
      interested: number;
      confirmed_venues: number;
    }>(prio).map((r) => ({
      priority: Number(r.priority),
      coldEntries: Number(r.cold_entries),
      interested: Number(r.interested),
      confirmedVenues: Number(r.confirmed_venues),
    })),
    cancellationCauses: rowsOf<{ cause: string; n: number }>(cancel).map((r) => ({
      cause: r.cause,
      n: Number(r.n),
    })),
    replacements: {
      total: Number(replRow?.total ?? 0),
      filled: Number(replRow?.filled ?? 0),
      superseded: Number(replRow?.superseded ?? 0),
      open: Number(replRow?.open ?? 0),
      avgFillHours:
        replRow?.avg_fill_hours != null
          ? Math.round(Number(replRow.avg_fill_hours) * 10) / 10
          : null,
    },
    venuesToReuse: rowsOf<{ venue_id: string; name: string; city_name: string; detail: string }>(
      reuse,
    ).map((r) => ({
      venueId: r.venue_id,
      name: r.name,
      cityName: r.city_name,
      detail: r.detail,
    })),
    venuesToAvoid: rowsOf<{
      venue_id: string;
      name: string;
      city_name: string;
      detail: string | null;
    }>(avoid).map((r) => ({
      venueId: r.venue_id,
      name: r.name,
      cityName: r.city_name,
      detail: r.detail ?? "cancelled on us",
    })),
  };
}
