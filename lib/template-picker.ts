/**
 * Template auto-picker (Phase 1.4). Loads the campaign's templates and scores
 * them against a PickContext via the pure scorer (lib/template-picker-score.ts),
 * returning the best match plus alternatives for the composer's "see
 * alternatives" dropdown.
 */

import "server-only";
import { type EmailTemplate, emailTemplates } from "@/db/schema/templates";
import { db } from "@/lib/db";
import { and, eq, isNull } from "drizzle-orm";
import { type PickContext, pickBest } from "./template-picker-score";

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

  return {
    template: best.template.row,
    reason: best.reason,
    matchScore: Math.min(1, Math.max(0, best.score / 40)),
    alternatives: best.alternatives,
  };
}
