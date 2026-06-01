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
import {
  createSignedUpload,
  deleteAttachment,
  isAttachmentStorageEnabled,
  isValidStorageKey,
} from "@/lib/attachment-storage";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
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
  /** Compose intent — "new" | "reply" | "reply_all" | "forward". */
  mode?: "new" | "reply" | "reply_all" | "forward" | null;
  /** Thread the operator is replying to/forwarding. */
  replyToThreadId?: string | null;
  /** Specific message anchor within the thread. */
  replyToMessageId?: string | null;
  /** Read-only quoted original message for replies/forwards. Stored
   *  separate from bodyHtml; composer renders behind a "..." chip;
   *  compose-send-impl concatenates on send. See migration 0065. */
  quotedHtml?: string | null;
  /** team_labels.id[] queued during compose. For replies (existing
   *  thread), labels apply immediately via applyLabelToThreadAction.
   *  For NEW compose, they're stored here and applied after send
   *  when the new thread row is created. */
  pendingLabelIds?: string[];
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
          mode: input.mode ?? null,
          replyToThreadId: input.replyToThreadId ?? null,
          replyToMessageId: input.replyToMessageId ?? null,
          pendingLabelIds: input.pendingLabelIds ?? [],
          quotedHtml: input.quotedHtml ?? null,
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
  if (input.mode !== undefined) patch.mode = input.mode;
  if (input.replyToThreadId !== undefined) patch.replyToThreadId = input.replyToThreadId;
  if (input.replyToMessageId !== undefined) patch.replyToMessageId = input.replyToMessageId;
  if (input.pendingLabelIds !== undefined) patch.pendingLabelIds = input.pendingLabelIds;
  if (input.quotedHtml !== undefined) patch.quotedHtml = input.quotedHtml;

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
    mode: string | null;
    replyToThreadId: string | null;
    replyToMessageId: string | null;
    pendingLabelIds: string[];
    quotedHtml: string | null;
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
    mode: r.mode ?? null,
    replyToThreadId: r.replyToThreadId ?? null,
    replyToMessageId: r.replyToMessageId ?? null,
    pendingLabelIds: r.pendingLabelIds ?? [],
    quotedHtml: r.quotedHtml ?? null,
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
    // Fetch the draft first so we can clean up any uploaded
    // attachments. Best-effort: failures here log but don't block
    // the row delete.
    const [draft] = await db
      .select({ attachments: emailDrafts.attachments })
      .from(emailDrafts)
      .where(and(eq(emailDrafts.id, draftId), eq(emailDrafts.ownerUserId, staff.id)))
      .limit(1);
    if (draft?.attachments) {
      const list = draft.attachments as EmailDraftAttachment[] | null;
      for (const att of list ?? []) {
        if (att.storage_key) {
          await deleteAttachment(att.storage_key);
        }
      }
    }
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
 * Bulk discard — delete multiple drafts at once. Same auth +
 * attachment-cleanup rules as deleteDraft, but in a single round trip
 * for the row delete (per-draft loop for storage cleanup).
 *
 * Each id is validated as a UUID + scoped to the current user. Cross-
 * owner ids are silently dropped (the WHERE clause owner filter
 * handles that on the DB side too).
 *
 * Returns the count actually deleted — used by the toast feedback.
 */
