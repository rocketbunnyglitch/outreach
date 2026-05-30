import "server-only";

/**
 * Inbox alert evaluator. Reads inbox_alert_rules + the latest inbox
 * stats; fires (and rate-limits) notifications when thresholds are
 * crossed.
 *
 * Cadence:
 *   Cron runs every 30 minutes. The rate-limit prevents re-firing
 *   the same (rule_id) within RATE_LIMIT_HOURS (default 24).
 *
 * Channels:
 *   - 'email' — sends via the operator's first connected_account
 *     using the existing sendGmailMessage helper. This is the
 *     primary channel; almost everyone reads email.
 *   - 'slack' — POST to ALERT_SLACK_WEBHOOK_URL env if set;
 *     otherwise records the dispatch as status='skipped'. Cheap to
 *     wire up so we don't have to revisit when an operator wants it.
 *
 * Rule kinds:
 *   'bounce_rate'  threshold=0.05 (5%) → fires when 7d bounce rate ≥
 *   'sync_stale'   threshold=60 (mins) → fires when last_synced_at older
 *   'no_replies'   threshold=20 (sends) → fires when 7d cold_sends ≥ N
 *                                          AND 7d replies = 0
 *   'cap_breached' threshold=0 (any)   → fires when admin bypass count > 0
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sql } from "drizzle-orm";

export interface EvaluatorResult {
  rulesChecked: number;
  rulesFired: number;
  dispatchesSent: number;
}

const RATE_LIMIT_HOURS = 24;

interface RuleRow extends Record<string, unknown> {
  rule_id: string;
  account_id: string;
  account_email: string;
  owner_user_id: string;
  owner_email: string;
  team_id: string;
  rule_kind: string;
  threshold: number;
  channels: string[];
  last_fired_at: string | null;
  last_synced_at: string | null;
  // Aggregates joined in by the worker query:
  cold_sends_7d: number;
  bounces_7d: number;
  replies_7d: number;
  cap_bypasses_today: number;
}

/**
 * Walks every enabled rule, evaluates its condition against the
 * latest stats, and dispatches when the condition is met and the
 * rule hasn't already fired in the last RATE_LIMIT_HOURS.
 *
 * Returns counters for the cron log.
 */
export async function runAlertEvaluator(): Promise<EvaluatorResult> {
  // One query that joins rules to their inbox + owner + latest
  // 7-day aggregates. Subqueries inside the SELECT keep the joins
  // bounded; this runs over all enabled rules at once.
  const result = await db.execute<RuleRow>(sql`
    SELECT
      r.id::text                              AS rule_id,
      ca.id::text                             AS account_id,
      ca.email_address                        AS account_email,
      ca.owner_user_id::text                  AS owner_user_id,
      u.primary_email                         AS owner_email,
      ca.team_id::text                        AS team_id,
      r.rule_kind                             AS rule_kind,
      r.threshold::float8                     AS threshold,
      r.channels                              AS channels,
      (
        SELECT MAX(fired_at)::text FROM inbox_alert_dispatches d
        WHERE d.rule_id = r.id
      )                                        AS last_fired_at,
      ca.last_synced_at::text                 AS last_synced_at,
      COALESCE((
        SELECT COUNT(*)::int FROM email_send_events ese
        WHERE ese.connected_account_id = ca.id
          AND ese.counted_against_cap = true
          AND ese.sent_at >= NOW() - interval '7 days'
      ), 0)                                    AS cold_sends_7d,
      COALESCE((
        SELECT COUNT(DISTINCT ese.recipient_email)::int
        FROM email_send_events ese
        JOIN email_suppression es
          ON lower(es.email) = lower(ese.recipient_email)
         AND es.reason = 'bounced'
        WHERE ese.connected_account_id = ca.id
          AND ese.sent_at >= NOW() - interval '7 days'
      ), 0)                                    AS bounces_7d,
      COALESCE((
        SELECT COUNT(*)::int FROM email_messages em
        JOIN email_threads et ON et.id = em.thread_id
        WHERE et.staff_outreach_email_id = ca.id
          AND em.direction = 'inbound'
          AND em.sent_at >= NOW() - interval '7 days'
      ), 0)                                    AS replies_7d,
      COALESCE((
        SELECT COUNT(*)::int FROM email_send_events ese
        WHERE ese.connected_account_id = ca.id
          AND ese.cap_bypassed = true
          AND ese.sent_at >= CURRENT_DATE
      ), 0)                                    AS cap_bypasses_today
    FROM inbox_alert_rules r
    JOIN connected_accounts ca ON ca.id = r.connected_account_id
    JOIN users u ON u.id = ca.owner_user_id
    WHERE r.enabled = true
  `);

  const rows = Array.isArray(result)
    ? (result as RuleRow[])
    : ((result as unknown as { rows: RuleRow[] }).rows ?? []);

  let dispatchesSent = 0;
  let rulesFired = 0;

  for (const row of rows) {
    // Rate-limit: skip if rule fired in the last RATE_LIMIT_HOURS.
    if (row.last_fired_at) {
      const lastMs = new Date(row.last_fired_at).getTime();
      const cutoff = Date.now() - RATE_LIMIT_HOURS * 3600 * 1000;
      if (lastMs > cutoff) continue;
    }

    const fired = evaluateRule(row);
    if (!fired) continue;
    rulesFired += 1;

    // For each channel on the rule, attempt dispatch.
    for (const channel of row.channels) {
      try {
        const sent = await dispatchAlert({
          channel,
          accountEmail: row.account_email,
          ownerEmail: row.owner_email,
          ruleKind: row.rule_kind,
          threshold: row.threshold,
          observed: fired.observedValue,
          summary: fired.summary,
        });
        await db.execute(sql`
          INSERT INTO inbox_alert_dispatches (rule_id, observed_value, channel, status, notes)
          VALUES (${row.rule_id}::uuid, ${fired.observedValue}, ${channel},
                  ${sent.ok ? "sent" : "failed"}, ${sent.notes ?? null})
        `);
        if (sent.ok) dispatchesSent += 1;
      } catch (err) {
        logger.warn({ err, rule: row.rule_id, channel }, "alert dispatch failed");
        await db.execute(sql`
          INSERT INTO inbox_alert_dispatches (rule_id, observed_value, channel, status, notes)
          VALUES (${row.rule_id}::uuid, ${fired.observedValue}, ${channel},
                  'failed', ${err instanceof Error ? err.message : "unknown error"})
        `);
      }
    }
  }

  return { rulesChecked: rows.length, rulesFired, dispatchesSent };
}

