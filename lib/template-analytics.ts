import "server-only";

/**
 * Template performance analytics — Phase C.1.
 *
 * For every email template that's been sent at least once in the
 * window, compute:
 *
 *   sentCount       cold sends using this template
 *   replyCount      threads with an inbound reply within 30 days
 *                    of the send
 *   warmCount       threads that landed in warm/confirmed/interested
 *                    classification (any time after the send)
 *   declineCount    threads classified decline / unsubscribe
 *   replyRate       replyCount / sentCount, 0..1
 *   warmRate        warmCount / sentCount, 0..1
 *   declineRate     declineCount / sentCount, 0..1
 *   medianHoursToReply  median elapsed time from send to first
 *                       inbound reply on the same thread
 *
 * Sample-size aware: templates with fewer than MIN_SAMPLE sends
 * are tagged as "low sample" in the UI — operators shouldn't
 * compare a 4-send template's 50% reply rate to a 200-send
 * template's 12% rate.
 *
 * Source tables:
 *   - email_send_events (cold sends with template_id)
 *   - email_threads (classification, last_inbound_at)
 *   - email_messages (for time-to-reply calc)
 *
 * Window-bounded: send must be within [from, to]. Reply / warm
 * counts use the threads of those sends regardless of when the
 * reply arrived — operators care about "of the cold emails I
 * sent in March, how many ever went warm" not "in March."
 *
 * Returns one row per template plus a synthetic
 * "(no template / freeform)" row for sends that didn't use a
 * template.
 */

import { emailMessages, emailSendEvents, emailTemplates, emailThreads } from "@/db/schema";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sql } from "drizzle-orm";

export interface TemplatePerformanceRow {
  templateId: string | null;
  templateName: string;
  sentCount: number;
  replyCount: number;
  warmCount: number;
  declineCount: number;
  /** 0..1, replyCount / sentCount. */
  replyRate: number;
  /** 0..1, warmCount / sentCount. */
  warmRate: number;
  /** 0..1, declineCount / sentCount. */
  declineRate: number;
  /** Median hours from send to first inbound reply on the thread,
   *  across all threads of this template that ever got a reply.
   *  null when no replies. */
  medianHoursToReply: number | null;
  /** True when sentCount < MIN_SAMPLE — UI hides win/loss arrows
   *  on these rows since small-n comparisons are noise. */
  lowSample: boolean;
}

export interface TemplateAnalyticsOpts {
  teamId: string;
  /** Inclusive lower bound on send time. Defaults to 90 days ago. */
  from?: Date;
  /** Inclusive upper bound on send time. Defaults to now. */
  to?: Date;
}

const MIN_SAMPLE = 10;
const DEFAULT_WINDOW_DAYS = 90;

