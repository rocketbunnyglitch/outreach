/**
 * POST /api/cron/notification-escalation
 *   Header: X-Cron-Secret: <env.CRON_SECRET>
 *
 * Phase 4.6. Escalates cancellation (and any escalate_after-tagged) alerts that
 * haven't been acknowledged by their deadline -- bumps them to the recipient's
 * campaign manager. Recommended cadence: every 15 minutes.
 *
 *   *\/15 * * * * curl -sS -X POST -H "X-Cron-Secret: $CRON_SECRET" \
 *     http://127.0.0.1:3001/api/cron/notification-escalation > /dev/null
 */

import { emitNotification } from "@/app/(admin)/_actions/notifications";
import { notifications, staffMembers } from "@/db/schema";
import { recordCronRun } from "@/lib/cron-runs";
import { db } from "@/lib/db";
import { resolveEngineRole } from "@/lib/engine-roles";
import { logger } from "@/lib/logger";
import { and, eq, isNull, sql } from "drizzle-orm";
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
    return await recordCronRun("notification-escalation", async () => {
      const due = await db
        .select({
          id: notifications.id,
          staffId: notifications.staffId,
          title: notifications.title,
          body: notifications.body,
          linkPath: notifications.linkPath,
        })
        .from(notifications)
        .where(
          and(
            sql`${notifications.escalateAfter} < now()`,
            isNull(notifications.acknowledgedAt),
            isNull(notifications.escalatedAt),
          ),
        )
        .limit(200);

      let escalated = 0;
      for (const n of due) {
        const [u] = await db
          .select({ teamId: staffMembers.teamId })
          .from(staffMembers)
          .where(eq(staffMembers.id, n.staffId))
          .limit(1);
        const managerId = u?.teamId ? await resolveEngineRole(u.teamId, "campaign_manager") : null;
        if (managerId && managerId !== n.staffId) {
          await emitNotification({
            staffId: managerId,
            kind: "admin_message",
            title: `Escalated: ${n.title}`,
            body: `Unacknowledged past its window. ${n.body ?? ""}`.trim(),
            linkPath: n.linkPath,
            dedupeMinutes: 0,
          });
          escalated += 1;
        }
        await db
          .update(notifications)
          .set({ escalatedAt: new Date() })
          .where(eq(notifications.id, n.id));
      }
      return NextResponse.json({ ok: true, scanned: due.length, escalated });
    });
  } catch (err) {
    logger.error({ err }, "notification-escalation cron route failed");
    return NextResponse.json({ error: "notification-escalation failed" }, { status: 500 });
  }
}
