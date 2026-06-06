import "server-only";

/**
 * Host SMS cadence subsystem (spec phases 5.4 H1-H5, 5.5 lineup-change,
 * 5.6 host payment-confirmation, 6.3 post-event distribution-count).
 * [ReferenceDoc 7.14.2]
 *
 * INERT by design: every send goes through lib/sms.ts sendSms(), which always
 * inserts an sms_messages audit row and only calls Twilio when isSmsConfigured()
 * is true. Until creds land, sendSms returns status='unconfigured' and nothing
 * leaves the building -- but the intended send is still logged for dry-run
 * visibility (both the sms_messages row and, for the H-touches, a host_sms_log
 * row with status='unconfigured').
 *
 * Scheduling model -- CRON-COMPUTED (chosen for simplicity + idempotency):
 *   scheduleHostSmsCadence() does NOT pre-create host_sms_log rows. It only
 *   validates the assignment resolves to an event with a date and logs intent.
 *   The cron (runHostSmsCadence) is the single source of truth: each tick it
 *   recomputes which H-touch is due NOW from events.event_date and inserts the
 *   host_sms_log row at send time. The UNIQUE(external_host_id, event_id,
 *   touch_code) index + insert-on-conflict-do-nothing is the idempotency gate,
 *   so re-running a tick (or running scheduleHostSmsCadence twice) never double
 *   sends. This avoids a second "scheduled rows drift out of sync with the
 *   event date" failure mode that a pre-created-rows approach would carry.
 *
 * Bodies are terse + human (operator standing rule). All grounded to the real
 * data model: external_hosts.phone_e164, events.event_date / city_campaign_id,
 * the crawl's wristband venue (venue_events role='wristband'),
 * external_host_shipments.wristband_count.
 */

import {
  events,
  cityCampaigns,
  crawlHosts,
  externalHostShipments,
  externalHosts,
  hostSmsLog,
  venueEvents,
  venues,
} from "@/db/schema";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendSms } from "@/lib/sms";
import { formatEventDate, payRateLabel } from "@/lib/template-merge-format";
import { and, eq, gte, isNotNull, lte } from "drizzle-orm";

export interface ScheduleHostSmsCadenceArgs {
  crawlHostId: string;
  externalHostId: string;
  /** Operator performing the assign (audit owner). */
  staffId: string;
  teamId: string;
}

export interface HostSmsCadenceRunResult {
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
}

/** The H-touch codes, in cadence order. */
type TouchCode = "H1" | "H2" | "H3" | "H4" | "H5";

/**
 * How many calendar days before event_date each touch fires. H3/H4 are day-of
 * (offset 0); H5 is an escalation handled when no arrival confirmation exists.
 */
const TOUCH_DAYS_BEFORE: Record<Exclude<TouchCode, "H5">, number> = {
  H1: 7,
  H2: 2,
  H3: 0,
  H4: 0,
};

/**
 * Window (in days) the cron looks ahead for upcoming crawls. Comfortably wider
 * than the earliest touch (H1 at 7 days) so a host assigned late still catches
 * every due touch on the next tick.
 */
const LOOKAHEAD_DAYS = 14;

/**
 * Light validation hook called from assignExternalHostToCrawl. Per the
 * cron-computed model this does NOT create or send anything -- the cron owns
 * the schedule. It resolves the event + wristband venue (mirroring
 * scheduleHostBriefings) purely so any data gap is logged at assign time
 * rather than discovered silently on the next cron tick.
 */
export async function scheduleHostSmsCadence(
  args: ScheduleHostSmsCadenceArgs,
): Promise<{ ok: boolean; eventId: string | null; reason?: string }> {
  const [ch] = await db
    .select({
      eventId: crawlHosts.eventId,
      eventDate: events.eventDate,
      cityCampaignId: events.cityCampaignId,
    })
    .from(crawlHosts)
    .innerJoin(events, eq(events.id, crawlHosts.eventId))
    .where(eq(crawlHosts.id, args.crawlHostId))
    .limit(1);

  if (!ch) {
    logger.warn(
      { crawlHostId: args.crawlHostId, externalHostId: args.externalHostId },
      "host sms cadence: crawl host not found; nothing to schedule",
    );
    return { ok: false, eventId: null, reason: "crawl host not found" };
  }

  const [host] = await db
    .select({ phoneE164: externalHosts.phoneE164 })
    .from(externalHosts)
    .where(eq(externalHosts.id, args.externalHostId))
    .limit(1);

  if (!host?.phoneE164) {
    logger.info(
      { crawlHostId: args.crawlHostId, externalHostId: args.externalHostId, eventId: ch.eventId },
      "host sms cadence: host has no phone_e164; cron will skip this host",
    );
  }

  logger.info(
    {
      crawlHostId: args.crawlHostId,
      externalHostId: args.externalHostId,
      eventId: ch.eventId,
      eventDate: ch.eventDate,
      hasPhone: Boolean(host?.phoneE164),
    },
    "host sms cadence known (cron-computed; no rows pre-created)",
  );
  return { ok: true, eventId: ch.eventId };
}