export async function bulkDeleteDrafts(ids: string[]): Promise<ActionResult<{ deleted: number }>> {
  const { staff } = await requireStaff();
  const cleanIds = ids.filter((id) => UUID_RE.test(id));
  if (cleanIds.length === 0) return { ok: false, error: "No drafts selected." };
  if (cleanIds.length > 200) {
    return { ok: false, error: "Too many drafts (200 max per batch)." };
  }

  try {
    // Pull attachments + verify ownership in one query so we can
    // clean up storage before dropping the rows.
    const draftsToDelete = await db
      .select({ id: emailDrafts.id, attachments: emailDrafts.attachments })
      .from(emailDrafts)
      .where(and(inArray(emailDrafts.id, cleanIds), eq(emailDrafts.ownerUserId, staff.id)));

    if (draftsToDelete.length === 0) {
      return { ok: false, error: "No matching drafts." };
    }

    // Best-effort attachment cleanup. Failures here log but don't
    // block the row deletes — worst case is a stale object lingering
    // in storage.
    for (const d of draftsToDelete) {
      const list = (d.attachments as EmailDraftAttachment[] | null) ?? [];
      for (const att of list) {
        if (att.storage_key) {
          await deleteAttachment(att.storage_key);
        }
      }
    }

    const okIds = draftsToDelete.map((d) => d.id);
    await db
      .delete(emailDrafts)
      .where(and(inArray(emailDrafts.id, okIds), eq(emailDrafts.ownerUserId, staff.id)));

    revalidatePath("/inbox");
    return { ok: true, data: { deleted: okIds.length } };
  } catch (err) {
    logger.error({ err, count: cleanIds.length }, "bulkDeleteDrafts failed");
    return { ok: false, error: "Couldn't discard drafts." };
  }
}

/**
 * Send a draft via the existing composeAndSend pipeline.
 *
 * We don't reimplement send safety / cap / dedupe here — we route the
 * draft's fields through composeAndSend which enforces everything. On
 * success we mark the draft as sent + link the resulting thread id.
 *
 * The scheduled-send cron uses runScheduledSends in
 * lib/scheduled-send-runner.ts which delegates to sendDraftAsUser
 * per-draft scoped to each draft's own owner.
 */
export async function sendDraft(
  draftId: string,
  opts: { bypassCap?: boolean; ackDuplicates?: boolean } = {},
): Promise<
  ActionResult<{ threadId: string }> & {
    capBlocked?: boolean;
    duplicateWarnings?: unknown;
    /** Full warnings array — supersedes duplicateWarnings for new
     *  UI code. Carries every detected SafetyWarning kind
     *  (duplicate, recent_decline, cross_staff_owner, ...). */
    safetyWarnings?: unknown;
    wrongAccountBlocked?: boolean;
    threadAccountEmail?: string;
    chosenAccountEmail?: string;
  }
> {
  const { staff } = await requireStaff();
  if (!UUID_RE.test(draftId)) {
    return { ok: false, error: "Invalid draft id." };
  }
  return sendDraftAsUser({
    draftId,
    ownerUserId: staff.id,
    bypassCap: opts.bypassCap,
    ackDuplicates: opts.ackDuplicates,
  });
}

/**
 * Internal: drive the send pipeline scoped to a specific owner.
 * The public sendDraft auth-gates via requireStaff; the cron path
 * calls this directly with each draft row's own owner_user_id so
 * audit attribution stays correct (the cron isn't sending — the
 * draft's owner is, just on a delay).
 */
async function sendDraftAsUser(input: {
  draftId: string;
  ownerUserId: string;
  bypassCap?: boolean;
  ackDuplicates?: boolean;
}): Promise<
  ActionResult<{ threadId: string }> & {
    capBlocked?: boolean;
    duplicateWarnings?: unknown;
    safetyWarnings?: unknown;
    wrongAccountBlocked?: boolean;
    threadAccountEmail?: string;
    chosenAccountEmail?: string;
  }
