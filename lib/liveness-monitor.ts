import "server-only";

/**
 * Anti-silence meta-monitor (self-correction layer).
 *
 * The dominant failure mode this system has had is NOT crashes — it's
 * components that run "successfully" while silently producing nothing:
 * retrieval returning empty for months, the offsite backup never uploading,
 * was_override stuck at 0, the funnel undercounting. A passing cron told us
 * nothing; the limb was dead.
 *
 * Each probe here asserts a liveness expectation of the form "the INPUT for X
 * exists, so X's OUTPUT must too". That framing is deliberate: it only fires on
 * genuine silence (input present, output absent), so it stays quiet pre-season
 * and during low volume — a problems screen that cries wolf gets ignored.
 *
 * Results surface on /admin/command (always-fresh pull) and the daily cron
 * pushes an admin notification when something goes silent. Add a probe whenever
 * you automate a new component: the rule is "nothing is allowed to silently do
 * nothing".
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sql } from "drizzle-orm";

function rowsOf<T>(res: unknown): T[] {
  return Array.isArray(res) ? (res as T[]) : ((res as { rows?: T[] }).rows ?? []);
}

export interface LivenessResult {
  component: string;
  healthy: boolean;
  severity: "red" | "yellow";
  /** Human sentence: what's wrong (or "ok"). */
  detail: string;
  /** Where the operator goes to act. */
  href: string;
}

/** Stamp a component heartbeat (for jobs with no other DB trace, e.g. backup). */
export async function stampHeartbeat(
  component: string,
  value?: number,
  note?: string,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO system_heartbeats (component, last_seen_at, last_value, note, updated_at)
    VALUES (${component}, now(), ${value ?? null}, ${note ?? null}, now())
    ON CONFLICT (component) DO UPDATE
      SET last_seen_at = now(), last_value = ${value ?? null}, note = ${note ?? null}, updated_at = now()
  `);
}

/** A single probe: returns a LivenessResult (healthy or not). Never throws. */
type Probe = () => Promise<LivenessResult>;

const OFFSITE_BACKUP: Probe = async () => {
  const r = rowsOf<{ age_days: number | null }>(
    await db.execute(sql`
      SELECT EXTRACT(EPOCH FROM (now() - last_seen_at)) / 86400 AS age_days
      FROM system_heartbeats WHERE component = 'backup-offsite'
    `),
  )[0];
  const ageDays = r?.age_days == null ? null : Number(r.age_days);
  const healthy = ageDays != null && ageDays < 8;
  return {
    component: "Offsite backup",
    healthy,
    severity: "red",
    detail: healthy
      ? "ok"
      : ageDays == null
        ? "No verified offsite backup recorded yet — confirm the nightly backup is uploading."
        : `No verified offsite backup in ${Math.floor(ageDays)} days.`,
    href: "/admin/command",
  };
};

const REPLY_CORPUS_GROWTH: Probe = async () => {
  const r = rowsOf<{ recent_inbound: number; corpus_age_days: number | null }>(
    await db.execute(sql`
      SELECT
        (SELECT count(*) FROM email_messages
           WHERE direction = 'inbound' AND received_at > now() - interval '7 days'
             AND from_email_normalized !~* '(mailer-daemon|postmaster|noreply|no-reply)')::int AS recent_inbound,
        (SELECT EXTRACT(EPOCH FROM (now() - max(created_at))) / 86400 FROM reply_examples) AS corpus_age_days
    `),
  )[0];
  const inbound = Number(r?.recent_inbound ?? 0);
  const ageDays = r?.corpus_age_days == null ? 999 : Number(r.corpus_age_days);
  // Input present (real inbound mail) but output frozen (corpus not grown).
  const healthy = !(inbound >= 10 && ageDays > 8);
  return {
    component: "Reply corpus extraction",
    healthy,
    severity: "red",
    detail: healthy
      ? "ok"
      : `${inbound} venue replies arrived this week but the learning corpus hasn't grown in ${Math.floor(ageDays)} days — extraction may be broken.`,
    href: "/admin/learning",
  };
};

