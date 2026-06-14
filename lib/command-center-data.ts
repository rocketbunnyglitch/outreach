import "server-only";

/**
 * Manager command center data (CRM plan C4) — PROBLEMS ONLY.
 *
 * Aggregates every "needs a decision" signal the engine produces into
 * one flat, deep-linked list: at-risk crawls (health v2), NBA
 * fire-drills, the cancellation-review queue, silent/failing crons,
 * sending-infrastructure trouble (broken inboxes, failing scheduled
 * sends), and backup status. Healthy items NEVER appear — a quiet
 * morning renders an empty list, which is the whole point.
 *
 * Read-only: composes existing loaders in check-only mode and never
 * fires notifications or writes.
 */

import { db } from "@/lib/db";
import { loadCampaignHealth } from "@/lib/health-score";
import { loadNextBestActions } from "@/lib/next-best-actions";
import { sql } from "drizzle-orm";

export interface CommandItem {
  id: string;
  severity: "red" | "yellow";
  /** Short source tag rendered as the row's chip. */
  source: "crawl" | "fire drill" | "cancellation" | "system" | "sending" | "backup";
  label: string;
  href: string;
  cta: string;
}

function rowsOf<T>(res: unknown): T[] {
  return Array.isArray(res) ? (res as T[]) : ((res as { rows?: T[] }).rows ?? []);
}

/** NBA categories that are genuine fire-drills (vs routine work). */
const FIRE_DRILL_CATEGORIES = new Set([
  "replacement_urgent",
  "lifecycle_blocker",
  "high_sales_missing_final",
  "v2_call_due",
  "warm_reply_waiting",
]);

/** A cron silent for this long is a finding (most run daily or faster). */
const CRON_SILENT_HOURS = 26;

/** Crons that legitimately run less than daily — flat 26h would
 *  false-alarm every weekend, and false alarms on a problems-only
 *  screen teach people to ignore it. Hours = expected max gap + slack. */
const CRON_MAX_SILENCE_HOURS: Record<string, number> = {
  // Runs Tue/Wed/Thu 14:00 — Fri→Tue quiet spell is ~96h by design.
  "cancellation-review": 120,
};

