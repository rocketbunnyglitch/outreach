"use server";

/**
 * Worklist server actions (Phase 2.4+).
 *
 * draftCadenceTouchNow: "Draft now" on a follow-up row -- pulls forward the
 * cadence touch the daily cron would otherwise generate later, for one thread.
 * Team-scoped. Generating pauses the thread + creates a review draft, which then
 * surfaces in the Drafts section.
 */

import { connectedAccounts, emailThreads } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { generateCadenceDraftForThread } from "@/lib/cadence-advance";
import { db } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function draftCadenceTouchNow(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ generated: boolean }>> {
  const { staff } = await requireStaff();
  const threadId = String(formData.get("threadId") ?? "");
  if (!UUID_RE.test(threadId)) return { ok: false, error: "Invalid thread id." };

  // Team-scope: the thread's inbox must be on the operator's team.
  const [row] = await db
    .select({ teamId: connectedAccounts.teamId })
    .from(emailThreads)
    .innerJoin(connectedAccounts, eq(connectedAccounts.id, emailThreads.staffOutreachEmailId))
    .where(eq(emailThreads.id, threadId))
    .limit(1);
  if (!row || row.teamId !== staff.teamId) {
    return { ok: false, error: "Thread not on your team." };
  }

  try {
    const generated = await generateCadenceDraftForThread(threadId);
    revalidatePath("/worklist");
    if (!generated) {
      return {
        ok: false,
        error:
          "Could not draft this touch yet (the thread is missing a campaign, template, or venue email).",
      };
    }
    return { ok: true, data: { generated } };
  } catch (err) {
    logger.error({ err, threadId }, "draftCadenceTouchNow failed");
    return { ok: false, error: "Could not generate the draft." };
  }
}
