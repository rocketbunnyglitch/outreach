"use server";

/**
 * Admin → Campaign import actions, generic for all 6 campaigns.
 *
 * Two paths the admin panels call:
 *   - runCampaignDryRun(slug)  — simulate decisions, return JSON
 *                                report. NO writes.
 *   - runCampaignApply(slug)   — same but with dryRun=false. Writes
 *                                campaign + city_campaigns + events
 *                                + venue_events + cold_outreach.
 *   - generateCampaignReviewQueue(slug, report) — produces the
 *                                Claude-in-Chrome verification
 *                                playbook from a stored report.
 *
 * Admin-only via requireStaff role check. All paths wrapped in
 * the operator-error system so failures emit a code the operator
 * can paste into Claude.
 *
 * Slug must match a config in lib/import/campaigns.ts. Unknown
 * slugs return a structured error rather than crashing.
 */

import { hasMinimumRole, requireStaff } from "@/lib/auth";
import type { ActionResult } from "@/lib/form-utils";
import { getCampaignConfig } from "@/lib/import/campaigns";
import { type ImportReport, runCampaignImport } from "@/lib/import/generic-campaign-import";
import {
  type ReviewQueue,
  buildReviewQueue,
  renderReviewQueueMarkdown,
} from "@/lib/import/review-queue";
import { newOpError } from "@/lib/op-error";
import { revalidatePath } from "next/cache";

export async function runCampaignDryRun(
  slug: string,
  input?: {
    cityLimit?: number | null;
    onlySheetName?: string | null;
  },
): Promise<ActionResult<ImportReport>> {
  const op = newOpError("admin.campaign_import.dry_run");
  try {
    const { staff } = await requireStaff();
    if (!hasMinimumRole(staff, "admin")) {
      return { ok: false, error: "Admin role required.", code: op.code };
    }

    const config = getCampaignConfig(slug);
    if (!config) {
      return { ok: false, error: `Unknown campaign slug: ${slug}`, code: op.code };
    }

    const report = await runCampaignImport(config, {
      dryRun: true,
      cityLimit: input?.cityLimit ?? null,
      onlySheetName: input?.onlySheetName ?? null,
      staffId: staff.id,
    });
    return { ok: true, data: report };
  } catch (err) {
    op.log(err, { input, slug });
    const detail = (err as Error)?.message ?? String(err);
    return { ok: false, error: `Dry-run failed: ${detail}`, code: op.code };
  }
}

export async function runCampaignApply(
  slug: string,
  input?: {
    cityLimit?: number | null;
    onlySheetName?: string | null;
  },
): Promise<ActionResult<ImportReport>> {
  const op = newOpError("admin.campaign_import.apply");
  try {
    const { staff } = await requireStaff();
    if (!hasMinimumRole(staff, "admin")) {
      return { ok: false, error: "Admin role required.", code: op.code };
    }

    const config = getCampaignConfig(slug);
    if (!config) {
      return { ok: false, error: `Unknown campaign slug: ${slug}`, code: op.code };
    }

    const report = await runCampaignImport(config, {
      dryRun: false,
      cityLimit: input?.cityLimit ?? null,
      onlySheetName: input?.onlySheetName ?? null,
      staffId: staff.id,
    });
    // Many surfaces depend on campaign + city_campaign + venue
    // rows. Revalidate the admin shell + city-campaigns root —
    // the operator's next click on either picks up the new data.
    revalidatePath("/admin");
    revalidatePath("/city-campaigns");
    return { ok: true, data: report };
  } catch (err) {
    op.log(err, { input, slug });
    const detail = (err as Error)?.message ?? String(err);
    return {
      ok: false,
      error: `Import apply failed: ${detail}`,
      code: op.code,
    };
  }
}

/**
 * Builds the Claude-in-Chrome review-queue markdown for a given
 * report. The admin page sends back the previously-computed
 * report so we don't re-run the dry-run when the operator just
 * wants the markdown.
 */
export async function generateCampaignReviewQueue(
  slug: string,
  report: ImportReport,
): Promise<ActionResult<{ markdown: string; queue: ReviewQueue }>> {
  const op = newOpError("admin.campaign_import.review_queue");
  try {
    const { staff } = await requireStaff();
    if (!hasMinimumRole(staff, "admin")) {
      return { ok: false, error: "Admin role required.", code: op.code };
    }

    if (!getCampaignConfig(slug)) {
      return { ok: false, error: `Unknown campaign slug: ${slug}`, code: op.code };
    }

    if (!report || typeof report !== "object") {
      return {
        ok: false,
        error: "Invalid report — re-run dry-run first.",
        code: op.code,
      };
    }
    if (!Array.isArray(report.decisions)) {
      return {
        ok: false,
        error: "Report has no decisions array — re-run dry-run first.",
        code: op.code,
      };
    }

    const queue = buildReviewQueue(report);
    const markdown = renderReviewQueueMarkdown(queue);
    return { ok: true, data: { markdown, queue } };
  } catch (err) {
    op.log(err, { slug });
    const detail = (err as Error)?.message ?? String(err);
    return {
      ok: false,
      error: `Couldn't build review queue: ${detail}`,
      code: op.code,
    };
  }
}