> {
  const [draft] = await db
    .select()
    .from(emailDrafts)
    .where(and(eq(emailDrafts.id, input.draftId), eq(emailDrafts.ownerUserId, input.ownerUserId)))
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
  const toAddresses = (draft.toAddresses ?? []).filter((s) => s && s.trim().length > 0);
  if (toAddresses.length === 0) {
    return { ok: false, error: "Add at least one recipient." };
  }

  const fd = new FormData();
  fd.set("fromAccountId", draft.connectedAccountId);
  // Pass all To recipients as a comma-separated list — composeAndSendImpl
  // parses CSV. Previously only the first recipient was forwarded; any
  // additional To addresses the operator added in the composer were
  // silently dropped before reaching Gmail.
  fd.set("to", toAddresses.join(","));
  if (draft.ccAddresses && draft.ccAddresses.length > 0) {
    fd.set("cc", draft.ccAddresses.join(","));
  }
  if (draft.bccAddresses && draft.bccAddresses.length > 0) {
    fd.set("bcc", draft.bccAddresses.join(","));
  }
  fd.set("subject", draft.subject);
  fd.set("body", draft.bodyText);
  // Concatenate the operator's edited bodyHtml with the read-only
  // quoted original (if any) so the recipient receives the full
  // thread regardless of whether the operator expanded the
  // "..." chip in the composer. The quote sits below an empty
  // <br> for visual separation in the rendered email.
  if (draft.bodyHtml || draft.quotedHtml) {
    const bodyPart = draft.bodyHtml ?? "";
    const quotePart = draft.quotedHtml ? `<br><br>${draft.quotedHtml}` : "";
    fd.set("bodyHtml", bodyPart + quotePart);
  }
  if (draft.venueId) fd.set("venueId", draft.venueId);
  // Reply/forward context — composeAndSendImpl branches on these to
  // attach the new message to the existing Gmail thread instead of
  // creating a fresh thread.
  if (draft.replyToThreadId) fd.set("replyToThreadId", draft.replyToThreadId);
  if (draft.replyToMessageId) fd.set("replyToMessageId", draft.replyToMessageId);
  if (draft.mode) fd.set("composeMode", draft.mode);
  // Attachments — pass the JSONB array as JSON so composeAndSendImpl
  // can resolve storage keys + fetch bytes for the multipart build.
  // Only forward entries that have a storage_key (memory-only chips
  // can't be sent, and we already surfaced that to the operator in
  // the composer).
  const attachmentsToSend =
    (draft.attachments as EmailDraftAttachment[] | null)?.filter((a) => a.storage_key) ?? [];
  if (attachmentsToSend.length > 0) {
    fd.set("attachments", JSON.stringify(attachmentsToSend));
  }
  // Pending labels — applied to the resulting thread after Gmail
  // send completes (handled inside compose-send-impl). Only set when
  // the operator queued labels during a NEW compose; replies apply
  // labels at toggle time and don't carry them on the draft row.
  const pendingLabelIds = (draft.pendingLabelIds ?? []) as string[];
  if (pendingLabelIds.length > 0) {
    fd.set("labelIds", pendingLabelIds.join(","));
  }
  // Admin-bypass marker — composeAndSend re-checks the operator's
  // role server-side; we just surface the form-field convention here.
  if (input.bypassCap) fd.set("bypassCap", "1");
  // Pre-send safety warnings are surfaced to the client (decline,
  // cross-staff, duplicate). When the operator chooses "Send
  // anyway" in the confirm dialog, the client re-calls sendDraft
  // with ackDuplicates:true; we forward that as the same
  // ackDuplicates form field that composeAndSendImpl already
  // recognizes. The form-field name predates the broader
  // SafetyWarning union — kept stable to avoid churning every
  // server-side check site.
  if (input.ackDuplicates) fd.set("ackDuplicates", "1");
  // Template attribution (Phase C.1) — recorded on email_send_events
  // so template-performance analytics can compute per-template
  // reply/warm rates. Null when the operator composed freeform.
  if (draft.templateId) fd.set("templateId", draft.templateId);

  const result = await composeAndSend(null, fd);
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      capBlocked: "capBlocked" in result ? result.capBlocked : undefined,
      duplicateWarnings: "duplicateWarnings" in result ? result.duplicateWarnings : undefined,
      safetyWarnings: "safetyWarnings" in result ? result.safetyWarnings : undefined,
      wrongAccountBlocked: "wrongAccountBlocked" in result ? result.wrongAccountBlocked : undefined,
      threadAccountEmail: "threadAccountEmail" in result ? result.threadAccountEmail : undefined,
      chosenAccountEmail: "chosenAccountEmail" in result ? result.chosenAccountEmail : undefined,
    };
  }

  // Mark draft as sent.
  try {
    await withAuditContext(input.ownerUserId, async (tx) => {
      await tx
        .update(emailDrafts)
        .set({ sentAt: new Date(), sentThreadId: result.threadId, updatedAt: new Date() })
        .where(eq(emailDrafts.id, input.draftId));
    });
  } catch (err) {
    // The mail already sent; failing to mark the draft is non-fatal
    // (the draft will just linger in the user's open-drafts list
    // until they discard it).
    logger.warn({ err, draftId: input.draftId }, "couldn't mark draft as sent (mail already sent)");
  }
  revalidatePath("/inbox");
  return { ok: true, data: { threadId: result.threadId } };
}