/** Resolve the wristband venue name for an event ("" when none set). */
async function wristbandVenueName(eventId: string): Promise<string> {
  const [wb] = await db
    .select({ name: venues.name })
    .from(venueEvents)
    .innerJoin(venues, eq(venues.id, venueEvents.venueId))
    .where(and(eq(venueEvents.eventId, eventId), eq(venueEvents.role, "wristband")))
    .limit(1);
  return wb?.name ?? "";
}

/**
 * Which non-escalation touch (H1..H4) is due today for an event whose date is
 * `eventDate` (an ISO yyyy-mm-dd string), or null if none is. "Due" means the
 * number of whole days from today (UTC) to the event date matches the touch's
 * offset. H3 and H4 are both day-of; we treat the earlier one (H3) as the
 * day-of touch and H4 as the same-day reminder -- the UNIQUE gate means both
 * can fire on the day without duplicating either. We keep day-of simple
 * (no shift-time parsing): shift_start_time is free text and unreliable, so a
 * single day-of send per touch is acceptable and documented.
 */
function dueTouchFor(eventDate: string, today: Date): Exclude<TouchCode, "H5"> | null {
  const event = new Date(`${eventDate}T00:00:00Z`);
  const midnightToday = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysUntil = Math.round((event.getTime() - midnightToday.getTime()) / msPerDay);

  if (daysUntil === TOUCH_DAYS_BEFORE.H1) return "H1";
  if (daysUntil === TOUCH_DAYS_BEFORE.H2) return "H2";
  // Day-of: prefer H3 (the day-of confirm). H4 (the reminder) is sent on the
  // same day too; since both share offset 0 we emit H3 here and let H4 ride in
  // as a second body in the same tick (see buildBodies).
  if (daysUntil === 0) return "H3";
  return null;
}

/**
 * Build the SMS body for a given touch. Terse, human, grounded in 7.14.2.
 * `dateLabel` is "Saturday, October 31"; `venue` is the wristband venue name.
 */
function buildTouchBody(touch: TouchCode, dateLabel: string, venue: string): string {
  const at = venue ? ` at ${venue}` : "";
  switch (touch) {
    case "H1":
      return `Confirming you're still on for the Halloween crawl ${dateLabel}${at}. Reply YES.`;
    case "H2":
      return `Two days out -- you're hosting the crawl ${dateLabel}${at}. All set? Reply YES.`;
    case "H3":
      return `Today's the crawl${at}. Reply when you're on your way; text this number if anything comes up.`;
    case "H4":
      return `Reminder: crawl${at} is coming up shortly. Head over and reply ARRIVED when you're there.`;
    case "H5":
      return `We haven't heard you've arrived${at}. Reply ARRIVED, or call if you're held up.`;
  }
}

/**
 * Cron worker. For every external host assigned to an upcoming crawl, compute
 * the due H-touch and send it (inert until Twilio configured). Idempotent via
 * UNIQUE(external_host_id, event_id, touch_code) + on-conflict-do-nothing,
 * claimed BEFORE the send so a re-tick never double-sends.
 *
 * Edge case: if sendSms() THROWS after the row is claimed (truly exceptional --
 * sendSms returns null on hard failure rather than throwing), the claim row is
 * left at status='unconfigured' and the UNIQUE gate blocks a retry. Acceptable
 * for this inert subsystem; an operator can clear the row to re-arm a touch.
 */
