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
