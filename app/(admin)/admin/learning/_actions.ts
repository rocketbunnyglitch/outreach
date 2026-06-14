"use server";

/**
 * Server actions for the template-proposal engine on /admin/learning.
 * Admin-only. The engine proposes; the operator promotes or dismisses.
 */

import { requireAdmin } from "@/lib/auth";
import { getCurrentCampaign } from "@/lib/current-campaign";
import {
  dismissProposal,
  generateTemplateProposals,
  promoteProposal,
} from "@/lib/template-proposals";
import { revalidatePath } from "next/cache";

export async function generateProposalsAction(): Promise<{
  ok: boolean;
  created?: number;
  considered?: number;
  error?: string;
}> {
  const ctx = await requireAdmin();
  const current = await getCurrentCampaign();
  if (!current) return { ok: false, error: "No campaign selected." };
  const res = await generateTemplateProposals({
    campaignId: current.campaign.id,
    byUserId: ctx.staff.id,
  });
  revalidatePath("/admin/learning");
  return res;
}

export async function promoteProposalAction(
  proposalId: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireAdmin();
  const res = await promoteProposal({ proposalId, byUserId: ctx.staff.id });
  revalidatePath("/admin/learning");
  return { ok: res.ok, error: res.error };
}

export async function dismissProposalAction(proposalId: string): Promise<{ ok: boolean }> {
  const ctx = await requireAdmin();
  const res = await dismissProposal({ proposalId, byUserId: ctx.staff.id });
  revalidatePath("/admin/learning");
  return res;
}
