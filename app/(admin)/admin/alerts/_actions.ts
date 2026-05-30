"use server";

/**
 * /admin/alerts server actions — upsert + delete inbox alert rules.
 *
 * Per spec these are admin-only (requireAdmin). The page lists every
 * connected_account in the team along with each account's configured
 * rules; admin picks (inbox, rule_kind, threshold, channels) and the
 * action upserts via the unique (account, rule_kind) index.
 */

import { inboxAlertRules } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { withAuditContext } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const VALID_KINDS = new Set(["bounce_rate", "sync_stale", "no_replies", "cap_breached"]);
const VALID_CHANNELS = new Set(["email", "slack"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function upsertAlertRule(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireAdmin();
  const accountId = String(formData.get("connectedAccountId") ?? "");
  const ruleKind = String(formData.get("ruleKind") ?? "");
  const thresholdStr = String(formData.get("threshold") ?? "");
  const channelsRaw = formData.getAll("channels").map((v) => String(v));
  const enabled = formData.get("enabled") !== "0";

  if (!UUID_RE.test(accountId)) {
    return { ok: false, error: "Invalid inbox id." };
  }
  if (!VALID_KINDS.has(ruleKind)) {
    return { ok: false, error: `Unknown rule kind: ${ruleKind}` };
  }
  const threshold = Number(thresholdStr);
  if (!Number.isFinite(threshold) || threshold < 0) {
    return { ok: false, error: "Threshold must be a non-negative number." };
  }
  const channels = channelsRaw.filter((c) => VALID_CHANNELS.has(c));
  if (channels.length === 0) {
    return { ok: false, error: "Pick at least one channel." };
  }

  try {
    const id = await withAuditContext(staff.id, async (tx) => {
      // Drizzle's onConflictDoUpdate on the unique index. We re-set
      // every editable field so a re-submit with new values overwrites.
      const [row] = await tx
        .insert(inboxAlertRules)
        .values({
          connectedAccountId: accountId,
          ruleKind,
          threshold: String(threshold),
          enabled,
          channels,
        })
        .onConflictDoUpdate({
          target: [inboxAlertRules.connectedAccountId, inboxAlertRules.ruleKind],
          set: {
            threshold: String(threshold),
            enabled,
            channels,
            updatedAt: new Date(),
          },
        })
        .returning({ id: inboxAlertRules.id });
      return row?.id ?? "";
    });
    revalidatePath("/admin/alerts");
    return { ok: true, data: { id } };
  } catch (err) {
    logger.error({ err }, "upsertAlertRule failed");
    return { ok: false, error: "Couldn't save alert rule." };
  }
}

export async function deleteAlertRule(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireAdmin();
  const ruleId = String(formData.get("ruleId") ?? "");
  if (!UUID_RE.test(ruleId)) {
    return { ok: false, error: "Invalid rule id." };
  }
  try {
    await withAuditContext(staff.id, async (tx) => {
      await tx.delete(inboxAlertRules).where(eq(inboxAlertRules.id, ruleId));
    });
    revalidatePath("/admin/alerts");
    return { ok: true, data: { id: ruleId } };
  } catch (err) {
    logger.error({ err }, "deleteAlertRule failed");
    return { ok: false, error: "Couldn't delete alert rule." };
  }
}
