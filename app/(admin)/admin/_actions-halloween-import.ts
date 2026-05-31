"use server";

/**
 * Admin → Halloween 2025 import actions.
 *
 * Two paths the admin page calls:
 *   - runDryRun()  — read the JSON, simulate decisions, return
 *                    a JSON report. NO writes.
 *   - runApply()   — same but with dryRun=false. Writes a
 *                    Halloween 2025 campaign + city_campaigns +
 *                    events + venue_events + cold_outreach.
 *   - generateReviewQueueMarkdown() — produces the
 *                    Claude-in-Chrome verification playbook from
 *                    a stored or computed report.
 *
 * Admin-only via requireStaff role check. All paths wrapped in
 * the operator-error system so failures emit a code the operator
 * can paste into Claude.
 */

import { requireStaff } from "@/lib/auth";
import type { ActionResult } from "@/lib/form-utils";
import {
  type ImportReport,
  runHalloween2025Import,
} from "@/lib/halloween-import/halloween-2025-import";
import {
  type ReviewQueue,
  buildReviewQueue,
  renderReviewQueueMarkdown,
} from "@/lib/halloween-import/review-queue";
import { newOpError } from "@/lib/op-error";
import { revalidatePath } from "next/cache";

export async function runHalloween2025DryRun(input?: {
  cityLimit?: number | null;
  onlySheetName?: string | null;
}): Promise<ActionResult<ImportReport>> {
  const { staff } = await requireStaff();
  if (staff.role !== "admin") return { ok: false, error: "Admin role required." };

  const op = newOpError("admin.halloween_import.dry_run");
  try {
    const report = await runHalloween2025Import({
      dryRun: true,
      cityLimit: input?.cityLimit ?? null,
      onlySheetName: input?.onlySheetName ?? null,
      staffId: staff.id,
    });
    return { ok: true, data: report };
  } catch (err) {
    op.log(err, { input });
    const detail = (err as Error)?.message ?? String(err);
    return { ok: false, error: `Dry-run failed: ${detail}`, code: op.code };
  }
}

export async function runHalloween2025Apply(input?: {
  cityLimit?: number | null;
  onlySheetName?: string | null;
}): Promise<ActionResult<ImportReport>> {
  const { staff } = await requireStaff();
  if (staff.role !== "admin") return { ok: false, error: "Admin role required." };

  const op = newOpError("admin.halloween_import.apply");
  try {
    const report = await runHalloween2025Import({
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
    op.log(err, { input });
    // Include the actual underlying error message in the response
    // so the operator can diagnose without PM2 grep. The op.code
    // still ties it back to the structured log line if they want
    // the stack.
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
export async function generateReviewQueueMarkdown(
  report: ImportReport,
): Promise<ActionResult<{ markdown: string; queue: ReviewQueue }>> {
  const { staff } = await requireStaff();
  if (staff.role !== "admin") return { ok: false, error: "Admin role required." };

  const op = newOpError("admin.halloween_import.review_queue");
  try {
    const queue = buildReviewQueue(report);
    const markdown = renderReviewQueueMarkdown(queue);
    return { ok: true, data: { markdown, queue } };
  } catch (err) {
    op.log(err, {});
    return { ok: false, error: "Couldn't build review queue.", code: op.code };
  }
}