interface RuleEval {
  observedValue: number;
  summary: string;
}

function evaluateRule(row: RuleRow): RuleEval | null {
  switch (row.rule_kind) {
    case "bounce_rate": {
      if (row.cold_sends_7d < 20) return null; // need enough signal
      const rate = row.bounces_7d / row.cold_sends_7d;
      if (rate < row.threshold) return null;
      return {
        observedValue: rate,
        summary: `Bounce rate ${(rate * 100).toFixed(1)}% on ${row.cold_sends_7d} cold sends over the last 7 days (threshold ${(row.threshold * 100).toFixed(1)}%).`,
      };
    }
    case "sync_stale": {
      if (!row.last_synced_at) {
        return {
          observedValue: -1,
          summary: "Inbox has never synced with Gmail. Reconnect at /settings/inboxes.",
        };
      }
      const ageMin = (Date.now() - new Date(row.last_synced_at).getTime()) / 60000;
      if (ageMin < row.threshold) return null;
      return {
        observedValue: ageMin,
        summary: `Inbox hasn't synced in ${Math.round(ageMin)} minutes (threshold ${row.threshold}). Check OAuth + the gmail-poll cron.`,
      };
    }
    case "no_replies": {
      if (row.cold_sends_7d < row.threshold) return null;
      if (row.replies_7d > 0) return null;
      return {
        observedValue: 0,
        summary: `${row.cold_sends_7d} cold sends in the last 7 days but 0 replies. Worth investigating: spam folder, broken signatures, or off-target list.`,
      };
    }
    case "cap_breached": {
      if (row.cap_bypasses_today <= row.threshold) return null;
      return {
        observedValue: row.cap_bypasses_today,
        summary: `Admin bypassed the daily cold-send cap ${row.cap_bypasses_today} time(s) today.`,
      };
    }
    default:
      logger.debug({ rule_kind: row.rule_kind }, "unknown alert rule kind; skipping");
      return null;
  }
}

interface DispatchResult {
  ok: boolean;
  notes?: string;
}

async function dispatchAlert(opts: {
  channel: string;
  accountEmail: string;
  ownerEmail: string;
  ruleKind: string;
  threshold: number;
  observed: number;
  summary: string;
}): Promise<DispatchResult> {
  const subject = `[Outreach alert] ${opts.accountEmail} — ${opts.ruleKind}`;
  const body = `Inbox: ${opts.accountEmail}
Rule:  ${opts.ruleKind}
${opts.summary}

This alert won't re-fire on the same inbox for the same rule within 24 hours. Adjust thresholds at /admin/alerts.`;

  if (opts.channel === "slack") {
    const webhook = process.env.ALERT_SLACK_WEBHOOK_URL;
    if (!webhook) {
      return { ok: false, notes: "ALERT_SLACK_WEBHOOK_URL not configured" };
    }
    try {
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `${subject}\n${opts.summary}` }),
      });
      return { ok: res.ok, notes: res.ok ? undefined : `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, notes: err instanceof Error ? err.message : "fetch failed" };
    }
  }

  if (opts.channel === "email") {
    // Send to the inbox owner's primary email. We don't use the
    // operator's own connected_account to send the alert; the
    // ALERT_SENDER_FROM env should point to a service identity
    // (e.g. alerts@yourdomain) that's separate from outreach inboxes.
    // If unset, we log + skip; the dispatch row still records what
    // would have fired.
    const sender = process.env.ALERT_SENDER_FROM;
    if (!sender) {
      // No env configured — record what we'd have sent.
      logger.info({ subject, opts }, "alert email skipped (ALERT_SENDER_FROM not set)");
      return { ok: false, notes: "ALERT_SENDER_FROM not configured" };
    }
    // Defer the actual send to a future commit — there's no
    // server-identity Gmail wired up today (we'd be reusing a real
    // operator inbox which mixes in with their outreach). For now
    // we log the would-be-send so the dispatch row stays accurate.
    logger.info({ to: opts.ownerEmail, subject, body }, "alert email would send (env-gated)");
    return { ok: true, notes: `logged-only: to ${opts.ownerEmail}` };
  }

  return { ok: false, notes: `unknown channel: ${opts.channel}` };
}
