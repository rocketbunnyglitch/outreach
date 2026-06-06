"use server";

/**
 * Emergency replacement mode -- server-action wrappers (Phase 6.2).
 * [ReferenceDoc 7.16.3]
 *
 *   - loadEmergencyReplacementCandidates: list backup venues for the open slot
 *     so the modal can show them (and let the operator deselect).
 *   - runEmergencyReplacement: batch-draft the replacement push (review-and-send
 *     drafts; floors suspended at send time via cadenceOverrideReason).
 *
 * Both auth-gate via requireStaff and run the lib functions with the operator's
 * id + team. Triggering an emergency push is an outreach+ action (it creates
 * outbound drafts); readonly cannot.
 */

import { hasMinimumRole, requireStaff } from "@/lib/auth";
import {
  type EmergencyReplacementResult,
  type ReplacementCandidate,
  type ReplacementRole,
  loadReplacementCandidates,
  triggerEmergencyReplacement,
} from "@/lib/emergency-replacement";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { revalidatePath } from "next/cache";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES: ReplacementRole[] = ["wristband", "middle", "final", "alt_final"];

export async function loadEmergencyReplacementCandidates(
  eventId: string,
): Promise<ActionResult<{ candidates: ReplacementCandidate[] }>> {
  await requireStaff();
  if (!UUID_RE.test(eventId)) return { ok: false, error: "Invalid event id." };
  try {
    const candidates = await loadReplacementCandidates(eventId);
    return { ok: true, data: { candidates } };
  } catch (err) {
    logger.error({ err, eventId }, "loadEmergencyReplacementCandidates failed");
    return { ok: false, error: "Couldn't load backup venues." };
  }
}

export async function runEmergencyReplacement(input: {
  eventId: string;
  role: ReplacementRole;
  slotPosition?: number | null;
  reason: string;
  venueIds?: string[];
}): Promise<ActionResult<EmergencyReplacementResult>> {
  const { staff } = await requireStaff();
  if (!hasMinimumRole(staff, "outreach")) {
    return { ok: false, error: "Read-only access cannot start a replacement push." };
  }
  if (!UUID_RE.test(input.eventId)) return { ok: false, error: "Invalid event id." };
  if (!ROLES.includes(input.role)) return { ok: false, error: "Invalid slot role." };
  const reason = (input.reason ?? "").trim();
  if (reason.length < 3) {
    return { ok: false, error: "Add a short reason (at least 3 characters)." };
  }
  const venueIds = (input.venueIds ?? []).filter((id) => UUID_RE.test(id));

  try {
    const result = await triggerEmergencyReplacement({
      eventId: input.eventId,
      role: input.role,
      slotPosition: input.slotPosition ?? null,
      reason,
      staffId: staff.id,
      teamId: staff.teamId,
      venueIds: venueIds.length > 0 ? venueIds : undefined,
    });
    if (!result.ok) {
      return { ok: false, error: result.error ?? "Replacement push failed." };
    }
    revalidatePath(`/events/${input.eventId}`);
    revalidatePath("/inbox");
    return { ok: true, data: result };
  } catch (err) {
    logger.error({ err, eventId: input.eventId }, "runEmergencyReplacement failed");
    return { ok: false, error: "Replacement push failed. See server logs." };
  }
}
