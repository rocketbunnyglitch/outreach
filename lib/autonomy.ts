import "server-only";

/**
 * Autonomy rails (2026-06-11): the trust ladder that lets the engine
 * EARN autonomy per action type, with humans holding the keys.
 *
 * How it works:
 *   1. Every engine proposal gets a recorded human verdict
 *      (recordActionVerdict): accepted / edited / rejected.
 *   2. /admin/autonomy shows per-action agreement rates against the
 *      graduation thresholds below.
 *   3. When an action type is ELIGIBLE, an admin may flip its policy
 *      mode (suggest -> review_window -> auto). The engine NEVER
 *      flips its own policy.
 *   4. Dispatch autonomy (the engine actually queuing/sending without
 *      a human) is NOT wired yet — and when it is, it will require
 *      AUTONOMY_DISPATCH_ENABLED=1 on the server IN ADDITION to the
 *      policy mode. Today every mode behaves like 'suggest'; only the
 *      evidence accumulates. "Engine drafts, humans send" stands.
 *
 * Graduation thresholds (deliberately conservative; refdoc 10.4's
 * "eventually, with conditions"):
 *   review_window  >= 95% non-rejected over >= 100 verdicts (30d)
 *   auto           >= 98% non-rejected over >= 300 verdicts (30d)
 */

import { actionVerdicts, autonomyPolicies } from "@/db/schema";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { eq, sql } from "drizzle-orm";

export type AutonomyActionType =
  | "classify_reply"
  | "quick_reply_chip"
  | "template_pick"
  | "cold_nudge";

export type AutonomyVerdict = "accepted" | "edited" | "rejected";
export type AutonomyMode = "suggest" | "review_window" | "auto";

export const AUTONOMY_THRESHOLDS = {
  review_window: { minAgreement: 0.95, minSamples: 100 },
  auto: { minAgreement: 0.98, minSamples: 300 },
} as const;

export const ACTION_TYPE_LABELS: Record<AutonomyActionType, string> = {
  classify_reply: "Reply classification",
  quick_reply_chip: "Suggested replies",
  template_pick: "Template pick",
  cold_nudge: "Cold cadence nudges",
};

/** Fire-and-forget verdict write — never blocks the calling flow. */
export async function recordActionVerdict(
  actionType: AutonomyActionType,
  verdict: AutonomyVerdict,
  subjectId?: string | null,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(actionVerdicts).values({
      actionType,
      verdict,
      subjectId: subjectId ?? null,
      meta: meta ?? null,
    });
  } catch (err) {
    logger.warn({ err, actionType, verdict }, "recordActionVerdict failed (non-fatal)");
  }
}

export interface AutonomyDashboardRow {
  actionType: AutonomyActionType;
  label: string;
  mode: AutonomyMode;
  reviewWindowMinutes: number;
  notes: string | null;
  samples30d: number;
  accepted30d: number;
  edited30d: number;
  rejected30d: number;
  /** Share of verdicts that were NOT rejections (accepted or edited). */
  agreementRate30d: number | null;
  eligibleFor: AutonomyMode;
}

function eligibilityFor(samples: number, agreement: number | null): AutonomyMode {
  if (agreement === null) return "suggest";
  if (
    samples >= AUTONOMY_THRESHOLDS.auto.minSamples &&
    agreement >= AUTONOMY_THRESHOLDS.auto.minAgreement
  ) {
    return "auto";
  }
  if (
    samples >= AUTONOMY_THRESHOLDS.review_window.minSamples &&
    agreement >= AUTONOMY_THRESHOLDS.review_window.minAgreement
  ) {
    return "review_window";
  }
  return "suggest";
}

export async function getAutonomyDashboard(): Promise<AutonomyDashboardRow[]> {
  const policies = await db.select().from(autonomyPolicies);
  const statsRes = await db.execute<{
    action_type: string;
    n: number;
    accepted: number;
    edited: number;
    rejected: number;
  }>(sql`
    SELECT action_type,
           count(*)::int AS n,
           count(*) FILTER (WHERE verdict = 'accepted')::int AS accepted,
           count(*) FILTER (WHERE verdict = 'edited')::int   AS edited,
           count(*) FILTER (WHERE verdict = 'rejected')::int AS rejected
    FROM action_verdicts
    WHERE created_at > now() - interval '30 days'
    GROUP BY action_type
  `);
  type StatRow = {
    action_type: string;
    n: number;
    accepted: number;
    edited: number;
    rejected: number;
  };
  const statRows: StatRow[] = Array.isArray(statsRes)
    ? (statsRes as unknown as StatRow[])
    : ((statsRes as unknown as { rows?: StatRow[] }).rows ?? []);
  const stats = new Map(statRows.map((r) => [r.action_type, r]));

  return policies
    .filter((p): p is typeof p & { actionType: AutonomyActionType } =>
      Object.hasOwn(ACTION_TYPE_LABELS, p.actionType),
    )
    .map((p) => {
      const s = stats.get(p.actionType);
      const n = Number(s?.n ?? 0);
      const rejected = Number(s?.rejected ?? 0);
      const agreement = n > 0 ? (n - rejected) / n : null;
      return {
        actionType: p.actionType as AutonomyActionType,
        label: ACTION_TYPE_LABELS[p.actionType as AutonomyActionType],
        mode: p.mode as AutonomyMode,
        reviewWindowMinutes: p.reviewWindowMinutes,
        notes: p.notes,
        samples30d: n,
        accepted30d: Number(s?.accepted ?? 0),
        edited30d: Number(s?.edited ?? 0),
        rejected30d: rejected,
        agreementRate30d: agreement,
        eligibleFor: eligibilityFor(n, agreement),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Human-only policy flip (called from the admin action with role
 *  checks already done). Never called by engine code paths. */
export async function setAutonomyMode(
  actionType: AutonomyActionType,
  mode: AutonomyMode,
  staffId: string,
): Promise<void> {
  await db
    .update(autonomyPolicies)
    .set({ mode, updatedBy: staffId, updatedAt: new Date() })
    .where(eq(autonomyPolicies.actionType, actionType));
}

/** Read a policy at a decision site. Dispatch wiring (future) must
 *  ALSO check AUTONOMY_DISPATCH_ENABLED — see isDispatchEnabled. */
export async function getAutonomyMode(actionType: AutonomyActionType): Promise<AutonomyMode> {
  const [row] = await db
    .select({ mode: autonomyPolicies.mode })
    .from(autonomyPolicies)
    .where(eq(autonomyPolicies.actionType, actionType))
    .limit(1);
  return (row?.mode as AutonomyMode | undefined) ?? "suggest";
}

/** Hard server-side gate for any future autonomous dispatch. Defaults
 *  OFF; flipping a policy to 'auto' does nothing until this is also
 *  set — defense in depth for the send boundary. */
export function isDispatchEnabled(): boolean {
  return process.env.AUTONOMY_DISPATCH_ENABLED === "1";
}
