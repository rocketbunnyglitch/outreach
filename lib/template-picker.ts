/**
 * Template auto-picker (Phase 1.4). Loads the campaign's templates and scores
 * them against a PickContext via the pure scorer (lib/template-picker-score.ts),
 * returning the best match plus alternatives for the composer's "see
 * alternatives" dropdown.
 */

import "server-only";
import { type EmailTemplate, emailTemplates } from "@/db/schema/templates";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { loadTemplateReplyRates } from "@/lib/template-reply-rates";
import { and, eq, isNull } from "drizzle-orm";
import {
  type PickContext,
  pickBest,
  priorityBand,
  rerankByReplyRate,
  scoreAndSort,
} from "./template-picker-score";

export type { PickContext };

export interface PickedTemplate {
  template: EmailTemplate;
  reason: string;
  matchScore: number; // 0-1
  alternatives: { templateCode: string; reason: string }[];
}

interface ScorableRow {
  templateCode: string;
  name: string;
  triggerContext: EmailTemplate["triggerContext"];
  autoPickPriority: number;
  row: EmailTemplate;
}

export async function pickTemplate(ctx: PickContext): Promise<PickedTemplate | null> {
  const rows = await db
    .select()
    .from(emailTemplates)
    .where(and(eq(emailTemplates.campaignId, ctx.campaignId), isNull(emailTemplates.archivedAt)));

  const scorable: ScorableRow[] = rows.map((r) => ({
    templateCode: r.templateCode,
    name: r.name,
    triggerContext: r.triggerContext,
    autoPickPriority: r.autoPickPriority,
    row: r,
  }));

  const best = pickBest(scorable, ctx);
  if (!best) return null;

  // Loop C (CRM plan E2): among templates the RULES scored identically
  // (within-stage variants), prefer the one with the better MEASURED reply
  // rate (min 20 sends per variant; 10% exploration keeps evidence flowing).
  // The rule table stays authoritative for stage — a rate can never promote
  // a template across stages, only break ties. Never blocks the pick.
  let chosenRow = best.template.row;
  let reason = best.reason;
  try {
    const scored = scoreAndSort(scorable, ctx);
    const tieCount = scored.filter((s) => s.score === (scored[0]?.score ?? -1)).length;
    if (tieCount > 1) {
      const rates = await loadTemplateReplyRates(ctx.campaignId);
      const rr = rerankByReplyRate(
        scored,
        rates,
        priorityBand(ctx.cityPriority ?? null),
        Math.random,
      );
      if (rr?.loopReason) {
        if (rr.pick.templateCode !== best.template.templateCode) {
          chosenRow = rr.pick.row;
          reason = `${rr.pick.templateCode} over ${best.template.templateCode}: ${rr.loopReason}`;
        } else {
          reason = `${reason} · ${rr.loopReason}`;
        }
      }
    }
  } catch (err) {
    logger.warn({ err, campaignId: ctx.campaignId }, "template reply-rate rerank skipped");
  }

  return {
    template: chosenRow,
    reason,
    matchScore: Math.min(1, Math.max(0, best.score / 40)),
    alternatives: best.alternatives,
  };
}