export async function loadCommandCenter(campaignId: string | null): Promise<CommandItem[]> {
  const items: CommandItem[] = [];

  const [health, nba, cancelRows, cronRows, sendingRows, failingDrafts] = await Promise.all([
    loadCampaignHealth(campaignId),
    campaignId ? loadNextBestActions(campaignId) : Promise.resolve([]),
    // Cancellation review, check-only (no notifications).
    import("@/lib/cancellation-review").then((m) =>
      m.runCancellationReview({ notify: false }).catch(() => null),
    ),
    // Latest run per cron: silent too long, or last run errored.
    db.execute(sql`
      SELECT DISTINCT ON (cron_name)
        cron_name AS name,
        status,
        (EXTRACT(EPOCH FROM (now() - started_at)) / 3600)::int AS hours_ago
      FROM cron_runs
      ORDER BY cron_name, started_at DESC
    `),
    // Sending infrastructure: inboxes that cannot send.
    db.execute(sql`
      SELECT email_address, status::text AS status
      FROM connected_accounts
      WHERE status::text <> 'connected'
      ORDER BY email_address
    `),
    // Scheduled sends that are erroring (stuck in the queue).
    db.execute(sql`
      SELECT count(*)::int AS n
      FROM email_drafts
      WHERE sent_at IS NULL
        AND scheduled_for IS NOT NULL
        AND send_attempts > 0
        AND last_send_error IS NOT NULL
    `),
  ]);

  // 1. At-risk crawls — health v2 already explains each in one line.
  for (const crawl of health.atRiskCrawls) {
    const why = crawl.health.blockers[0] ?? crawl.health.reasons[0] ?? "needs attention";
    items.push({
      id: `crawl:${crawl.eventId}`,
      severity: crawl.health.color === "red" ? "red" : "yellow",
      source: "crawl",
      label: `${crawl.cityName} ${crawl.label}: ${why}`,
      href: `/events/${crawl.eventId}`,
      cta: crawl.health.nextAction ?? "Open crawl",
    });
  }

  // 2. NBA fire-drills (already deduped + prioritized; cap to the top few —
  //    the full list lives on the dashboard widget).
  for (const action of nba.filter((a) => FIRE_DRILL_CATEGORIES.has(a.category)).slice(0, 6)) {
    items.push({
      id: `nba:${action.id}`,
      severity: action.category === "replacement_urgent" ? "red" : "yellow",
      source: "fire drill",
      label: action.label,
      href: action.ctaHref ?? "/",
      cta: action.ctaLabel,
    });
  }

  // 3. Cancellation-review queue.
  for (const row of cancelRows?.rows ?? []) {
    items.push({
      id: `cancel:${row.eventId}`,
      severity: "red",
      source: "cancellation",
      label: `${row.cityName ?? "Unknown city"} ${row.eventDate}: ${row.reasons[0] ?? "at cancellation risk"}`,
      href: "/crawl-support",
      cta: "Run review",
    });
  }

  // 4. System: silent or erroring crons.
  for (const c of rowsOf<{ name: string; status: string; hours_ago: number }>(cronRows)) {
    const silenceLimit = CRON_MAX_SILENCE_HOURS[c.name] ?? CRON_SILENT_HOURS;
    const silent = Number(c.hours_ago) >= silenceLimit;
    const errored = c.status === "error";
    if (!silent && !errored) continue;
    items.push({
      id: `cron:${c.name}`,
      severity: errored ? "red" : "yellow",
      source: "system",
      label: errored
        ? `Cron ${c.name} failed on its last run`
        : `Cron ${c.name} silent for ${c.hours_ago}h`,
      href: "/admin/cron-health",
      cta: "Open cron health",
    });
  }

  // 5. Sending infrastructure.
  for (const inbox of rowsOf<{ email_address: string; status: string }>(sendingRows)) {
    items.push({
      id: `inbox:${inbox.email_address}`,
      severity: "yellow",
      source: "sending",
      label: `${inbox.email_address} is ${inbox.status.replace(/_/g, " ")} — outreach from it is stalled`,
      href: "/settings/inboxes",
      cta: "Reconnect",
    });
  }
  const failing = Number(rowsOf<{ n: number }>(failingDrafts)[0]?.n ?? 0);
  if (failing > 0) {
    items.push({
      id: "drafts:failing",
      severity: "red",
      source: "sending",
      label: `${failing} scheduled send${failing > 1 ? "s are" : " is"} erroring in the queue`,
      href: "/email-queue",
      cta: "Open queue",
    });
  }

  // 6. Data-linkage integrity (FULL_AUDIT P006): a failing invariant is a
  //    decision item — the same class as the email-analytics linkage break.
  try {
    const { runIntegrityChecks } = await import("@/lib/data-integrity");
    for (const f of await runIntegrityChecks()) {
      items.push({
        id: `integrity:${f.name}`,
        severity: "yellow",
        source: "system",
        label:
          f.count === -1
            ? `Integrity check ${f.name} broke (schema drift?)`
            : `${f.count} row${f.count > 1 ? "s" : ""}: ${f.desc}`,
        href: "/admin/data-quality",
        cta: "Open data quality",
      });
    }
  } catch {
    // Integrity layer down -> the page still renders its other sources.
  }

  // 7. Backup status (configured + last run).
  try {
    const { getSheetsBackupStatus } = await import("@/app/(admin)/admin/_actions-sheets-backup");
    const backup = await getSheetsBackupStatus();
    if (!backup.configured) {
      items.push({
        id: "backup:unconfigured",
        severity: "yellow",
        source: "backup",
        label: "Sheets backup is not configured — no off-box copy of the data",
        href: "/admin/cron-health",
        cta: "Configure",
      });
    } else if (backup.lastRun && backup.lastRun.status === "error") {
      items.push({
        id: "backup:failed",
        severity: "red",
        source: "backup",
        label: `Last sheets backup FAILED: ${backup.lastRun.errorMessage ?? "unknown error"}`,
        href: "/admin/cron-health",
        cta: "Investigate",
      });
    }
  } catch {
    // Backup status unavailable — not itself a finding.
  }

  // Anti-silence monitor: components running "successfully" but producing
  // nothing (empty retrieval, never-uploaded backup, dead learning signal).
  try {
    const { runLivenessChecks } = await import("@/lib/liveness-monitor");
    for (const r of await runLivenessChecks()) {
      if (r.healthy) continue;
      items.push({
        id: `liveness:${r.component}`,
        severity: r.severity,
        source: "system",
        label: r.detail,
        href: r.href,
        cta: "Investigate",
      });
    }
  } catch {
    // Liveness checks unavailable — not itself a finding.
  }

  // Red first, then stable by source grouping.
  items.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "red" ? -1 : 1;
    return a.source.localeCompare(b.source);
  });
  return items;
}
