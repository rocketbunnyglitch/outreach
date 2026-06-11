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

import {
  type EmailDraftAttachment,
  cityCampaigns,
  crawlDeliverables,
  emailDrafts,
  staffInfoSheets,
  venueEvents,
} from "@/db/schema";
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
import { isT11Touch } from "@/lib/send-mode-gate";
import { type SafetyWarning, describeBlock, runSendSafetyForRecipients } from "@/lib/send-safety";
import { validateEmail } from "@/lib/zerobounce";
import { and, desc, eq, gt, inArray, isNotNull, isNull, ne } from "drizzle-orm";
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
  /** Subject-line A/B variant index chosen for this draft (Tier-2). */
  subjectVariantIndex?: number | null;
  /** Template the engine auto-picked when the composer opened (Phase 1.5).
   *  Set once on auto-load; left untouched when the operator swaps the
   *  loaded template, so it preserves the original engine suggestion. */
  enginePickedTemplateId?: string | null;
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
/**
 * P0-4 readiness gate: a T11 (staff info sheet) email must NOT go out before the
 * venue_event actually has a generated staff info sheet. Scoped strictly to T11
 * drafts -- returns null (no block) for every other touch type, so no other send
 * is affected. T10 (graphics) is not auto-drafted as an email (graphics is a
 * confirmation-cascade task), so there is no T10 draft to gate here.
 */
async function t11BlockReason(
  touchType: string | null,
  venueEventId: string | null,
): Promise<string | null> {
  if (!isT11Touch(touchType) || !venueEventId) return null;
  const [sheet] = await db
    .select({ id: staffInfoSheets.id })
    .from(staffInfoSheets)
    .where(eq(staffInfoSheets.venueEventId, venueEventId))
    .limit(1);
  if (!sheet) {
    return "Staff info sheet isn't ready for this venue yet. Generate the info sheet before sending T11.";
  }

  // Refdoc 7.4.2 (CRM plan A2, 2026-06-11): WRISTBAND venues also need
  // the participant-facing sheet before T11 — they host check-in, so
  // incomplete participant info there is an event-night failure, not a
  // nice-to-have. Tracked as the participant_poster deliverable.
  const [ve] = await db
    .select({ role: venueEvents.role })
    .from(venueEvents)
    .where(eq(venueEvents.id, venueEventId))
    .limit(1);
  if (ve?.role === "wristband") {
    const [poster] = await db
      .select({ id: crawlDeliverables.id })
      .from(crawlDeliverables)
      .where(
        and(
          eq(crawlDeliverables.venueEventId, venueEventId),
          eq(crawlDeliverables.deliverableType, "participant_poster"),
          eq(crawlDeliverables.status, "done"),
        ),
      )
      .limit(1);
    if (!poster) {
      return "Wristband venues need the participant sheet/poster ready before T11 (it carries the check-in info). Mark the participant_poster deliverable done first.";
    }
  }
  return null;
}

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
          subjectVariantIndex: input.subjectVariantIndex ?? null,
          enginePickedTemplateId: input.enginePickedTemplateId ?? null,
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
  if (input.subjectVariantIndex !== undefined)
    patch.subjectVariantIndex = input.subjectVariantIndex;
  if (input.enginePickedTemplateId !== undefined) {
    patch.enginePickedTemplateId = input.enginePickedTemplateId;
  }
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
    subjectVariantIndex: number | null;
    enginePickedTemplateId: string | null;
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
    .where(
      and(
        eq(emailDrafts.ownerUserId, staff.id),
        isNull(emailDrafts.sentAt),
        // QUEUED drafts (scheduled_for set) live on /email-queue -- they must
        // NOT restore as open composer tabs (operator fix request 2026-06-11:
        // "queued emails showing as draft tabs").
        isNull(emailDrafts.scheduledFor),
      ),
    )
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
    subjectVariantIndex: r.subjectVariantIndex ?? null,
    enginePickedTemplateId: r.enginePickedTemplateId,
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
 * Fetch ONE of my drafts by id, including QUEUED drafts (scheduled_for
 * set). listMyDrafts deliberately excludes queued drafts so they don't
 * restore as composer tabs on mount — but "Resume" from the inbox
 * Scheduled folder must still be able to open them, so the by-id
 * lookup has no scheduled_for filter.
 */
