import "server-only";

/**
 * Shadow ledger writer + reader (autonomy roadmap Phase A).
 *
 * recordEngineDecision()  — called when the engine autonomously drafts a touch.
 * closeEngineDecision()    — called when the human sends or discards that draft.
 * autonomyReadiness()      — agreement-by-touch-class: the metric that says
 *                            "the engine and humans agree 94% on cold T1, so
 *                            that tier is a candidate for auto-send".
 *
 * Recording is always best-effort and never blocks the draft/send path.
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sql } from "drizzle-orm";

function rowsOf<T>(res: unknown): T[] {
  return Array.isArray(res) ? (res as T[]) : ((res as { rows?: T[] }).rows ?? []);
}

export interface RecordDecisionInput {
  draftId: string;
  threadId?: string | null;
  venueId?: string | null;
  campaignId?: string | null;
  kind: "cold_touch" | "lifecycle" | "reply" | "other";
  templateCode?: string | null;
  confidence: number;
  factors?: Record<string, number>;
  engineBodyLen: number;
}

export async function recordEngineDecision(input: RecordDecisionInput): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO engine_decisions
        (draft_id, thread_id, venue_id, campaign_id, decision_kind, template_code,
         confidence, confidence_factors, engine_body_len)
      VALUES (
        ${input.draftId}::uuid, ${input.threadId ?? null}, ${input.venueId ?? null},
        ${input.campaignId ?? null}, ${input.kind}, ${input.templateCode ?? null},
        ${Math.round(input.confidence)},
        ${input.factors ? JSON.stringify(input.factors) : null}::jsonb,
        ${input.engineBodyLen}
      )
    `);
  } catch (err) {
    logger.warn({ err, draftId: input.draftId }, "engine-decisions: record failed (non-fatal)");
  }
}

/**
 * Close a pending decision when the human acts. `sentBodyLen` present = sent
 * (agreement estimated from how much the body length changed); undefined =
 * discarded (agreement 0). Length delta is a crude but honest proxy for "did
 * the human send roughly what the engine drafted".
 */
export async function closeEngineDecision(args: {
  draftId: string;
  sentBodyLen?: number;
  decidedBy?: string | null;
}): Promise<void> {
  try {
    if (args.sentBodyLen == null) {
      await db.execute(sql`
        UPDATE engine_decisions
        SET outcome = 'discarded', agreement = 0, decided_at = now(),
            decided_by = ${args.decidedBy ?? null}
        WHERE draft_id = ${args.draftId}::uuid AND outcome = 'pending'
      `);
      return;
    }
    await db.execute(sql`
      UPDATE engine_decisions
      SET agreement = GREATEST(0, 1 - (abs(${args.sentBodyLen} - COALESCE(engine_body_len, ${args.sentBodyLen}))::numeric
                                       / GREATEST(COALESCE(engine_body_len, 1), 1))),
          outcome = CASE
            WHEN abs(${args.sentBodyLen} - COALESCE(engine_body_len, ${args.sentBodyLen}))::numeric
                 / GREATEST(COALESCE(engine_body_len, 1), 1) <= 0.1 THEN 'sent_unchanged'
            ELSE 'sent_edited'
          END,
          decided_at = now(),
          decided_by = ${args.decidedBy ?? null}
      WHERE draft_id = ${args.draftId}::uuid AND outcome = 'pending'
    `);
  } catch (err) {
    logger.warn({ err, draftId: args.draftId }, "engine-decisions: close failed (non-fatal)");
  }
}

export interface ReadinessRow {
  kind: string;
  total: number;
  decided: number;
  avgConfidence: number;
  /** % of DECIDED drafts the human sent (not discarded). */
  sendRate: number;
  /** Mean agreement (0-1) across sent drafts — how closely humans matched the engine. */
  agreement: number;
}

/** Agreement-by-touch-class over the trailing window. The autonomy-readiness metric. */
export async function autonomyReadiness(days = 30): Promise<ReadinessRow[]> {
  return rowsOf<ReadinessRow>(
    await db.execute(sql`
      SELECT
        decision_kind AS kind,
        count(*)::int AS total,
        count(*) FILTER (WHERE outcome <> 'pending')::int AS decided,
        round(avg(confidence))::int AS "avgConfidence",
        COALESCE(round(
          count(*) FILTER (WHERE outcome IN ('sent_unchanged','sent_edited'))::numeric
          / NULLIF(count(*) FILTER (WHERE outcome <> 'pending'), 0), 2), 0)::float AS "sendRate",
        COALESCE(round(avg(agreement) FILTER (WHERE outcome IN ('sent_unchanged','sent_edited')), 2), 0)::float AS agreement
      FROM engine_decisions
      WHERE created_at > now() - (${days} || ' days')::interval
      GROUP BY decision_kind
      ORDER BY decided DESC
    `),
  );
}