export async function runHostSmsCadence(): Promise<HostSmsCadenceRunResult> {
  const now = new Date();
  const horizon = new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
  const todayIso = now.toISOString().slice(0, 10);
  const horizonIso = horizon.toISOString().slice(0, 10);

  // Candidate hosts: external, assigned, on a crawl whose date is in the
  // lookahead window. Pull the phone + pay context we need for any touch.
  const candidates = await db
    .select({
      externalHostId: crawlHosts.externalHostId,
      eventId: crawlHosts.eventId,
      eventDate: events.eventDate,
      cityCampaignId: events.cityCampaignId,
      campaignId: cityCampaigns.campaignId,
      phoneE164: externalHosts.phoneE164,
    })
    .from(crawlHosts)
    .innerJoin(events, eq(events.id, crawlHosts.eventId))
    .innerJoin(cityCampaigns, eq(cityCampaigns.id, events.cityCampaignId))
    .innerJoin(externalHosts, eq(externalHosts.id, crawlHosts.externalHostId))
    .where(
      and(
        eq(crawlHosts.hostType, "external"),
        isNotNull(crawlHosts.externalHostId),
        gte(events.eventDate, todayIso),
        lte(events.eventDate, horizonIso),
      ),
    )
    .limit(500);

  let attempted = 0;
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const c of candidates) {
    const externalHostId = c.externalHostId;
    if (!externalHostId) {
      skipped += 1;
      continue;
    }
    if (!c.phoneE164) {
      // No phone -- nothing to send. Don't log a host_sms_log row; the host is
      // simply uncontactable by SMS until a number lands.
      skipped += 1;
      continue;
    }

    const touch = dueTouchFor(c.eventDate, now);
    if (!touch) {
      skipped += 1;
      continue;
    }

    try {
      // CLAIM-FIRST idempotency: insert the host_sms_log row as a lock BEFORE
      // sending. on-conflict-do-nothing on UNIQUE(external_host_id, event_id,
      // touch_code) means only the first tick to reach a due touch wins the
      // insert; a re-tick (or a concurrent run) gets an empty returning() and
      // skips -- so we never create a second sms_messages row for a touch that
      // already went out. The row starts status='unconfigured' as a placeholder
      // and is updated with the real send result below.
      const claimed = await db
        .insert(hostSmsLog)
        .values({
          externalHostId,
          eventId: c.eventId,
          touchCode: touch,
          status: "unconfigured",
          createdBy: null,
          updatedBy: null,
        })
        .onConflictDoNothing({
          target: [hostSmsLog.externalHostId, hostSmsLog.eventId, hostSmsLog.touchCode],
        })
        .returning({ id: hostSmsLog.id });

      const logId = claimed[0]?.id;
      if (!logId) {
        // Already sent/claimed on a prior tick -- nothing to do.
        skipped += 1;
        continue;
      }

      attempted += 1;
      const dateLabel = formatEventDate(c.eventDate);
      const venue = await wristbandVenueName(c.eventId);
      const body = buildTouchBody(touch, dateLabel, venue);

      const result = await sendSms({
        to: c.phoneE164,
        body,
        kind: "host_cadence",
        externalHostId,
        relatedEventId: c.eventId,
        cityCampaignId: c.cityCampaignId,
        campaignId: c.campaignId,
      });

      const status = result ? (result.status === "sent" ? "sent" : "unconfigured") : "failed";
      await db
        .update(hostSmsLog)
        .set({ status, smsMessageId: result?.id ?? null, updatedAt: new Date() })
        .where(eq(hostSmsLog.id, logId));

      if (status === "failed") {
        failed += 1;
      } else {
        // 'sent' (live) or 'unconfigured' (inert dry-run) both count as a
        // successful, logged dispatch.
        sent += 1;
      }
    } catch (err) {
      failed += 1;
      logger.error(
        { err, externalHostId, eventId: c.eventId, touch },
        "host sms cadence touch failed (will retry next tick)",
      );
    }
  }

  logger.info({ attempted, sent, failed, skipped }, "host sms cadence run complete");
  return { attempted, sent, failed, skipped };
}

/**
 * 5.5 -- lineup-change SMS. Text every WORKING external host on this event's
 * crawl about a lineup change. Logged via sendSms (sms_messages audit only;
 * no host_sms_log -- that table is scoped to the H1-H5 cadence).
 */
