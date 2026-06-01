"use server";

/**
 * Inbox: attach one venue to MANY unmatched threads in a single action.
 *
 * Triage helper for the /inbox?unmatched=1 view. An operator selects several
 * unmatched threads (all venue_id IS NULL) and picks one venue to attach to
 * every selected thread at once, instead of attaching them one at a time.
 *
 * Implementation delegates to attachVenueToThread (in _attach-venue-action.ts)
 * once per thread, so each thread gets the identical ownership validation,
 * alternate_emails auto-learning, and retroactive cross-thread linking that a
 * single attach does. We deliberately do NOT re-implement that logic here so
 * the two paths can never drift apart.
 */

import { requireStaff } from "@/lib/auth";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { attachVenueToThread } from "./_attach-venue-action";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function bulkAttachVenueToThreads(
  _prev: unknown,
  formData: FormData,
): Promise<
  ActionResult<{
    /** Selected threads successfully attached to the venue. */
    attached: number;
    /** Selected threads skipped (not on the operator's team, not found,
     *  or errored). */
    skipped: number;
    /** Extra OTHER threads linked by the per-thread retroactive sweep,
     *  summed across the batch (may overlap with the explicit selection
     *  when several selected threads share a sender). */
    retroactivelyAttached: number;
  }>
> {
  await requireStaff();

  const venueId = String(formData.get("venueId") ?? "");
  const threadIdsRaw = String(formData.get("threadIds") ?? "");
  if (!UUID_RE.test(venueId)) {
    return { ok: false, error: "Invalid venue." };
  }

  // De-dupe + validate every id is a UUID before touching the DB.
  const threadIds = Array.from(
    new Set(
      threadIdsRaw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => UUID_RE.test(s)),
    ),
  );
  if (threadIds.length === 0) {
    return { ok: false, error: "No valid threads selected." };
  }

  let attached = 0;
  let skipped = 0;
  let retroactivelyAttached = 0;

  // Per-thread delegation. attachVenueToThread validates team ownership,
  // learns alternate_emails, and retroactively links other threads with the
  // same sender. Looping it keeps that behaviour identical and revalidates
  // the affected paths per call.
  for (const threadId of threadIds) {
    const fd = new FormData();
    fd.set("threadId", threadId);
    fd.set("venueId", venueId);
    try {
      const res = await attachVenueToThread(null, fd);
      if (res.ok) {
        attached += 1;
        retroactivelyAttached += res.data.retroactivelyAttached;
      } else {
        skipped += 1;
      }
    } catch (err) {
      logger.warn({ err, threadId, venueId }, "bulkAttachVenueToThreads: thread failed");
      skipped += 1;
    }
  }

  return { ok: true, data: { attached, skipped, retroactivelyAttached } };
}
