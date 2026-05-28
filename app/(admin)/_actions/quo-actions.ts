"use server";

/**
 * Quo server actions.
 *
 * Three operator flows:
 *
 *   A. Click-to-call
 *      Operator taps the phone icon on a cold-outreach row. The
 *      browser opens a tel:/openphone:// deep-link (handled client-
 *      side) and this server action runs in parallel to:
 *        • Log the attempt to outreach_log (channel=call, outcome=sent
 *          for the initial attempt; the webhook will land the actual
 *          outcome later when the call ends)
 *        • Bump cold_outreach_entries.last_touch_at + status='called'
 *          if currently 'not_contacted'
 *
 *   B. Send SMS
 *      Composes + sends an SMS via Quo API to the venue's phone, logs
 *      to outreach_log, bumps the cold outreach entry.
 *
 *   C. (next pass) Inbound call webhook handler — see
 *      app/api/webhooks/quo/route.ts.
 *
 * Without QUO_API_KEY, click-to-call still works (it's just a tel:
 * link) but SMS send returns notConfigured.
 */

import { coldOutreachEntries, outreachLog, venues } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

const callSchema = z.object({
  venueId: uuid,
  outreachBrandId: uuid,
  cityCampaignId: uuid.optional(),
  /** When the call originated from a cold outreach row, pass the
   * entry id so we can bump its status + last_touch_at. */
  coldEntryId: uuid.optional(),
});

/**
 * Log a click-to-call attempt. Called in parallel with the browser
 * opening the tel:/quo:// deep link.
 *
 * The initial log entry has outcome='sent' as a placeholder — the
 * webhook handler will overwrite or add a follow-up entry when the
 * call's actual outcome is known (voicemail, no answer, etc.).
 */
