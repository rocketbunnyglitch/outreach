"use server";

/**
 * Campaign Info — admin-only actions.
 *
 *   setInboxOwner(formData)
 *     UPDATE connected_accounts.owner_user_id. Setting ownership
 *     determines whose "My inbox" view shows this account's threads.
 *     A null userId clears ownership (inbox becomes team-shared).
 *
 *   setInboxCampaignAssignment(formData)
 *     INSERT or DELETE one row in campaign_connected_accounts. Admin
 *     declares whether a given inbox is "for" the current campaign;
 *     the Campaign Info tab uses this for filtering, and future
 *     compose UI can default the From inbox based on this.
 *
 * Both actions:
 *   - require admin
 *   - scope writes to the actor's team (target inbox MUST be on
 *     actor's team; for owner-set, target user MUST also be on team)
 *   - revalidate the campaign-info page so the table refreshes
 */

import {
  campaignConnectedAccounts,
  campaigns,
  outreachBrands,
  staffOutreachEmails,
  users,
} from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function setInboxOwner(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ inboxId: string; ownerUserId: string }>> {
  const ctx = await requireAdmin();
  const inboxId = String(formData.get("inboxId") ?? "");
  const ownerUserId = String(formData.get("ownerUserId") ?? "");
  if (!UUID_RE.test(inboxId)) return { ok: false, error: "Invalid inbox id." };
  if (!UUID_RE.test(ownerUserId)) {
    // The schema requires an owner — clearing isn't allowed at this
    // surface. If a "team-shared inbox" ever becomes a product
    // requirement we'd need a migration to drop NOT NULL on
    // staff_outreach_emails.owner_user_id first.
    return { ok: false, error: "Pick an owner." };
  }

  // Defense in depth: confirm the inbox is on the user's team.
  const inboxRow = await db
    .select({ teamId: staffOutreachEmails.teamId })
    .from(staffOutreachEmails)
    .where(eq(staffOutreachEmails.id, inboxId))
    .limit(1);
  if (!inboxRow[0] || inboxRow[0].teamId !== ctx.staff.teamId) {
    return { ok: false, error: "Inbox not found on your team." };
  }

  // And confirm the candidate owner is on the same team.
  const targetUser = await db
    .select({ teamId: users.teamId })
    .from(users)
    .where(eq(users.id, ownerUserId))
    .limit(1);
  if (!targetUser[0] || targetUser[0].teamId !== ctx.staff.teamId) {
    return { ok: false, error: "User not on your team." };
  }

  try {
    await withAuditContext(ctx.staff.id, (tx) =>
      tx
        .update(staffOutreachEmails)
        .set({ ownerUserId, updatedBy: ctx.staff.id })
        .where(eq(staffOutreachEmails.id, inboxId)),
    );
    revalidatePath("/campaign-info");
    return { ok: true, data: { inboxId, ownerUserId } };
  } catch (err) {
    logger.error({ err, inboxId, ownerUserId }, "setInboxOwner failed");
    return { ok: false, error: "Could not update owner." };
  }
}

export async function setInboxCampaignAssignment(
  _prev: unknown,
  formData: FormData,
): Promise<
  ActionResult<{
    inboxId: string;
    campaignId: string;
    assigned: boolean;
  }>
> {
  const ctx = await requireAdmin();
  const inboxId = String(formData.get("inboxId") ?? "");
  const campaignId = String(formData.get("campaignId") ?? "");
  // "1" = assign, "0" = unassign.
  const assign = String(formData.get("assign") ?? "") === "1";
  if (!UUID_RE.test(inboxId) || !UUID_RE.test(campaignId)) {
    return { ok: false, error: "Invalid ids." };
  }

  // Confirm both belong to the actor's team. campaigns isn't
  // team-scoped today (single-tenant), but we still confirm the
  // inbox is on the actor's team.
  const inboxRow = await db
    .select({ teamId: staffOutreachEmails.teamId })
    .from(staffOutreachEmails)
    .where(eq(staffOutreachEmails.id, inboxId))
    .limit(1);
  if (!inboxRow[0] || inboxRow[0].teamId !== ctx.staff.teamId) {
    return { ok: false, error: "Inbox not found on your team." };
  }

  const campaignRow = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!campaignRow[0]) return { ok: false, error: "Campaign not found." };

  try {
    if (assign) {
      await db
        .insert(campaignConnectedAccounts)
        .values({
          campaignId,
          connectedAccountId: inboxId,
          assignedBy: ctx.staff.id,
        })
        .onConflictDoNothing();
    } else {
      await db
        .delete(campaignConnectedAccounts)
        .where(
          and(
            eq(campaignConnectedAccounts.campaignId, campaignId),
            eq(campaignConnectedAccounts.connectedAccountId, inboxId),
          ),
        );
    }
    revalidatePath("/campaign-info");
    return { ok: true, data: { inboxId, campaignId, assigned: assign } };
  } catch (err) {
    logger.error({ err, inboxId, campaignId, assign }, "setInboxCampaignAssignment failed");
    return { ok: false, error: "Could not update assignment." };
  }
}