/**
 * Create a signed upload URL for a draft attachment. The browser then
 * PUTs the file directly to object storage; on success, the client
 * calls upsertDraft with the new attachment row including
 * storage_key.
 *
 * Auth: requireStaff + draft ownership check. The draft must exist
 * and belong to the current user (so a malicious client can't upload
 * into another user's draft namespace).
 *
 * Falls back to { enabled: false } when ATTACHMENTS_ENABLED is unset
 * — the composer keeps its existing memory-only path.
 */
export async function createAttachmentUpload(input: {
  draftId: string;
  filename: string;
  mime: string;
  sizeBytes: number;
}): Promise<
  ActionResult<
    | {
        enabled: true;
        uploadUrl: string;
        storageKey: string;
        contentType: string;
        expiresAt: string;
      }
    | { enabled: false }
  >
> {
  const { staff } = await requireStaff();
  if (!UUID_RE.test(input.draftId)) {
    return { ok: false, error: "Invalid draft id." };
  }
  if (!input.filename || input.filename.length > 200) {
    return { ok: false, error: "Invalid filename." };
  }
  if (!input.mime || !/^[\w\-+./]+$/.test(input.mime)) {
    return { ok: false, error: "Invalid MIME type." };
  }
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    return { ok: false, error: "Invalid size." };
  }
  if (input.sizeBytes > 25 * 1024 * 1024) {
    return { ok: false, error: "File exceeds 25 MB limit." };
  }

  // Verify the draft belongs to the current user. We allow uploads
  // even before the draft row exists by lazy-creating an empty draft
  // (otherwise the client would have to two-step: upsert empty draft
  // then upload). Idempotent.
  const existing = await db
    .select({ id: emailDrafts.id })
    .from(emailDrafts)
    .where(and(eq(emailDrafts.id, input.draftId), eq(emailDrafts.ownerUserId, staff.id)))
    .limit(1);
  if (existing.length === 0) {
    try {
      await db.insert(emailDrafts).values({
        id: input.draftId,
        ownerUserId: staff.id,
        teamId: staff.teamId,
      });
    } catch (err) {
      logger.error({ err, draftId: input.draftId }, "createAttachmentUpload: lazy-create failed");
      return { ok: false, error: "Couldn't prepare upload." };
    }
  }

  try {
    const result = await createSignedUpload({
      teamId: staff.teamId,
      draftId: input.draftId,
      staffId: staff.id,
      filename: input.filename,
      mime: input.mime,
      sizeBytes: input.sizeBytes,
    });
    return { ok: true, data: result };
  } catch (err) {
    logger.error({ err, draftId: input.draftId }, "createAttachmentUpload failed");
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Couldn't prepare upload.",
    };
  }
}

/**
 * Best-effort delete of a draft attachment from storage. The
 * attachments JSONB array on the draft is updated separately via
 * upsertDraft; this just removes the bytes.
 *
 * Validates the key belongs to the operator's team before deleting.
 */
export async function deleteAttachmentObject(
  storageKey: string,
): Promise<ActionResult<{ deleted: boolean }>> {
  const { staff } = await requireStaff();
  if (!isValidStorageKey(storageKey, staff.teamId)) {
    return { ok: false, error: "Invalid storage key." };
  }
  await deleteAttachment(storageKey);
  return { ok: true, data: { deleted: true } };
}

/**
 * Tiny mount-time probe — returns whether attachment storage is
 * actually configured on this deployment. The composer uses this to
 * decide whether to enable the paperclip button at all, rather than
 * surfacing a confusing post-pick warning to operators (who can't
 * fix env vars themselves).
 *
 * Returns { enabled: boolean }. Auth via requireStaff so this isn't
 * a public probe; only signed-in operators can ping it.
 */
export async function probeAttachmentsEnabled(): Promise<{ enabled: boolean }> {
  await requireStaff();
  return { enabled: isAttachmentStorageEnabled() };
}
