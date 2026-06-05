"use server";

/**
 * Worklist server actions (Phase 2.4+).
 *
 * draftCadenceTouchNow: "Draft now" on a follow-up row -- pulls forward the
 * cadence touch the daily cron would otherwise generate later, for one thread.
 * Team-scoped. Generating pauses the thread + creates a review draft, which then
 * surfaces in the Drafts section.
 */

import { connectedAccounts, emailThreads, venueDomainRelationships } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { generateCadenceDraftForThread } from "@/lib/cadence-advance";
import { db, withAuditContext } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const POST_EVENT_STATUSES = ["good", "neutral", "bad"] as const;

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

/**
 * Phase 3.12: record the post-event venue x brand relationship flag from the
 * worklist prompt. Upserts venue_domain_relationships with set_by=post_event_flag;
 * a 'bad' flag decays after a year (7.16.4), others never auto-clear.
 */
export async function setPostEventRelationshipFlag(input: {
  venueId: string;
  brandId: string;
  status: (typeof POST_EVENT_STATUSES)[number];
  notes?: string;
}): Promise<ActionResult<{ ok: true }>> {
  const { staff } = await requireStaff();
  if (!UUID_RE.test(input.venueId) || !UUID_RE.test(input.brandId)) {
    return { ok: false, error: "Invalid id." };
  }
  if (!POST_EVENT_STATUSES.includes(input.status)) return { ok: false, error: "Pick a status." };
  const notes = input.notes?.trim() || null;
  try {
    const now = new Date();
    const autoClearAt = input.status === "bad" ? new Date(now.getTime() + ONE_YEAR_MS) : null;
    await withAuditContext(staff.id, async (tx) => {
      await tx
        .insert(venueDomainRelationships)
        .values({
          venueId: input.venueId,
          outreachBrandId: input.brandId,
          status: input.status,
          setBy: "post_event_flag",
          setByStaffId: staff.id,
          notes,
          autoClearAt,
        })
        .onConflictDoUpdate({
          target: [venueDomainRelationships.venueId, venueDomainRelationships.outreachBrandId],
          set: {
            status: input.status,
            setBy: "post_event_flag",
            setByStaffId: staff.id,
            notes,
            setAt: now,
            autoClearAt,
          },
        });
    });
    revalidatePath("/worklist");
    revalidatePath(`/venues/${input.venueId}`);
    return { ok: true, data: { ok: true } };
  } catch (err) {
    logger.error({ err, venueId: input.venueId }, "setPostEventRelationshipFlag failed");
    return { ok: false, error: "Couldn't save the flag." };
  }
}