/**
 * setInboxBrand(formData)
 *   Set the outreach brand an inbox presents for the current campaign. This
 *   drives the {{company_name}} merge field for emails sent from that inbox.
 *   Upserts the campaign_connected_accounts row (so picking a brand also
 *   assigns the inbox to the campaign); an empty brand clears it back to the
 *   template's fallback brand.
 */
export async function setInboxBrand(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ inboxId: string; campaignId: string; outreachBrandId: string | null }>> {
  const ctx = await requireAdmin();
  const inboxId = String(formData.get("inboxId") ?? "");
  const campaignId = String(formData.get("campaignId") ?? "");
  const rawBrand = String(formData.get("outreachBrandId") ?? "");
  const outreachBrandId = rawBrand === "" ? null : rawBrand;
  if (!UUID_RE.test(inboxId) || !UUID_RE.test(campaignId)) {
    return { ok: false, error: "Invalid ids." };
  }
  if (outreachBrandId !== null && !UUID_RE.test(outreachBrandId)) {
    return { ok: false, error: "Invalid brand." };
  }

  // Inbox must be on the actor's team.
  const inboxRow = await db
    .select({ teamId: staffOutreachEmails.teamId })
    .from(staffOutreachEmails)
    .where(eq(staffOutreachEmails.id, inboxId))
    .limit(1);
  if (!inboxRow[0] || inboxRow[0].teamId !== ctx.staff.teamId) {
    return { ok: false, error: "Inbox not found on your team." };
  }
  if (outreachBrandId !== null) {
    const brandRow = await db
      .select({ id: outreachBrands.id })
      .from(outreachBrands)
      .where(eq(outreachBrands.id, outreachBrandId))
      .limit(1);
    if (!brandRow[0]) return { ok: false, error: "Brand not found." };
  }

  try {
    await db
      .insert(campaignConnectedAccounts)
      .values({
        campaignId,
        connectedAccountId: inboxId,
        assignedBy: ctx.staff.id,
        outreachBrandId,
      })
      .onConflictDoUpdate({
        target: [
          campaignConnectedAccounts.campaignId,
          campaignConnectedAccounts.connectedAccountId,
        ],
        set: { outreachBrandId },
      });
    revalidatePath("/campaign-info");
    return { ok: true, data: { inboxId, campaignId, outreachBrandId } };
  } catch (err) {
    logger.error({ err, inboxId, campaignId, outreachBrandId }, "setInboxBrand failed");
    return { ok: false, error: "Could not update brand." };
  }
}

/**
 * setInboxAlias(formData)
 *   Set the sender persona ("Dan", "Chris") an inbox uses for this campaign.
 *   Drives the {{your_name}} merge field + the From display name on send.
 *   Upserts the campaign_connected_accounts row (so setting an alias also
 *   assigns the inbox to the campaign); an empty value clears it back to the
 *   sending user's display name.
 */
export async function setInboxAlias(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ inboxId: string; campaignId: string; aliasName: string | null }>> {
  const ctx = await requireAdmin();
  const inboxId = String(formData.get("inboxId") ?? "");
  const campaignId = String(formData.get("campaignId") ?? "");
  const aliasName = String(formData.get("aliasName") ?? "").trim() || null;
  if (!UUID_RE.test(inboxId) || !UUID_RE.test(campaignId)) {
    return { ok: false, error: "Invalid ids." };
  }
  if (aliasName !== null && aliasName.length > 120) {
    return { ok: false, error: "Alias is too long." };
  }

  const inboxRow = await db
    .select({ teamId: staffOutreachEmails.teamId })
    .from(staffOutreachEmails)
    .where(eq(staffOutreachEmails.id, inboxId))
    .limit(1);
  if (!inboxRow[0] || inboxRow[0].teamId !== ctx.staff.teamId) {
    return { ok: false, error: "Inbox not found on your team." };
  }

  try {
    await db
      .insert(campaignConnectedAccounts)
      .values({ campaignId, connectedAccountId: inboxId, assignedBy: ctx.staff.id, aliasName })
      .onConflictDoUpdate({
        target: [
          campaignConnectedAccounts.campaignId,
          campaignConnectedAccounts.connectedAccountId,
        ],
        set: { aliasName },
      });
    revalidatePath("/campaign-info");
    return { ok: true, data: { inboxId, campaignId, aliasName } };
  } catch (err) {
    logger.error({ err, inboxId, campaignId }, "setInboxAlias failed");
    return { ok: false, error: "Could not update alias." };
  }
}