export async function sendLineupChangeSms(args: {
  eventId: string;
  staffId: string;
  teamId: string;
  changeSummary: string;
}): Promise<{ attempted: number; sent: number }> {
  const [ev] = await db
    .select({ eventDate: events.eventDate, cityCampaignId: events.cityCampaignId })
    .from(events)
    .where(eq(events.id, args.eventId))
    .limit(1);
  if (!ev) {
    logger.warn({ eventId: args.eventId }, "lineup-change sms: event not found");
    return { attempted: 0, sent: 0 };
  }

  const hosts = await db
    .select({ externalHostId: externalHosts.id, phoneE164: externalHosts.phoneE164 })
    .from(crawlHosts)
    .innerJoin(externalHosts, eq(externalHosts.id, crawlHosts.externalHostId))
    .where(and(eq(crawlHosts.eventId, args.eventId), eq(crawlHosts.hostType, "external")));

  const dateLabel = formatEventDate(ev.eventDate);
  const venue = await wristbandVenueName(args.eventId);
  const at = venue ? ` at ${venue}` : "";
  const body = `Lineup update for ${dateLabel}${at}: ${args.changeSummary}`;

  let attempted = 0;
  let sent = 0;
  for (const h of hosts) {
    if (!h.phoneE164) continue;
    attempted += 1;
    const result = await sendSms({
      to: h.phoneE164,
      body,
      kind: "lineup_change",
      externalHostId: h.externalHostId,
      relatedEventId: args.eventId,
      cityCampaignId: ev.cityCampaignId,
    });
    if (result) sent += 1;
  }
  logger.info({ eventId: args.eventId, attempted, sent }, "lineup-change sms dispatched");
  return { attempted, sent };
}

/**
 * 5.6 -- host payment-confirmation SMS. Confirms payment was sent. amountCents
 * defaults to the host's standing pay rate; eventId (optional) lets the body
 * name the date the payment is for.
 */
export async function sendHostPaymentConfirmationSms(args: {
  externalHostId: string;
  eventId?: string;
  amountCents?: number;
  staffId: string;
  teamId: string;
}): Promise<{ id: string; sid: string | null; status: string } | null> {
  const [host] = await db
    .select({
      phoneE164: externalHosts.phoneE164,
      payRateCents: externalHosts.payRateCents,
      currency: externalHosts.currency,
      paymentMethod: externalHosts.paymentMethod,
    })
    .from(externalHosts)
    .where(eq(externalHosts.id, args.externalHostId))
    .limit(1);
  if (!host?.phoneE164) {
    logger.info(
      { externalHostId: args.externalHostId },
      "host payment sms: no phone_e164; skipping",
    );
    return null;
  }

  let dateLabel = "";
  let cityCampaignId: string | null = null;
  if (args.eventId) {
    const [ev] = await db
      .select({ eventDate: events.eventDate, cityCampaignId: events.cityCampaignId })
      .from(events)
      .where(eq(events.id, args.eventId))
      .limit(1);
    if (ev) {
      dateLabel = formatEventDate(ev.eventDate);
      cityCampaignId = ev.cityCampaignId;
    }
  }

  const cents = args.amountCents ?? host.payRateCents ?? 0;
  const amount = payRateLabel(cents, host.currency).replace("/hr", "");
  const via = host.paymentMethod ? ` via ${host.paymentMethod}` : "";
  const forDate = dateLabel ? ` for ${dateLabel}` : "";
  const amountPart = amount ? `Payment of ${amount}` : "Payment";
  const body = `${amountPart}${via} sent${forDate}. Thanks for hosting!`;

  return sendSms({
    to: host.phoneE164,
    body,
    kind: "payment",
    externalHostId: args.externalHostId,
    relatedEventId: args.eventId ?? null,
    cityCampaignId,
  });
}

/**
 * 6.3 -- post-event host SMS with distribution count. Thanks the host and
 * reports how many wristbands they distributed (from external_host_shipments,
 * grain = host x city campaign).
 */
export async function sendPostEventHostSms(args: {
  externalHostId: string;
  cityCampaignId: string;
  staffId: string;
  teamId: string;
}): Promise<{ id: string; sid: string | null; status: string } | null> {
  const [host] = await db
    .select({ phoneE164: externalHosts.phoneE164 })
    .from(externalHosts)
    .where(eq(externalHosts.id, args.externalHostId))
    .limit(1);
  if (!host?.phoneE164) {
    logger.info(
      { externalHostId: args.externalHostId },
      "post-event host sms: no phone_e164; skipping",
    );
    return null;
  }

  const [shipment] = await db
    .select({ wristbandCount: externalHostShipments.wristbandCount })
    .from(externalHostShipments)
    .where(
      and(
        eq(externalHostShipments.externalHostId, args.externalHostId),
        eq(externalHostShipments.cityCampaignId, args.cityCampaignId),
      ),
    )
    .limit(1);

  const count = shipment?.wristbandCount ?? null;
  const countPart =
    count !== null ? ` You distributed ${count} wristband${count === 1 ? "" : "s"}.` : "";
  const body = `Thanks for hosting!${countPart} Payment processing soon.`;

  return sendSms({
    to: host.phoneE164,
    body,
    kind: "post_event",
    externalHostId: args.externalHostId,
    cityCampaignId: args.cityCampaignId,
  });
}
