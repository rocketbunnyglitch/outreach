/**
 * POST /api/cron/relationship-decay
 *   Header: X-Cron-Secret: <env.CRON_SECRET>
 *
 * Phase 3.11. Auto-clears venue x brand relationship flags that have been 'bad'
 * for over a year (Reference Doc 3.3 -- bad relationships decay after ~1 year).
 * Recommended cadence: once daily.
 *
 *   17 4 * * * curl -sS -X POST \
 *     -H "X-Cron-Secret: $CRON_SECRET" \
 *     https://outreach.barcrawlconnect.com/api/cron/relationship-decay \
 *     > /dev/null
 *
 * Idempotent -- once a flag is cleared it no longer matches the WHERE.
 */

import { recordCronRun } from "@/lib/cron-runs";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "CRON_SECRET not configured on server" }, { status: 500 });
  }
  if (req.headers.get("x-cron-secret") !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    return await recordCronRun("relationship-decay", async () => {
      const res = await db.execute(sql`
        UPDATE venue_domain_relationships
        SET status = 'no_history',
            set_by = 'auto_inbound',
            auto_clear_at = NULL,
            set_at = now(),
            notes = COALESCE(notes, '') || ' [auto-cleared after 1 year]'
        WHERE status = 'bad' AND auto_clear_at IS NOT NULL AND auto_clear_at < now()
      `);
      const cleared = (res as unknown as { rowCount?: number }).rowCount ?? 0;
      return NextResponse.json({ ok: true, cleared });
    });
  } catch (err) {
    logger.error({ err }, "relationship-decay cron route failed");
    return NextResponse.json({ error: "relationship-decay failed" }, { status: 500 });
  }
}