const CLASSIFIER_OVERRIDE_SIGNAL: Probe = async () => {
  const r = rowsOf<{ n: number; overrides: number }>(
    await db.execute(sql`
      SELECT count(*)::int AS n,
             count(*) FILTER (WHERE was_override)::int AS overrides
      FROM classification_examples
      WHERE created_at > now() - interval '30 days'
    `),
  )[0];
  const n = Number(r?.n ?? 0);
  const overrides = Number(r?.overrides ?? 0);
  // Plenty of settled classifications but the "AI was wrong" signal is flat 0 —
  // exactly the bug where was_override was never written.
  const healthy = !(n >= 20 && overrides === 0);
  return {
    component: "Classifier learning signal",
    healthy,
    severity: "yellow",
    detail: healthy
      ? "ok"
      : `${n} replies were human-classified in 30 days but zero were recorded as AI corrections — the learning signal may not be writing.`,
    href: "/admin/learning",
  };
};

const RETRIEVAL_GROUNDING: Probe = async () => {
  const r = rowsOf<{ caches: number; grounded: number; corpus: number }>(
    await db.execute(sql`
      SELECT
        (SELECT count(*) FROM email_threads
           WHERE ai_quick_replies IS NOT NULL
             AND ai_quick_replies_at > now() - interval '14 days')::int AS caches,
        (SELECT count(*) FROM email_threads
           WHERE ai_quick_replies_at > now() - interval '14 days'
             AND jsonb_array_length(COALESCE(ai_quick_replies->'exampleIds', '[]'::jsonb)) > 0)::int AS grounded,
        (SELECT count(*) FROM reply_examples)::int AS corpus
    `),
  )[0];
  const caches = Number(r?.caches ?? 0);
  const grounded = Number(r?.grounded ?? 0);
  const corpus = Number(r?.corpus ?? 0);
  // Chips are being generated AND there's a corpus to retrieve from, but NONE
  // are grounded in an example — exactly the silent empty-retrieval bug.
  const healthy = !(caches >= 5 && corpus >= 20 && grounded === 0);
  return {
    component: "Suggestion retrieval",
    healthy,
    severity: "red",
    detail: healthy
      ? "ok"
      : `${caches} reply suggestions were generated but none drew on the ${corpus}-example corpus — retrieval is returning nothing.`,
    href: "/inbox",
  };
};

const PROBES: Probe[] = [
  OFFSITE_BACKUP,
  REPLY_CORPUS_GROWTH,
  CLASSIFIER_OVERRIDE_SIGNAL,
  RETRIEVAL_GROUNDING,
];

/** Run every probe; a probe that throws is reported as a yellow finding itself. */
export async function runLivenessChecks(): Promise<LivenessResult[]> {
  const out: LivenessResult[] = [];
  for (const probe of PROBES) {
    try {
      out.push(await probe());
    } catch (err) {
      logger.warn({ err }, "liveness probe threw");
      out.push({
        component: "Liveness probe",
        healthy: false,
        severity: "yellow",
        detail: "A liveness check failed to run — see logs.",
        href: "/admin/command",
      });
    }
  }
  return out;
}

export interface LivenessRunResult {
  checked: number;
  silent: number;
}

/**
 * Daily cron entry: run the checks and push ONE admin notification summarizing
 * any silent components, so the operator hears about a dead limb instead of
 * discovering it weeks later. Pull view lives on /admin/command.
 */
export async function runLivenessMonitor(): Promise<LivenessRunResult> {
  const results = await runLivenessChecks();
  const silent = results.filter((r) => !r.healthy);
  if (silent.length > 0) {
    try {
      const admins = rowsOf<{ id: string }>(
        await db.execute(sql`SELECT id FROM users WHERE role = 'admin' AND status = 'active'`),
      );
      const { emitNotification } = await import("@/app/(admin)/_actions/notifications");
      const summary = silent.map((s) => s.component).join(", ");
      for (const a of admins) {
        await emitNotification({
          staffId: a.id,
          kind: "admin_message",
          title: `${silent.length} component${silent.length === 1 ? "" : "s"} may have gone silent`,
          body: `Check on the command screen: ${summary}.`,
          linkPath: "/admin/command",
          dedupeMinutes: 720,
        });
      }
    } catch (err) {
      logger.warn({ err }, "liveness monitor notify failed");
    }
  }
  await stampHeartbeat("liveness-monitor", silent.length);
  logger.info({ checked: results.length, silent: silent.length }, "liveness monitor complete");
  return { checked: results.length, silent: silent.length };
}