export async function loadTemplatePerformance(
  opts: TemplateAnalyticsOpts,
): Promise<TemplatePerformanceRow[]> {
  const from = opts.from ?? new Date(Date.now() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const to = opts.to ?? new Date();

  // Per-template send + reply rollup. One CTE per derivation, then
  // joined at the end. Postgres optimizer handles this well — no
  // need to hand-tune; the row count per template is small.
  //
  // The classification check uses the LATEST classification on the
  // thread (not the historical "did it ever pass through warm") —
  // operators read the current state of the world, and a thread
  // that was warm-then-declined should count as decline.
  const rows = (await db.execute<{
    template_id: string | null;
    template_name: string | null;
    sent_count: number;
    reply_count: number;
    warm_count: number;
    decline_count: number;
    median_hours_to_reply: number | null;
  }>(sql`
    WITH sends AS (
      SELECT
        ese.template_id,
        ese.thread_id,
        ese.sent_at
      FROM ${emailSendEvents} ese
      WHERE ese.team_id = ${opts.teamId}
        AND ese.category = 'cold'
        AND ese.sent_at >= ${from}
        AND ese.sent_at <= ${to}
    ),
    -- First inbound reply per thread (if any).
    first_replies AS (
      SELECT
        em.thread_id,
        MIN(em.sent_at) AS first_reply_at
      FROM ${emailMessages} em
      WHERE em.direction = 'inbound'
      GROUP BY em.thread_id
    ),
    -- Join sends with their thread's current state + first reply.
    enriched AS (
      SELECT
        s.template_id,
        s.thread_id,
        s.sent_at,
        et.classification,
        fr.first_reply_at,
        CASE
          WHEN fr.first_reply_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (fr.first_reply_at - s.sent_at)) / 3600.0
          ELSE NULL
        END AS hours_to_reply
      FROM sends s
      INNER JOIN ${emailThreads} et ON et.id = s.thread_id
      LEFT JOIN first_replies fr ON fr.thread_id = s.thread_id
    )
    SELECT
      e.template_id,
      t.name AS template_name,
      COUNT(*)::int AS sent_count,
      COUNT(e.first_reply_at)::int AS reply_count,
      SUM(
        CASE WHEN e.classification IN ('interested', 'warm', 'confirmed')
          THEN 1 ELSE 0 END
      )::int AS warm_count,
      SUM(
        CASE WHEN e.classification IN ('decline', 'unsubscribe')
          THEN 1 ELSE 0 END
      )::int AS decline_count,
      -- Median via percentile_cont.
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY e.hours_to_reply)::numeric AS median_hours_to_reply
    FROM enriched e
    LEFT JOIN ${emailTemplates} t ON t.id = e.template_id
    GROUP BY e.template_id, t.name
    ORDER BY sent_count DESC
  `)) as unknown;

  const list: Array<{
    template_id: string | null;
    template_name: string | null;
    sent_count: number;
    reply_count: number;
    warm_count: number;
    decline_count: number;
    median_hours_to_reply: number | string | null;
  }> = Array.isArray(rows)
    ? (rows as Array<{
        template_id: string | null;
        template_name: string | null;
        sent_count: number;
        reply_count: number;
        warm_count: number;
        decline_count: number;
        median_hours_to_reply: number | string | null;
      }>)
    : ((rows as { rows: typeof list }).rows ?? []);

  return list.map((r) => {
    const sent = Number(r.sent_count) || 0;
    const reply = Number(r.reply_count) || 0;
    const warm = Number(r.warm_count) || 0;
    const decline = Number(r.decline_count) || 0;
    return {
      templateId: r.template_id,
      templateName: r.template_id ? (r.template_name ?? "(deleted template)") : "(no template)",
      sentCount: sent,
      replyCount: reply,
      warmCount: warm,
      declineCount: decline,
      replyRate: sent > 0 ? reply / sent : 0,
      warmRate: sent > 0 ? warm / sent : 0,
      declineRate: sent > 0 ? decline / sent : 0,
      medianHoursToReply:
        r.median_hours_to_reply !== null && r.median_hours_to_reply !== undefined
          ? Number(r.median_hours_to_reply)
          : null,
      lowSample: sent < MIN_SAMPLE,
    };
  });
}

// =========================================================================
// Subject-line A/B performance (Tier-2)
// =========================================================================

export interface SubjectVariantRow {
  templateId: string;
  templateName: string;
  variantIndex: number;
  /** The variant's subject text (raw template). null if it's been removed. */
  variantText: string | null;
  sentCount: number;
  replyCount: number;
  /** 0..1, replyCount / sentCount. */
  replyRate: number;
  lowSample: boolean;
}

/**
 * Per-subject-variant reply rate (Tier-2 A/B). Groups cold sends that recorded
 * a subject_variant_index by (template, variant) and computes the reply rate
 * (threads that got an inbound reply). NO open pixels -- reply is the only
 * signal. Returned grouped by template, variant order ascending.
 */
export async function loadSubjectVariantPerformance(
  opts: TemplateAnalyticsOpts,
): Promise<SubjectVariantRow[]> {
  const from = opts.from ?? new Date(Date.now() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const to = opts.to ?? new Date();

  try {
    const rows = (await db.execute<{
      template_id: string;
      template_name: string | null;
      subject_variants: string[] | null;
      variant_index: number;
      sent_count: number;
      reply_count: number;
    }>(sql`
      WITH sends AS (
        SELECT ese.template_id, ese.subject_variant_index AS vidx, ese.thread_id
        FROM ${emailSendEvents} ese
        WHERE ese.team_id = ${opts.teamId}
          AND ese.category = 'cold'
          AND ese.template_id IS NOT NULL
          AND ese.subject_variant_index IS NOT NULL
          AND ese.sent_at >= ${from}
          AND ese.sent_at <= ${to}
      ),
      replies AS (
        SELECT DISTINCT thread_id FROM ${emailMessages} WHERE direction = 'inbound'
      )
      SELECT
        s.template_id,
        t.name AS template_name,
        t.subject_variants AS subject_variants,
        s.vidx AS variant_index,
        COUNT(*)::int AS sent_count,
        SUM(CASE WHEN r.thread_id IS NOT NULL THEN 1 ELSE 0 END)::int AS reply_count
      FROM sends s
      LEFT JOIN replies r ON r.thread_id = s.thread_id
      LEFT JOIN ${emailTemplates} t ON t.id = s.template_id
      GROUP BY s.template_id, t.name, t.subject_variants, s.vidx
      ORDER BY s.template_id, s.vidx
    `)) as unknown;

    const list: Array<{
      template_id: string;
      template_name: string | null;
      subject_variants: string[] | null;
      variant_index: number;
      sent_count: number;
      reply_count: number;
    }> = Array.isArray(rows) ? (rows as typeof list) : ((rows as { rows: typeof list }).rows ?? []);

    return list.map((r) => {
      const sent = Number(r.sent_count) || 0;
      const reply = Number(r.reply_count) || 0;
      const vidx = Number(r.variant_index);
      const variants = Array.isArray(r.subject_variants) ? r.subject_variants : null;
      return {
        templateId: r.template_id,
        templateName: r.template_name ?? "(deleted template)",
        variantIndex: vidx,
        variantText: variants?.[vidx] ?? null,
        sentCount: sent,
        replyCount: reply,
        replyRate: sent > 0 ? reply / sent : 0,
        lowSample: sent < MIN_SAMPLE,
      };
    });
  } catch (err) {
    logger.warn({ err, teamId: opts.teamId }, "[loadSubjectVariantPerformance] failed");
    return [];
  }
}

// =========================================================================
// Best-send-time analysis — Phase C.3
// =========================================================================

export interface SendTimeBucket {
  /** Hour of day in operator's local timezone, 0..23. */
  hour: number;
  sentCount: number;
  replyCount: number;
  replyRate: number;
}

/**
 * For every send in the window, bucket by hour of day (operator
 * local time) and compute the reply rate. Identifies the hour
 * when sends are most likely to get a response.
 *
 * Timezone: we use the operator's stored timezone (default
 * America/Toronto) for bucketing. Sending at 9am Toronto vs.
 * 9am UTC is a totally different signal.
 */
export async function loadBestSendTime(opts: {
  teamId: string;
  timezone?: string;
  from?: Date;
  to?: Date;
}): Promise<SendTimeBucket[]> {
  const tz = opts.timezone ?? "America/Toronto";
  const from = opts.from ?? new Date(Date.now() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const to = opts.to ?? new Date();

  try {
    const rows = (await db.execute<{
      hour: number;
      sent_count: number;
      reply_count: number;
    }>(sql`
      WITH sends AS (
        SELECT
          ese.thread_id,
          ese.sent_at,
          EXTRACT(HOUR FROM ese.sent_at AT TIME ZONE ${tz})::int AS hour
        FROM ${emailSendEvents} ese
        WHERE ese.team_id = ${opts.teamId}
          AND ese.category = 'cold'
          AND ese.sent_at >= ${from}
          AND ese.sent_at <= ${to}
      ),
      replies AS (
        SELECT DISTINCT thread_id
        FROM ${emailMessages}
        WHERE direction = 'inbound'
      )
      SELECT
        s.hour,
        COUNT(*)::int AS sent_count,
        SUM(CASE WHEN r.thread_id IS NOT NULL THEN 1 ELSE 0 END)::int AS reply_count
      FROM sends s
      LEFT JOIN replies r ON r.thread_id = s.thread_id
      GROUP BY s.hour
      ORDER BY s.hour
    `)) as unknown;

    const list: Array<{ hour: number; sent_count: number; reply_count: number }> = Array.isArray(
      rows,
    )
      ? (rows as Array<{ hour: number; sent_count: number; reply_count: number }>)
      : ((rows as { rows: typeof list }).rows ?? []);

    // Fill missing hours with zeros so the chart renders a full
    // 24-bar histogram even when some hours have no sends.
    const byHour = new Map<number, { sentCount: number; replyCount: number }>();
    for (const r of list) {
      byHour.set(Number(r.hour), {
        sentCount: Number(r.sent_count) || 0,
        replyCount: Number(r.reply_count) || 0,
      });
    }
    const out: SendTimeBucket[] = [];
    for (let h = 0; h < 24; h++) {
      const v = byHour.get(h) ?? { sentCount: 0, replyCount: 0 };
      out.push({
        hour: h,
        sentCount: v.sentCount,
        replyCount: v.replyCount,
        replyRate: v.sentCount > 0 ? v.replyCount / v.sentCount : 0,
      });
    }
    return out;
  } catch (err) {
    logger.warn({ err, teamId: opts.teamId }, "[loadBestSendTime] failed");
    return [];
  }
}

// =========================================================================
// Conversion funnel — Phase C.2
// =========================================================================

export interface ConversionFunnel {
  /** Total cold sends in the window. */
  sent: number;
  /** Threads with at least one inbound reply. */
  replied: number;
  /** Threads currently classified interested / warm / confirmed. */
  warmOrBetter: number;
  /** Threads currently classified confirmed. */
  confirmed: number;
  /** Threads currently classified decline / unsubscribe. */
  declined: number;
  /** Bounce count from email_soft_bounces in the window. */
  bounced: number;
}

/**
 * Compute the team-wide cold-outreach funnel for the given window.
 * One number per stage. Operators read this to spot where the
 * leak is — high sends + low replies = subject lines suck; high
 * replies + low warm = template tone is off; high warm + low
 * confirmed = the closing email needs work.
 */
export async function loadConversionFunnel(opts: {
  teamId: string;
  from?: Date;
  to?: Date;
}): Promise<ConversionFunnel> {
  const from = opts.from ?? new Date(Date.now() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const to = opts.to ?? new Date();

  try {
    const rows = (await db.execute<{
      sent: number;
      replied: number;
      warm_or_better: number;
      confirmed: number;
      declined: number;
      bounced: number;
    }>(sql`
      WITH sends AS (
        SELECT DISTINCT thread_id
        FROM ${emailSendEvents}
        WHERE team_id = ${opts.teamId}
          AND category = 'cold'
          AND sent_at >= ${from}
          AND sent_at <= ${to}
      ),
      replies AS (
        SELECT DISTINCT thread_id
        FROM ${emailMessages}
        WHERE direction = 'inbound'
      )
      SELECT
        (SELECT COUNT(*) FROM sends)::int AS sent,
        (SELECT COUNT(*) FROM sends s
         INNER JOIN replies r ON r.thread_id = s.thread_id)::int AS replied,
        (SELECT COUNT(*) FROM sends s
         INNER JOIN ${emailThreads} et ON et.id = s.thread_id
         WHERE et.classification IN ('interested', 'warm', 'confirmed'))::int AS warm_or_better,
        (SELECT COUNT(*) FROM sends s
         INNER JOIN ${emailThreads} et ON et.id = s.thread_id
         WHERE et.classification = 'confirmed')::int AS confirmed,
        (SELECT COUNT(*) FROM sends s
         INNER JOIN ${emailThreads} et ON et.id = s.thread_id
         WHERE et.classification IN ('decline', 'unsubscribe'))::int AS declined,
        (SELECT COUNT(*) FROM email_soft_bounces
         WHERE team_id = ${opts.teamId}
           AND last_seen_at >= ${from}
           AND last_seen_at <= ${to})::int AS bounced
    `)) as unknown;

    const list: Array<{
      sent: number;
      replied: number;
      warm_or_better: number;
      confirmed: number;
      declined: number;
      bounced: number;
    }> = Array.isArray(rows)
      ? (rows as Array<{
          sent: number;
          replied: number;
          warm_or_better: number;
          confirmed: number;
          declined: number;
          bounced: number;
        }>)
      : ((rows as { rows: typeof list }).rows ?? []);

    const r = list[0];
    return {
      sent: Number(r?.sent) || 0,
      replied: Number(r?.replied) || 0,
      warmOrBetter: Number(r?.warm_or_better) || 0,
      confirmed: Number(r?.confirmed) || 0,
      declined: Number(r?.declined) || 0,
      bounced: Number(r?.bounced) || 0,
    };
  } catch (err) {
    logger.warn({ err, teamId: opts.teamId }, "[loadConversionFunnel] failed");
    return { sent: 0, replied: 0, warmOrBetter: 0, confirmed: 0, declined: 0, bounced: 0 };
  }
}