export async function logCallAttempt(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ logId: string }>> {
  const { staff } = await requireStaff();
  const parsed = callSchema.safeParse({
    venueId: formData.get("venueId"),
    outreachBrandId: formData.get("outreachBrandId"),
    cityCampaignId: formData.get("cityCampaignId") ?? undefined,
    coldEntryId: formData.get("coldEntryId") ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: "Invalid call payload." };

  try {
    const logId = await withAuditContext(staff.id, async (tx) => {
      const [row] = await tx
        .insert(outreachLog)
        .values({
          venueId: parsed.data.venueId,
          outreachBrandId: parsed.data.outreachBrandId,
          channel: "call",
          outcome: "sent",
          notes: "Click-to-call from cold outreach table",
          staffMemberId: staff.id,
          createdBy: staff.id,
        })
        .returning({ id: outreachLog.id });

      // If from cold outreach, bump status + last_touch
      if (parsed.data.coldEntryId) {
        // Read current status; only auto-bump from not_contacted
        const current = await tx
          .select({ status: coldOutreachEntries.status })
          .from(coldOutreachEntries)
          .where(eq(coldOutreachEntries.id, parsed.data.coldEntryId))
          .limit(1)
          .then((r) => r[0]);
        const patch: Record<string, unknown> = {
          lastTouchAt: new Date(),
          updatedBy: staff.id,
        };
        if (current?.status === "not_contacted") patch.status = "called";
        await tx
          .update(coldOutreachEntries)
          .set(patch)
          .where(eq(coldOutreachEntries.id, parsed.data.coldEntryId));
      }

      return row?.id ?? "";
    });

    if (parsed.data.cityCampaignId) {
      revalidatePath(`/city-campaigns/${parsed.data.cityCampaignId}`);
    }
    return { ok: true, data: { logId } };
  } catch (err) {
    logger.error({ err }, "logCallAttempt failed");
    return { ok: false, error: "Couldn't log the call." };
  }
}

const smsSchema = z.object({
  venueId: uuid,
  outreachBrandId: uuid,
  toE164: z.string().regex(/^\+\d{8,15}$/),
  body: z.string().min(1).max(1600),
  cityCampaignId: uuid.optional(),
  coldEntryId: uuid.optional(),
});

/**
 * Send an SMS via Quo to a venue's phone. Logs the attempt with the
 * Quo message id stored in external_id so we can match webhook
 * delivery confirmations.
 *
 * Resolves the brand's quo_line_e164 → Quo phone-number-id via a
 * lookup at send time. (Could be cached on the brand row for perf —
 * future optimization.)
 */
export async function sendQuoSmsToVenue(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ messageId: string } | { notConfigured: true }>> {
  const { staff } = await requireStaff();
  const parsed = smsSchema.safeParse({
    venueId: formData.get("venueId"),
    outreachBrandId: formData.get("outreachBrandId"),
    toE164: formData.get("toE164"),
    body: formData.get("body"),
    cityCampaignId: formData.get("cityCampaignId") ?? undefined,
    coldEntryId: formData.get("coldEntryId") ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: "Invalid SMS payload." };

  const { isQuoConfigured, sendQuoSms, listQuoPhoneNumbers } = await import("@/lib/quo");
  if (!isQuoConfigured()) {
    return { ok: true, data: { notConfigured: true } };
  }

  // Resolve brand → Quo phone-number id.
  // First request fetches the list; we look up by E.164. The OpenPhone
  // SDK quirk: messages need the internal phone-number-id, not the
  // E.164.
  const brand = await db.execute<{ quo_line_e164: string | null }>(sql`
    SELECT quo_line_e164 FROM outreach_brands WHERE id = ${parsed.data.outreachBrandId}
  `);
  const brandRows: Array<{ quo_line_e164: string | null }> = Array.isArray(brand)
    ? (brand as unknown as Array<{ quo_line_e164: string | null }>)
    : ((brand as unknown as { rows: Array<{ quo_line_e164: string | null }> }).rows ?? []);
  const brandLine = brandRows[0]?.quo_line_e164;
  if (!brandLine) {
    return {
      ok: false,
      error: "This brand has no Quo line configured. Set quo_line_e164 on the brand first.",
    };
  }

  const numbers = await listQuoPhoneNumbers();
  const fromNumber = numbers.find((n) => n.e164 === brandLine);
  if (!fromNumber) {
    return {
      ok: false,
      error: `Brand's Quo line ${brandLine} isn't in the connected Quo account. Check the line is active.`,
    };
  }

  const sent = await sendQuoSms({
    fromPhoneNumberId: fromNumber.id,
    toE164: parsed.data.toE164,
    body: parsed.data.body,
  });
  if (!sent) {
    return { ok: false, error: "Quo SMS send failed. Check the recipient number is correct." };
  }

  // Log + bump cold outreach
  try {
    await withAuditContext(staff.id, async (tx) => {
      await tx.insert(outreachLog).values({
        venueId: parsed.data.venueId,
        outreachBrandId: parsed.data.outreachBrandId,
        channel: "sms",
        outcome: "sent",
        bodySnippet: parsed.data.body.slice(0, 500),
        externalId: sent.id,
        notes: `SMS via Quo to ${parsed.data.toE164}`,
        staffMemberId: staff.id,
        createdBy: staff.id,
      });
      if (parsed.data.coldEntryId) {
        await tx
          .update(coldOutreachEntries)
          .set({
            lastTouchAt: new Date(),
            updatedBy: staff.id,
          })
          .where(eq(coldOutreachEntries.id, parsed.data.coldEntryId));
      }
    });
  } catch (err) {
    // SMS was sent; log failure is non-fatal but should be visible
    logger.error({ err, msgId: sent.id }, "quo sms log write failed");
  }

  if (parsed.data.cityCampaignId) {
    revalidatePath(`/city-campaigns/${parsed.data.cityCampaignId}`);
  }
  return { ok: true, data: { messageId: sent.id } };
}

/**
 * Resolve a venue's primary phone number for the click-to-call cell.
 * Used by the inline dial UI to ensure we always have a valid number
 * before showing the call button.
 */
export async function getVenuePhone(venueId: string): Promise<string | null> {
  const row = await db
    .select({ phone: venues.phoneE164 })
    .from(venues)
    .where(and(eq(venues.id, venueId), isNull(venues.archivedAt)))
    .limit(1)
    .then((r) => r[0]);
  return row?.phone ?? null;
}

// =========================================================================
// Viber attempt logging
//
// Viber is deep-link-driven: the UI opens viber://chat or viber://contact
// on the operator's device, and this action runs in parallel to write the
// attempt to outreach_log. Outcome=sent is the initial placeholder; unlike
// Quo, there's no webhook to deliver the real outcome, so the operator
// updates the entry manually from the city sheet if they want to mark
// it voicemail / interested / declined.
//
// Subtype is captured in notes ('Viber call' vs 'Viber message') so the
// activity feed and audit log show the operator's intent.
// =========================================================================

const viberSubtype = z.enum(["call", "chat"]);

const viberSchema = z.object({
  venueId: uuid,
  outreachBrandId: uuid,
  subtype: viberSubtype,
  cityCampaignId: uuid.optional(),
  coldEntryId: uuid.optional(),
});

export async function logViberAttempt(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ logId: string }>> {
  const { staff } = await requireStaff();
  const parsed = viberSchema.safeParse({
    venueId: formData.get("venueId"),
    outreachBrandId: formData.get("outreachBrandId"),
    subtype: formData.get("subtype"),
    cityCampaignId: formData.get("cityCampaignId") ?? undefined,
    coldEntryId: formData.get("coldEntryId") ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: "Invalid Viber payload." };

  try {
    const logId = await withAuditContext(staff.id, async (tx) => {
      const [row] = await tx
        .insert(outreachLog)
        .values({
          venueId: parsed.data.venueId,
          outreachBrandId: parsed.data.outreachBrandId,
          channel: "viber",
          outcome: "sent",
          notes:
            parsed.data.subtype === "call"
              ? "Viber call from cold outreach table"
              : "Viber chat from cold outreach table",
          staffMemberId: staff.id,
          createdBy: staff.id,
        })
        .returning({ id: outreachLog.id });

      // Bump cold outreach entry like the Quo path does — keeps the
      // 'last touched' column accurate regardless of channel
      if (parsed.data.coldEntryId) {
        const current = await tx
          .select({ status: coldOutreachEntries.status })
          .from(coldOutreachEntries)
          .where(eq(coldOutreachEntries.id, parsed.data.coldEntryId))
          .limit(1)
          .then((r) => r[0]);
        const patch: Record<string, unknown> = {
          lastTouchAt: new Date(),
          updatedBy: staff.id,
        };
        if (current?.status === "not_contacted") patch.status = "called";
        await tx
          .update(coldOutreachEntries)
          .set(patch)
          .where(eq(coldOutreachEntries.id, parsed.data.coldEntryId));
      }

      return row?.id ?? "";
    });

    if (parsed.data.cityCampaignId) {
      revalidatePath(`/city-campaigns/${parsed.data.cityCampaignId}`);
    }
    return { ok: true, data: { logId } };
  } catch (err) {
    logger.error({ err }, "logViberAttempt failed");
    return { ok: false, error: "Couldn't log the Viber attempt." };
  }
}

const callOutcomeSchema = z.object({
  /** The original logCallAttempt's returned id, so we can update the
      same row instead of creating a duplicate. Optional — if missing
      we insert a fresh row (for callers that didn't log on click). */
  logId: uuid.optional(),
  venueId: uuid,
  outreachBrandId: uuid,
  cityCampaignId: uuid.optional(),
  coldEntryId: uuid.optional(),
  outcome: z.enum([
    "wrong_number",
    "no_answer",
    "voicemail",
    "email_collected",
    "callback_requested",
    "interested",
    "declined",
    "competing_event",
    "hours_mismatch",
  ]),
  notes: z.string().max(2000).optional(),
});

/**
 * recordCallOutcome — operator-driven follow-up after a click-to-call.
 * Updates the placeholder outreach_log row (if logId provided) with the
 * actual outcome + notes, or inserts a fresh row when called without
 * an initial logCallAttempt.
 *
 * Side effects driven by the outcome:
 *   wrong_number       → venues.phone may need re-validation; we flag
 *                        the venue with a 'bad_phone' note (notes column)
 *   declined / competing_event / hours_mismatch
 *                      → cold_outreach_entries.status → 'declined'
 *   interested / email_collected / callback_requested
 *                      → cold_outreach_entries.status → 'warm'
 *   no_answer / voicemail
 *                      → no status change; last_touch_at bumped only
 */
export async function recordCallOutcome(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ logId: string }>> {
  const { staff } = await requireStaff();
  const parsed = callOutcomeSchema.safeParse({
    logId: formData.get("logId") ?? undefined,
    venueId: formData.get("venueId"),
    outreachBrandId: formData.get("outreachBrandId"),
    cityCampaignId: formData.get("cityCampaignId") ?? undefined,
    coldEntryId: formData.get("coldEntryId") ?? undefined,
    outcome: formData.get("outcome"),
    notes: formData.get("notes") ?? undefined,
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid outcome payload.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const { outcome, notes, logId, coldEntryId, cityCampaignId } = parsed.data;

  // Map outcome → cold_outreach_status (uses the existing enum)
  type ColdStatus =
    | "interested"
    | "called"
    | "declined"
    | "wrong_number"
    | "no_answer"
    | "voicemail"
    | "unreachable";
  const statusByOutcome: Record<string, ColdStatus> = {
    interested: "interested",
    email_collected: "interested",
    callback_requested: "called",
    declined: "declined",
    competing_event: "declined",
    hours_mismatch: "declined",
    wrong_number: "wrong_number",
    no_answer: "no_answer",
    voicemail: "voicemail",
  };
  let nextEntryStatus: ColdStatus | null = statusByOutcome[outcome] ?? null;

  /**
   * 5-attempt cap (operator session 11 — call follow-up engine).
   *
   * After recording an unanswered/wrong-number outcome, count how many
   * total unanswered calls this venue has racked up over the past 60
   * days. If >= 5, override the status to 'unreachable' so the cold-
   * outreach queue stops re-surfacing this venue at high priority.
   *
   * Counts from outreach_log (the append-only ledger) so we don't have
   * to maintain a denormalized counter. 60-day window matches the
   * operator's typical campaign cycle — a venue that's been silent for
   * 60+ days is effectively unreachable for THIS campaign even if we
   * tried them years ago.
   *
   * The +1 in the comparison accounts for the row we just inserted
   * being part of the count (we run this AFTER the insert in the
   * transaction).
   */
  const UNANSWERED_OUTCOMES = ["no_answer", "voicemail", "wrong_number"];
  const ATTEMPT_CAP = 5;
  const ATTEMPT_WINDOW_DAYS = 60;

  try {
    const finalLogId = await withAuditContext(staff.id, async (tx) => {
      let id = logId;
      if (id) {
        // Update placeholder row from logCallAttempt
        await tx
          .update(outreachLog)
          .set({
            outcome,
            notes: notes ?? null,
          })
          .where(eq(outreachLog.id, id));
      } else {
        // No prior placeholder — insert fresh
        const [row] = await tx
          .insert(outreachLog)
          .values({
            venueId: parsed.data.venueId,
            outreachBrandId: parsed.data.outreachBrandId,
            channel: "call",
            outcome,
            notes: notes ?? null,
            staffMemberId: staff.id,
            createdBy: staff.id,
          })
          .returning({ id: outreachLog.id });
        id = row?.id ?? "";
      }

      // wrong_number: null out the venue's phone so future click-to-call
      // attempts don't auto-target a known-bad number. The outreach_log
      // row still has the original outcome + notes for forensics.
      if (outcome === "wrong_number") {
        await tx
          .update(venues)
          .set({
            phoneE164: null,
            updatedBy: staff.id,
          })
          .where(eq(venues.id, parsed.data.venueId));
      }

      // 5-attempt cap: if THIS outcome is unanswered (no_answer / voicemail
      // / wrong_number) AND the venue has now hit >= 5 such outcomes in
      // the past 60 days, override the cold-outreach status to
      // 'unreachable'. The venue still appears in the table but slides to
      // the bottom of the priority queue.
      if (UNANSWERED_OUTCOMES.includes(outcome) && coldEntryId) {
        const cutoff = new Date(Date.now() - ATTEMPT_WINDOW_DAYS * 86_400_000);
        const countRows = await tx
          .select({ unansweredCount: sql<number>`count(*)::int` })
          .from(outreachLog)
          .where(
            and(
              eq(outreachLog.venueId, parsed.data.venueId),
              eq(outreachLog.channel, "call"),
              sql`${outreachLog.outcome} IN ('no_answer', 'voicemail', 'wrong_number')`,
              sql`${outreachLog.createdAt} >= ${cutoff.toISOString()}`,
            ),
          );
        const unansweredCount = countRows[0]?.unansweredCount ?? 0;
        if (unansweredCount >= ATTEMPT_CAP) {
          nextEntryStatus = "unreachable";
          logger.info(
            { venueId: parsed.data.venueId, coldEntryId, unansweredCount, ATTEMPT_CAP },
            "cold-outreach 5-attempt cap hit — flipping to unreachable",
          );
        }
      }

      // Cold outreach status bump
      if (coldEntryId && nextEntryStatus) {
        await tx
          .update(coldOutreachEntries)
          .set({
            status: nextEntryStatus,
            lastTouchAt: new Date(),
            updatedBy: staff.id,
          })
          .where(eq(coldOutreachEntries.id, coldEntryId));
      } else if (coldEntryId) {
        // No status change but bump last touch
        await tx
          .update(coldOutreachEntries)
          .set({
            lastTouchAt: new Date(),
            updatedBy: staff.id,
          })
          .where(eq(coldOutreachEntries.id, coldEntryId));
      }

      return id;
    });

    if (cityCampaignId) {
      revalidatePath(`/city-campaigns/${cityCampaignId}`);
    }
    revalidatePath(`/venues/${parsed.data.venueId}`);
    return { ok: true, data: { logId: finalLogId } };
  } catch (err) {
    logger.error({ err, outcome }, "recordCallOutcome failed");
    return { ok: false, error: "Couldn't save the call outcome." };
  }
}
