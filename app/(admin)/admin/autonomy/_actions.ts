"use server";

/**
 * Admin-only autonomy policy flips (trust ladder, 2026-06-11).
 * Humans hold the keys: the engine never calls this. Flipping a mode
 * today changes NOTHING in behavior (dispatch wiring is deliberately
 * unbuilt + env-gated); it records intent and will take effect when
 * the dispatch hook lands after the evidence review.
 */

import { hasMinimumRole, requireStaff } from "@/lib/auth";
import {
  ACTION_TYPE_LABELS,
  type AutonomyActionType,
  type AutonomyMode,
  setAutonomyMode,
} from "@/lib/autonomy";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { revalidatePath } from "next/cache";

const MODES = new Set(["suggest", "review_window", "auto"]);

export async function updateAutonomyMode(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ actionType: string; mode: string }>> {
  const { staff } = await requireStaff();
  if (!hasMinimumRole(staff, "admin")) {
    return { ok: false, error: "Admins only." };
  }
  const actionType = String(formData.get("actionType") ?? "");
  const mode = String(formData.get("mode") ?? "");
  if (!Object.hasOwn(ACTION_TYPE_LABELS, actionType) || !MODES.has(mode)) {
    return { ok: false, error: "Invalid policy payload." };
  }
  try {
    await setAutonomyMode(actionType as AutonomyActionType, mode as AutonomyMode, staff.id);
    logger.info({ actionType, mode, staffId: staff.id }, "autonomy policy updated by admin");
    revalidatePath("/admin/autonomy");
    return { ok: true, data: { actionType, mode } };
  } catch (err) {
    logger.error({ err, actionType, mode }, "updateAutonomyMode failed");
    return { ok: false, error: "Couldn't update the policy." };
  }
}
