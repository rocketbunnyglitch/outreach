import "server-only";

/**
 * Measured template reply rates (CRM plan E2 / Loop C) — the data side
 * of rerankByReplyRate. Same attribution the learning report uses:
 * a send "got a reply" when its thread saw an inbound AFTER the send.
 * Grouped per template code per priority band (P1-2 high, P3-4 mid,
 * P5-6 low) plus an all-band total for the fallback.
 */

import { db } from "@/lib/db";
import { type PriorityBand, type ReplyRateTable, priorityBand } from "@/lib/template-picker-score";
import { sql } from "drizzle-orm";

type RateRow = {
  code: string;
  priority: number;
  sends: number;
  replied: number;
};

function rowsOf<T>(res: unknown): T[] {
  return Array.isArray(res) ? (res as T[]) : ((res as { rows?: T[] }).rows ?? []);
}

export async function loadTemplateReplyRates(campaignId: string): Promise<ReplyRateTable> {
  const rows = rowsOf<RateRow>(
    await db.execute(sql`
      SELECT et.template_code AS code,
             cc.priority::int AS priority,
             count(*)::int AS sends,
             count(*) FILTER (WHERE t.last_inbound_at > se.sent_at)::int AS replied
      FROM email_send_events se
      JOIN email_templates et ON et.id = se.template_id
      JOIN email_threads t ON t.id = se.thread_id
      JOIN city_campaigns cc ON cc.id = t.city_campaign_id
      WHERE cc.campaign_id = ${campaignId}::uuid
      GROUP BY et.template_code, cc.priority
    `),
  );

  const table: ReplyRateTable = new Map();
  for (const r of rows) {
    const entry = table.get(r.code) ?? { byBand: {}, all: { sends: 0, replied: 0 } };
    const band = priorityBand(Number(r.priority)) as PriorityBand;
    const bandStats = entry.byBand[band] ?? { sends: 0, replied: 0 };
    bandStats.sends += Number(r.sends);
    bandStats.replied += Number(r.replied);
    entry.byBand[band] = bandStats;
    entry.all.sends += Number(r.sends);
    entry.all.replied += Number(r.replied);
    table.set(r.code, entry);
  }
  return table;
}
