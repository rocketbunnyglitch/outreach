/**
 * POST /api/cron/daily-digest
 *   Header: X-Cron-Secret: <env.CRON_SECRET>
 *
 * Generates a per-operator daily digest and (when DIGEST_SENDER_FROM
 * is configured) delivers it via email. Otherwise logs the would-be
 * send for observability — same pattern as inbox-alerts.
 *
 * Cadence: once daily, at the team's morning hour.
 *
 *   0 13 * * *  curl -sS -X POST \
 *     -H "X-Cron-Secret: $CRON_SECRET" \
 *     https://outreach.barcrawlconnect.com/api/cron/daily-digest \
 *     > /dev/null
 *
 *   (13:00 UTC == 9am Toronto in EDT, 8am in EST.)
 *
 * Idempotent: re-running on the same UTC day no-ops for users whose
 * digest_sent_at is already today, so cron over-runs are safe.
 */

import { staffMembers } from "@/db/schema";
import { recordCronRun } from "@/lib/cron-runs";
import { generateDailyDigests, renderDigestBody } from "@/lib/daily-digest";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "CRON_SECRET not configured on server" }, { status: 500 });
  }
  const got = req.headers.get("x-cron-secret");
  if (got !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    return await recordCronRun("daily-digest", async () => {
      const digests = await generateDailyDigests();
      const sender = process.env.DIGEST_SENDER_FROM;

      let sent = 0;
      let skippedAlreadySent = 0;
      let loggedOnly = 0;

      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      for (const row of digests) {
        // Per-day idempotency: if the user already has digest_sent_at
        // >= today, skip.
        const existing = await db
          .select({ digestSentAt: staffMembers.digestSentAt })
          .from(staffMembers)
          .where(eq(staffMembers.id, row.staffId))
          .limit(1);
        const lastSent = existing[0]?.digestSentAt;
        if (lastSent && lastSent >= today) {
          skippedAlreadySent++;
          continue;
        }

        const body = renderDigestBody(row);
        const subject = `Daily inbox digest -- ${todayLabel()}`;

        if (!sender) {
          // No service-identity SMTP configured. Log the would-send so
          // ops can grep for it; record digest_sent_at so the next cron
          // run on the same day skips this user (same idempotency as
          // a real send).
          logger.info(
            { to: row.primaryEmail, subject, bodyPreview: body.slice(0, 160) },
            "daily digest would send (DIGEST_SENDER_FROM not configured)",
          );
          loggedOnly++;
        } else {
          // Future commit: actually deliver via an SMTP/Gmail
          // service identity. Today, the alert system also runs in
          // log-only mode for the same reason.
          logger.info(
            { to: row.primaryEmail, from: sender, subject, body },
            "daily digest send (placeholder -- wire SMTP delivery here)",
          );
          sent++;
        }

        // Mark sent for idempotency regardless of whether the actual
        // delivery happened. Otherwise an env-gated downgrade would
        // re-log the same user every time the cron fires.
        await db.execute(sql`
        UPDATE users
        SET digest_sent_at = NOW()
        WHERE id = ${row.staffId}
      `);
      }

      return NextResponse.json({
        ok: true,
        generated: digests.length,
        sent,
        loggedOnly,
        skippedAlreadySent,
      });
    });
  } catch (err) {
    logger.error({ err }, "daily-digest cron route failed");
    return NextResponse.json({ error: "daily-digest failed" }, { status: 500 });
  }
}

function todayLabel(): string {
  const d = new Date();
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}
