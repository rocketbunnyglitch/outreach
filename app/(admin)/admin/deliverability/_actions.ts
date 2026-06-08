"use server";

import { connectedAccounts } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { autoPauseAtRiskInboxes } from "@/lib/inbox-deliverability";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

/** Pause or resume COLD sends from an inbox (team-scoped, admin-only). */
export async function setInboxPaused(inboxId: string, paused: boolean): Promise<{ ok: boolean }> {
  const ctx = await requireAdmin();
  await db
    .update(connectedAccounts)
    .set({ coldSendsPaused: paused, updatedAt: new Date() })
    .where(and(eq(connectedAccounts.id, inboxId), eq(connectedAccounts.teamId, ctx.staff.teamId)));
  revalidatePath("/admin/deliverability");
  return { ok: true };
}

/** (Re)start the warm-up ramp on an inbox -- resets its cold cap to the floor. */
export async function startInboxWarmup(inboxId: string): Promise<{ ok: boolean }> {
  const ctx = await requireAdmin();
  await db
    .update(connectedAccounts)
    .set({ warmupStartedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(connectedAccounts.id, inboxId), eq(connectedAccounts.teamId, ctx.staff.teamId)));
  revalidatePath("/admin/deliverability");
  return { ok: true };
}

/** Clear warm-up on an inbox (jump to full configured cap). */
export async function clearInboxWarmup(inboxId: string): Promise<{ ok: boolean }> {
  const ctx = await requireAdmin();
  await db
    .update(connectedAccounts)
    .set({ warmupStartedAt: null, updatedAt: new Date() })
    .where(and(eq(connectedAccounts.id, inboxId), eq(connectedAccounts.teamId, ctx.staff.teamId)));
  revalidatePath("/admin/deliverability");
  return { ok: true };
}

/** Auto-pause every at-risk inbox (bounce/complaint rate over the limit). */
export async function autoPauseRisky(): Promise<{ ok: boolean; paused: string[] }> {
  const ctx = await requireAdmin();
  const paused = await autoPauseAtRiskInboxes(ctx.staff.teamId);
  revalidatePath("/admin/deliverability");
  return { ok: true, paused };
}
