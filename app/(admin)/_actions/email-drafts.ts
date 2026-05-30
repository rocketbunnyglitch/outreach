"use server";

/**
 * Server actions for the global composer's draft persistence.
 *
 * Lifecycle:
 *   - The composer creates an in-memory draft id locally (uuid v4) and
 *     calls upsertDraft on every autosave tick. The id stays stable
 *     across the draft's life so each upsert hits the same row.
 *   - When the operator clicks Send, sendDraft validates + dispatches
 *     through the existing composeAndSend pipeline (which enforces
 *     send cap + DNC + suppression + duplicate detection) and then
 *     marks the draft row as sent.
 *   - When the operator clicks Discard, deleteDraft removes the row.
 *
 * Owner scope:
 *   Every action requires requireStaff and filters by owner_user_id.
 *   No cross-user draft access. Admin can't read another user's
 *   drafts (intentional — drafts are private until sent).
 */

import { type EmailDraftAttachment, emailDrafts } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { and, desc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { composeAndSend } from "./compose-and-send";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface UpsertDraftInput {
  id: string; // client-generated uuid v4, stable across autosaves
  connectedAccountId?: string | null;
  toAddresses?: string[];
  ccAddresses?: string[];
  bccAddresses?: string[];
  subject?: string;
  bodyText?: string;
  bodyHtml?: string | null;
  venueId?: string | null;
  cityCampaignId?: string | null;
  templateId?: string | null;
  attachments?: EmailDraftAttachment[];
  scheduledFor?: string | null; // ISO string
}

export interface UpsertDraftResult {
  id: string;
  updatedAt: string;
}

/**
 * Idempotent upsert keyed by id + owner. First call creates the row;
 * subsequent calls update only the fields provided (undefined fields
 * are left alone so partial autosaves don't blank out the rest of the
 * draft).
 *
 * Returns the row's updatedAt so the UI can render "Saved at HH:MM".
 */
export async function upsertDraft(
  input: UpsertDraftInput,
): Promise<ActionResult<UpsertDraftResult>> {
  const { staff } = await requireStaff();
  if (!UUID_RE.test(input.id)) {
    return { ok: false, error: "Invalid draft id." };
  }

  // Fetch existing first so partial updates leave other fields intact.
  const existing = await db
    .select()
    .from(emailDrafts)
    .where(and(eq(emailDrafts.id, input.id), eq(emailDrafts.ownerUserId, staff.id)))
    .limit(1);

  const now = new Date();

  if (existing.length === 0) {
    // Create
    try {
      const [row] = await db
        .insert(emailDrafts)
        .values({
          id: input.id,
          ownerUserId: staff.id,
          teamId: staff.teamId,
          connectedAccountId: input.connectedAccountId ?? null,
          toAddresses: input.toAddresses ?? [],
          ccAddresses: input.ccAddresses ?? [],
          bccAddresses: input.bccAddresses ?? [],
          subject: input.subject ?? "",
          bodyText: input.bodyText ?? "",
          bodyHtml: input.bodyHtml ?? null,
          venueId: input.venueId ?? null,
          cityCampaignId: input.cityCampaignId ?? null,
          templateId: input.templateId ?? null,
          attachments: input.attachments ?? [],
          scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: emailDrafts.id, updatedAt: emailDrafts.updatedAt });
      return {
        ok: true,
        data: { id: row?.id ?? input.id, updatedAt: (row?.updatedAt ?? now).toISOString() },
      };
    } catch (err) {
      logger.error({ err, draftId: input.id }, "upsertDraft create failed");
      return { ok: false, error: "Couldn't save draft." };
    }
  }

  // Update
  const patch: Record<string, unknown> = { updatedAt: now };
  if (input.connectedAccountId !== undefined) patch.connectedAccountId = input.connectedAccountId;
  if (input.toAddresses !== undefined) patch.toAddresses = input.toAddresses;
  if (input.ccAddresses !== undefined) patch.ccAddresses = input.ccAddresses;
  if (input.bccAddresses !== undefined) patch.bccAddresses = input.bccAddresses;
  if (input.subject !== undefined) patch.subject = input.subject;
  if (input.bodyText !== undefined) patch.bodyText = input.bodyText;
  if (input.bodyHtml !== undefined) patch.bodyHtml = input.bodyHtml;
  if (input.venueId !== undefined) patch.venueId = input.venueId;
  if (input.cityCampaignId !== undefined) patch.cityCampaignId = input.cityCampaignId;
  if (input.templateId !== undefined) patch.templateId = input.templateId;
  if (input.attachments !== undefined) patch.attachments = input.attachments;
  if (input.scheduledFor !== undefined) {
    patch.scheduledFor = input.scheduledFor ? new Date(input.scheduledFor) : null;
  }

  try {
    await db
      .update(emailDrafts)
      .set(patch)
      .where(and(eq(emailDrafts.id, input.id), eq(emailDrafts.ownerUserId, staff.id)));
    return { ok: true, data: { id: input.id, updatedAt: now.toISOString() } };
  } catch (err) {
    logger.error({ err, draftId: input.id }, "upsertDraft update failed");
    return { ok: false, error: "Couldn't save draft." };
  }
}

/**
 * List all open (not-yet-sent) drafts for the current user, ordered
 * by most recently updated first. The composer host uses this on
 * mount to restore any in-progress drafts so a refresh/route change
 * doesn't lose work.
 */
export async function listMyDrafts(): Promise<
  Array<{
    id: string;
    connectedAccountId: string | null;
    toAddresses: string[];
    ccAddresses: string[];
    bccAddresses: string[];
    subject: string;
    bodyText: string;
    bodyHtml: string | null;
    venueId: string | null;
    cityCampaignId: string | null;
    templateId: string | null;
    attachments: EmailDraftAttachment[];
    scheduledFor: string | null;
    updatedAt: string;
  }>
> {
  const { staff } = await requireStaff();
  const rows = await db
    .select()
    .from(emailDrafts)
    .where(and(eq(emailDrafts.ownerUserId, staff.id), isNull(emailDrafts.sentAt)))
    .orderBy(desc(emailDrafts.updatedAt));
  return rows.map((r) => ({
    id: r.id,
    connectedAccountId: r.connectedAccountId,
    toAddresses: r.toAddresses ?? [],
    ccAddresses: r.ccAddresses ?? [],
    bccAddresses: r.bccAddresses ?? [],
    subject: r.subject,
    bodyText: r.bodyText,
    bodyHtml: r.bodyHtml,
    venueId: r.venueId,
    cityCampaignId: r.cityCampaignId,
    templateId: r.templateId,
    attachments: (r.attachments as EmailDraftAttachment[]) ?? [],
    scheduledFor: r.scheduledFor ? r.scheduledFor.toISOString() : null,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/**
 * Discard a draft. Removes the row immediately.
 */
export async function deleteDraft(draftId: string): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  if (!UUID_RE.test(draftId)) {
    return { ok: false, error: "Invalid draft id." };
  }
  try {
    await db
      .delete(emailDrafts)
      .where(and(eq(emailDrafts.id, draftId), eq(emailDrafts.ownerUserId, staff.id)));
    return { ok: true, data: { id: draftId } };
  } catch (err) {
    logger.error({ err, draftId }, "deleteDraft failed");
    return { ok: false, error: "Couldn't discard draft." };
  }
}

/**
 * Send a draft via the existing composeAndSend pipeline.
 *
 * We don't reimplement send safety / cap / dedupe here — we route the
 * draft's fields through composeAndSend which enforces everything. On
 * success we mark the draft as sent + link the resulting thread id.
 *
 * Scheduling: scheduled_for handling is a separate cron path (TODO);
 * this action ignores scheduled_for and sends immediately. The UI
 * disables Send on a scheduled draft.
 */
export async function sendDraft(draftId: string): Promise<
  ActionResult<{ threadId: string }> & {
    capBlocked?: boolean;
    duplicateWarnings?: unknown;
  }
> {
  const { staff } = await requireStaff();
  if (!UUID_RE.test(draftId)) {
    return { ok: false, error: "Invalid draft id." };
  }

  const [draft] = await db
    .select()
    .from(emailDrafts)
    .where(and(eq(emailDrafts.id, draftId), eq(emailDrafts.ownerUserId, staff.id)))
    .limit(1);
  if (!draft) {
    return { ok: false, error: "Draft not found." };
  }
  if (draft.sentAt) {
    return { ok: false, error: "Draft already sent." };
  }
  if (!draft.connectedAccountId) {
    return { ok: false, error: "Pick a From inbox before sending." };
  }
  const to = (draft.toAddresses ?? [])[0];
  if (!to) {
    return { ok: false, error: "Add at least one recipient." };
  }

  const fd = new FormData();
  fd.set("connectedAccountId", draft.connectedAccountId);
  fd.set("to", to);
  if (draft.ccAddresses && draft.ccAddresses.length > 0) {
    fd.set("cc", draft.ccAddresses.join(","));
  }
  if (draft.bccAddresses && draft.bccAddresses.length > 0) {
    fd.set("bcc", draft.bccAddresses.join(","));
  }
  fd.set("subject", draft.subject);
  fd.set("body", draft.bodyText);
  if (draft.bodyHtml) fd.set("bodyHtml", draft.bodyHtml);
  if (draft.venueId) fd.set("venueId", draft.venueId);

  const result = await composeAndSend(null, fd);
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      capBlocked: "capBlocked" in result ? result.capBlocked : undefined,
      duplicateWarnings: "duplicateWarnings" in result ? result.duplicateWarnings : undefined,
    };
  }

  // Mark draft as sent.
  try {
    await withAuditContext(staff.id, async (tx) => {
      await tx
        .update(emailDrafts)
        .set({ sentAt: new Date(), sentThreadId: result.threadId, updatedAt: new Date() })
        .where(eq(emailDrafts.id, draftId));
    });
  } catch (err) {
    // The mail already sent; failing to mark the draft is non-fatal
    // (the draft will just linger in the user's open-drafts list
    // until they discard it).
    logger.warn({ err, draftId }, "couldn't mark draft as sent (mail already sent)");
  }
  revalidatePath("/inbox");
  return { ok: true, data: { threadId: result.threadId } };
}