export async function getMyDraft(
  draftId: string,
): Promise<Awaited<ReturnType<typeof listMyDrafts>>[number] | null> {
  const { staff } = await requireStaff();
  if (!UUID_RE.test(draftId)) return null;
  const [r] = await db
    .select()
    .from(emailDrafts)
    .where(
      and(
        eq(emailDrafts.id, draftId),
        eq(emailDrafts.ownerUserId, staff.id),
        isNull(emailDrafts.sentAt),
      ),
    )
    .limit(1);
  if (!r) return null;
  return {
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
    subjectVariantIndex: r.subjectVariantIndex ?? null,
    enginePickedTemplateId: r.enginePickedTemplateId,
    attachments: (r.attachments as EmailDraftAttachment[]) ?? [],
    scheduledFor: r.scheduledFor ? r.scheduledFor.toISOString() : null,
    updatedAt: r.updatedAt.toISOString(),
    mode: r.mode ?? null,
    replyToThreadId: r.replyToThreadId ?? null,
    replyToMessageId: r.replyToMessageId ?? null,
    pendingLabelIds: r.pendingLabelIds ?? [],
    quotedHtml: r.quotedHtml ?? null,
  };
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
 * Randomized gap (ms) between consecutive queued cold sends on an inbox.
 *
 * Deliverability-first: every queued email is human-written + human-reviewed;
 * queueing only spaces them out so the inbox never sends a burst (which Gmail
 * flags). A FIXED interval is itself a detectable machine signature, so we
 * make the spacing irregular:
 *   - base gap 4-9 min, with sub-minute jitter (non-round send times)
 *   - ~15% of the time a longer 10-22 min "break" so there's no steady rhythm
 * Tunable here without touching the scheduler.
 */
/** One-line confirm text for queue-time warnings, mirroring the send-time
 *  priority order: invalid address > recent decline > teammate ownership >
 *  duplicate threads. */
function summarizeQueueWarnings(warnings: SafetyWarning[]): string {
  const invalid = warnings.find((w) => w.kind === "invalid_recipient");
  if (invalid && invalid.kind === "invalid_recipient") {
    return invalid.status === "spamtrap" || invalid.status === "abuse"
      ? `${invalid.email} is flagged as a ${invalid.status === "spamtrap" ? "spam trap" : "known complainer"} — sending can damage the domain's reputation.`
      : `${invalid.email} looks like an invalid address (likely to bounce).`;
  }
  const decline = warnings.find((w) => w.kind === "recent_decline");
  if (decline && decline.kind === "recent_decline") {
    return `${decline.venueName} declined ${decline.daysAgo} day${decline.daysAgo === 1 ? "" : "s"} ago.`;
  }
  const cross = warnings.find((w) => w.kind === "cross_staff_owner");
  if (cross && cross.kind === "cross_staff_owner") {
    return `${cross.ownerStaffName ?? "Another teammate"} is already contacting ${cross.venueName}.`;
  }
  const dupes = warnings.filter((w) => w.kind === "duplicate").length;
  return `Possible duplicate outreach (${dupes} open thread${dupes === 1 ? "" : "s"} already to this address).`;
}

function randomQueueGapMs(): number {
  let minutes = 4 + Math.random() * 5; // 4-9 min
  if (Math.random() < 0.15) minutes = 10 + Math.random() * 12; // occasional longer pause
  const seconds = Math.random() * 60; // sub-minute jitter
  return Math.round((minutes * 60 + seconds) * 1000);
}

/**
 * Queue a draft for auto-staggered sending instead of sending it now.
 *
 * Computes a randomized scheduled_for that lands a short, irregular gap AFTER
 * the last queued (unsent, future-scheduled) draft on the same inbox, so a batch
 * of cold emails drains as a spaced-out trickle the scheduled-sends cron
 * dispatches one by one. The operator hits Queue and moves on; the live
 * cooldown ring only governs interactive "Send now".
 *
 * The draft must already be autosaved with a From inbox + at least one
 * recipient (the composer flushes its autosave before calling this).
 */
export async function queueColdSend(
  draftId: string,
  opts?: { ackWarnings?: boolean },
): Promise<ActionResult<{ scheduledFor: string }> | { ok: false; error: string; needsAck: true }> {
  const { staff } = await requireStaff();
  if (!UUID_RE.test(draftId)) {
    return { ok: false, error: "Invalid draft id." };
  }
  try {
    const [draft] = await db
      .select({
        connectedAccountId: emailDrafts.connectedAccountId,
        toAddresses: emailDrafts.toAddresses,
        ccAddresses: emailDrafts.ccAddresses,
        bccAddresses: emailDrafts.bccAddresses,
        venueId: emailDrafts.venueId,
        cityCampaignId: emailDrafts.cityCampaignId,
        sentAt: emailDrafts.sentAt,
      })
      .from(emailDrafts)
      .where(and(eq(emailDrafts.id, draftId), eq(emailDrafts.ownerUserId, staff.id)))
      .limit(1);
    if (!draft) return { ok: false, error: "Draft not found." };
    if (draft.sentAt) return { ok: false, error: "This email has already been sent." };
    if (!draft.connectedAccountId) {
      return { ok: false, error: "Pick a From inbox before queueing." };
    }
    const hasRecipient = (draft.toAddresses ?? []).some((a) => a && a.trim().length > 0);
    if (!hasRecipient) return { ok: false, error: "Add a recipient before queueing." };

    // Surface the pre-send safety checks AT QUEUE TIME. The cron forwards
    // the Queue click as the acknowledgment for interactive warnings (it
    // can't render a confirm dialog at dispatch time), so the staffer must
    // actually SEE them here for that ack to mean anything. Hard blocks
    // (suppression / DNC) refuse the queue outright -- previously they
    // queued, then perma-failed at dispatch.
    const safety = await runSendSafetyForRecipients({
      teamId: staff.teamId,
      staffId: staff.id,
      to: draft.toAddresses ?? [],
      cc: draft.ccAddresses ?? [],
      bcc: draft.bccAddresses ?? [],
      venueId: draft.venueId,
    });
    if (!safety.ok) {
      return { ok: false, error: describeBlock(safety.block) };
    }
    if (!opts?.ackWarnings) {
      // Deliverability: an 'invalid' primary address is a near-certain
      // bounce. Cached ZeroBounce verdict; best-effort (mirrors send time).
      try {
        const primary = (draft.toAddresses ?? [])[0]?.trim();
        if (primary) {
          const v = await validateEmail(primary, staff.id);
          if (v?.status === "invalid" || v?.status === "spamtrap" || v?.status === "abuse") {
            safety.warnings.push({ kind: "invalid_recipient", email: primary, status: v.status });
          }
        }
      } catch (err) {
        logger.warn({ err, draftId }, "queueColdSend: pre-queue validation skipped (non-fatal)");
      }
      if (safety.warnings.length > 0) {
        return { ok: false, needsAck: true, error: summarizeQueueWarnings(safety.warnings) };
      }
    }

    // Latest pending (unsent, future) queued send on this inbox -> stagger
    // after it; otherwise stagger from now. Scope to the inbox so two
    // inboxes queue independently (each has its own daily cap + cooldown).
    const now = new Date();
    const [latest] = await db
      .select({ scheduledFor: emailDrafts.scheduledFor })
      .from(emailDrafts)
      .where(
        and(
          eq(emailDrafts.ownerUserId, staff.id),
          eq(emailDrafts.connectedAccountId, draft.connectedAccountId),
          isNotNull(emailDrafts.scheduledFor),
          isNull(emailDrafts.sentAt),
          gt(emailDrafts.scheduledFor, now),
          ne(emailDrafts.id, draftId),
        ),
      )
      .orderBy(desc(emailDrafts.scheduledFor))
      .limit(1);

    const base = latest?.scheduledFor && latest.scheduledFor > now ? latest.scheduledFor : now;
    let scheduledFor = new Date(base.getTime() + randomQueueGapMs());
    // Operator rule (2026-06-10): a manually queued email sends within 8
    // minutes, no matter how deep this inbox's queue already is. The random
    // stagger applies until it would push past the cap; beyond that, drafts
    // bunch up just under the cap (small backward jitter keeps timestamps
    // distinct) and the cron drains them together -- it skips the pacing
    // cooldown for operator-queued manual sends.
    const MAX_QUEUE_DELAY_MS = 8 * 60_000;
    const latestAllowed = now.getTime() + MAX_QUEUE_DELAY_MS;
    if (scheduledFor.getTime() > latestAllowed) {
      scheduledFor = new Date(latestAllowed - Math.floor(Math.random() * 60_000));
    }

    await db
      .update(emailDrafts)
      .set({
        scheduledFor,
        // P0-1: the operator reviewed this draft and hit Queue -> a human-
        // approved send the cron is allowed to dispatch.
        sendMode: "operator_scheduled",
        requiresHumanApproval: false,
        approvedByStaffId: staff.id,
        approvedAt: now,
        scheduledByStaffId: staff.id,
        updatedAt: now,
      })
      .where(and(eq(emailDrafts.id, draftId), eq(emailDrafts.ownerUserId, staff.id)));

    // Tracker auto-assign (operator request 2026-06-10): scheduling outreach
    // for a city claims that city for the sender IF nobody owns it yet --
    // never steals an existing assignment. Best-effort.
    if (draft.cityCampaignId) {
      try {
        await db
          .update(cityCampaigns)
          .set({ leadStaffId: staff.id, updatedBy: staff.id })
          .where(
            and(eq(cityCampaigns.id, draft.cityCampaignId), isNull(cityCampaigns.leadStaffId)),
          );
        revalidatePath("/tracker");
      } catch (err) {
        logger.warn({ err, draftId }, "queueColdSend: tracker auto-assign skipped (non-fatal)");
      }
    }

    revalidatePath("/email-queue");
    revalidatePath("/inbox");
    return { ok: true, data: { scheduledFor: scheduledFor.toISOString() } };
  } catch (err) {
    logger.error({ err, draftId }, "queueColdSend failed");
    return { ok: false, error: "Couldn't queue the email." };
  }
}

/**
 * P0-1 send-safety: explicitly approve a draft for scheduled sending (the
 * composer "Schedule send" + cadence "Schedule for earliest" paths).
 *
 * This is the ONLY composer path that flips a draft to operator_scheduled --
 * autosave (upsertDraft) never approves a send, so merely opening an
 * engine-generated review_required draft can never make it auto-send. Passing
 * scheduledFor=null clears the schedule and reverts the draft to
 * review_required. "Engine drafts. Humans send."
 */
export async function scheduleDraftSend(
  draftId: string,
  scheduledForIso: string | null,
): Promise<ActionResult<{ scheduledFor: string | null }>> {
  const { staff } = await requireStaff();
  if (!UUID_RE.test(draftId)) return { ok: false, error: "Invalid draft id." };
  try {
    const [draft] = await db
      .select({
        sentAt: emailDrafts.sentAt,
        touchType: emailDrafts.touchType,
        venueEventId: emailDrafts.venueEventId,
      })
      .from(emailDrafts)
      .where(and(eq(emailDrafts.id, draftId), eq(emailDrafts.ownerUserId, staff.id)))
      .limit(1);
    if (!draft) return { ok: false, error: "Draft not found." };
    if (draft.sentAt) return { ok: false, error: "This email has already been sent." };
    // P0-4: don't let an operator approve/schedule a T11 before its info sheet
    // exists (prevents a blocked draft from retrying every cron tick).
    if (scheduledForIso) {
      const t11Block = await t11BlockReason(draft.touchType, draft.venueEventId);
      if (t11Block) return { ok: false, error: t11Block };
    }

    const now = new Date();
    const scheduledFor = scheduledForIso ? new Date(scheduledForIso) : null;
    await db
      .update(emailDrafts)
      .set(
        scheduledFor
          ? {
              scheduledFor,
              sendMode: "operator_scheduled",
              requiresHumanApproval: false,
              approvedByStaffId: staff.id,
              approvedAt: now,
              scheduledByStaffId: staff.id,
              updatedAt: now,
            }
          : {
              scheduledFor: null,
              sendMode: "review_required",
              requiresHumanApproval: true,
              approvedByStaffId: null,
              approvedAt: null,
              scheduledByStaffId: null,
              updatedAt: now,
            },
      )
      .where(and(eq(emailDrafts.id, draftId), eq(emailDrafts.ownerUserId, staff.id)));

    revalidatePath("/email-queue");
    revalidatePath("/inbox");
    return { ok: true, data: { scheduledFor: scheduledFor ? scheduledFor.toISOString() : null } };
  } catch (err) {
    logger.error({ err, draftId }, "scheduleDraftSend failed");
    return { ok: false, error: "Couldn't schedule the email." };
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
  opts: {
    bypassCap?: boolean;
    /** Per-gate overrides (split out of the old single bypassCap). */
    bypassRelationship?: boolean;
    bypassWrongAccount?: boolean;
    bypassAmbiguousIntent?: boolean;
    ackDuplicates?: boolean;
    cadenceOverrideReason?: string;
    /** Send a single text/plain part (no HTML) -- best cold deliverability. */
    plainText?: boolean;
  } = {},
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
    /** Set when the cadence floor blocked the send (Phase 1.9). Admins
     *  retry with cadenceOverrideReason; non-admins are blocked. */
    cadenceBlocked?: boolean;
    cadence?: {
      reason: string | null;
      earliestAllowedAt: string | null;
      totalTouchCount: number;
      hardCapReached: boolean;
    };
    cooldownBlocked?: boolean;
    cooldownUntil?: string | null;
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
    bypassRelationship: opts.bypassRelationship,
    bypassWrongAccount: opts.bypassWrongAccount,
    bypassAmbiguousIntent: opts.bypassAmbiguousIntent,
    ackDuplicates: opts.ackDuplicates,
    cadenceOverrideReason: opts.cadenceOverrideReason,
    plainText: opts.plainText,
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
  bypassRelationship?: boolean;
  bypassWrongAccount?: boolean;
  bypassAmbiguousIntent?: boolean;
  ackDuplicates?: boolean;
  cadenceOverrideReason?: string;
  plainText?: boolean;
}): Promise<
  ActionResult<{ threadId: string }> & {
    capBlocked?: boolean;
    duplicateWarnings?: unknown;
    safetyWarnings?: unknown;
    wrongAccountBlocked?: boolean;
    threadAccountEmail?: string;
    chosenAccountEmail?: string;
    cadenceBlocked?: boolean;
    cadence?: {
      reason: string | null;
      earliestAllowedAt: string | null;
      totalTouchCount: number;
      hardCapReached: boolean;
    };
    cooldownBlocked?: boolean;
    cooldownUntil?: string | null;
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
  // P0-4: block T11 send (interactive AND cron) until the info sheet exists.
  const t11Block = await t11BlockReason(draft.touchType, draft.venueEventId);
  if (t11Block) return { ok: false, error: t11Block };

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
  // City-campaign attribution - composeAndSendImpl derives the campaign +
  // brand from it to enforce the cadence floor (Phase 1.9).
  if (draft.cityCampaignId) fd.set("cityCampaignId", draft.cityCampaignId);
  // Send-intent signals (P0): the draft's touch code + recipient type so
  // composeAndSendImpl classifies the send and never processes a lifecycle /
  // cancellation / host email as cold outreach. (templateId below is the
  // primary signal; these refine it for non-template or ambiguous cases.)
  if (draft.touchType) fd.set("touchType", draft.touchType);
  if (draft.recipientType) fd.set("recipientType", draft.recipientType);
  // Subject-line A/B (Tier-2): forward the chosen variant index so the audit
  // row records which subject sent (for per-variant reply-rate ranking).
  if (draft.subjectVariantIndex != null) {
    fd.set("subjectVariantIndex", String(draft.subjectVariantIndex));
  }
  if (draft.venueEventId) fd.set("venueEventId", draft.venueEventId);
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
  // Admin-bypass markers — composeAndSend re-checks the operator's role
  // server-side; we just surface the form-field convention here. Each gate
  // has its own flag so acknowledging one (e.g. the daily cap) never
  // silently waives the others (bad-relationship, wrong-account, intent).
  if (input.bypassCap) fd.set("bypassCap", "1");
  if (input.bypassRelationship) fd.set("bypassRelationship", "1");
  if (input.bypassWrongAccount) fd.set("bypassWrongAccount", "1");
  if (input.bypassAmbiguousIntent) fd.set("bypassAmbiguousIntent", "1");
  if (input.plainText) fd.set("plainText", "1");
  // Admin cadence-floor override reason (Phase 1.9). Present only when an
  // admin chose to send despite the floor; logged on the send event.
  if (input.cadenceOverrideReason) {
    fd.set("cadenceOverrideReason", input.cadenceOverrideReason);
  }
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

  // Atomically CLAIM the draft before sending (mirrors the cron runner). The
  // UPDATE...WHERE sent_at IS NULL is atomic, so a double-click or a cron/manual
  // race can't both dispatch it. If we don't win the claim, it's already sent.
  const sendClaim = await db
    .update(emailDrafts)
    .set({ sentAt: new Date(), updatedAt: new Date() })
    .where(and(eq(emailDrafts.id, input.draftId), isNull(emailDrafts.sentAt)))
    .returning({ id: emailDrafts.id });
  if (sendClaim.length === 0) {
    return { ok: false, error: "This email has already been sent." };
  }

  const result = await composeAndSend(null, fd);
  if (!result.ok) {
    // Release the claim so the operator can retry -- unless Gmail already
    // accepted the message (gmailSent), where retrying would double-send.
    if (!("gmailSent" in result) || !result.gmailSent) {
      await db
        .update(emailDrafts)
        .set({ sentAt: null, updatedAt: new Date() })
        .where(eq(emailDrafts.id, input.draftId));
    }
    return {
      ok: false,
      error: result.error,
      capBlocked: "capBlocked" in result ? result.capBlocked : undefined,
      duplicateWarnings: "duplicateWarnings" in result ? result.duplicateWarnings : undefined,
      safetyWarnings: "safetyWarnings" in result ? result.safetyWarnings : undefined,
      wrongAccountBlocked: "wrongAccountBlocked" in result ? result.wrongAccountBlocked : undefined,
      threadAccountEmail: "threadAccountEmail" in result ? result.threadAccountEmail : undefined,
      chosenAccountEmail: "chosenAccountEmail" in result ? result.chosenAccountEmail : undefined,
      cadenceBlocked: "cadenceBlocked" in result ? result.cadenceBlocked : undefined,
      cadence: "cadence" in result ? result.cadence : undefined,
      cooldownBlocked: "cooldownBlocked" in result ? result.cooldownBlocked : undefined,
      cooldownUntil: "cooldownUntil" in result ? result.cooldownUntil : undefined,
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

  // Learning loop (2026-06-11): if this draft was seeded from a
  // quick-reply chip, record whether the operator sent it as-is,
  // lightly edited, or rewrote it — re-ranks the corpus examples
  // behind future suggestions AND feeds the autonomy trust ladder.
  // Fire-and-forget, never blocks a send.
  try {
    const meta = draft.suggestionMeta as {
      exampleIds?: string[];
      seededBody?: string;
    } | null;
    if (meta?.seededBody) {
      const { feedbackBucket, recordSuggestionFeedback } = await import("@/lib/reply-corpus");
      const bucket = feedbackBucket(meta.seededBody, draft.bodyText ?? "");
      if (meta.exampleIds?.length) {
        void recordSuggestionFeedback(meta.exampleIds, bucket);
      }
      const { recordActionVerdict } = await import("@/lib/autonomy");
      // rewritten = the machine's draft wasn't good enough to send.
      void recordActionVerdict(
        "quick_reply_chip",
        bucket === "rewritten" ? "rejected" : bucket,
        input.draftId,
      );
    }

    // Template-pick verdict: did the operator send the template the
    // engine picked, or swap it?
    if (draft.enginePickedTemplateId) {
      const { recordActionVerdict } = await import("@/lib/autonomy");
      void recordActionVerdict(
        "template_pick",
        draft.templateId === draft.enginePickedTemplateId ? "accepted" : "rejected",
        input.draftId,
        { picked: draft.enginePickedTemplateId, sent: draft.templateId ?? null },
      );
    }
  } catch (err) {
    logger.warn({ err, draftId: input.draftId }, "suggestion feedback skipped (non-fatal)");
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
