"use client";

/**
 * ComposerWindow — single floating composer window.
 *
 * Modes:
 *   docked     — default. ~520px wide, sits in the bottom-right stack
 *   minimized  — header bar only ("New Message" + From + recipient hint)
 *   expanded   — wider (~720px) for longer drafts
 *   fullscreen — centered overlay near-full-viewport for serious writing
 *
 * On mobile (< 640px):
 *   All modes collapse to a single full-screen bottom sheet
 *   regardless of the requested mode — floating on mobile is unusable.
 *
 * Polish layer (commit 2 features):
 *   - Recipient chips with email validation (To/CC/BCC)
 *   - Lightweight contenteditable rich-text editor + toolbar
 *   - Attachments chip list (UI-only — storage TODO)
 *   - Split Send menu (Send now / Schedule / Send test / Save as draft)
 *   - Undo Send queue (UNDO_WINDOW_MS pre-send delay)
 *   - After-send follow-up prompt
 *
 * Lifecycle / persistence:
 *   - First render creates an in-memory draft id (already set in the
 *     store). Every keystroke debounced-autosaves via upsertDraft.
 *   - Send button schedules the actual sendDraft call after a brief
 *     undo window so the operator can pull it back if they spot a typo.
 *   - Close button:
 *       * with unsaved content + draft status != 'saved' → confirm
 *       * otherwise → close immediately; row stays in DB so the user
 *         can resume from listMyDrafts (future feature)
 */

import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import type { TeamLabelSummary } from "@/lib/team-labels";
import {
  AlertCircle,
  Image as ImageIcon,
  Link as LinkIcon,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  MoreHorizontal,
  PenLine,
  SendHorizontal,
  Smile,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  type ComposeRenderContext,
  type ComposeTemplate,
  type ConnectedAccountOption,
  listComposeContext,
} from "../../_actions/compose-and-send";
import { deleteDraft, queueColdSend, sendDraft, upsertDraft } from "../../_actions/email-drafts";
import { type EnginePickResult, pickTemplateForComposer } from "../../_actions/engine-pick";
import { SafetyWarningDialog } from "./SafetyWarningDialog";
import { AttachmentList } from "./attachment-list";
import { type ComposerInstance, type ComposerMode, useComposer } from "./composer-store";
import { CooldownRing } from "./cooldown-ring";
import { FollowUpPrompt } from "./follow-up-prompt";
import { PreviewModal } from "./preview-modal";
import { RecipientChips } from "./recipient-chips";
import { RichTextEditor } from "./rich-text-editor";
import { SendMenu } from "./send-menu";
import { SubjectSuggestButton } from "./subject-suggest-button";

const AUTOSAVE_DEBOUNCE_MS = 1500;
/** Gmail's undo-send window is configurable up to 30s; 15s is the
 *  default. We follow that. After this elapses the actual send is
 *  dispatched. */
const UNDO_WINDOW_MS = 15_000;

interface Props {
  instance: ComposerInstance;
  index: number;
  isMobile: boolean;
}

// Internal helper: split a CSV string into a clean address array.
function parseAddressList(s: string): string[] {
  return s
    .split(/[,;\n]/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

async function applyTemplate(
  templateId: string,
  templates: ComposeTemplate[],
  renderContext: ComposeRenderContext,
  setPatch: (patch: { subject: string; bodyText: string; bodyHtml: string | null }) => void,
) {
  const t = templates.find((x) => x.id === templateId);
  if (!t) return;
  const { renderTemplate } = await import("@/lib/template-render");
  // {{company_name}} falls back to the template's own brand when the render
  // context didn't resolve it (e.g. the composer opened without a city-campaign
  // attribution), so the body never renders a blank brand ("on behalf of  to").
  const ctx = renderContext.company_name?.trim()
    ? renderContext
    : { ...renderContext, company_name: t.brandName ?? renderContext.company_name ?? "" };
  const subj = renderTemplate(t.subjectTemplate, ctx);
  const body = renderTemplate(t.bodyTemplateText, ctx);
  // Convert the plain-text template body to minimal HTML for the rich text
  // editor. Paragraphs (separated by a blank line in the source) are joined
  // with an empty paragraph so the editor shows real spacing between them;
  // single newlines within a paragraph become <br>.
  const html = body.output
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("<p></p>");
  setPatch({ subject: subj.output, bodyText: body.output, bodyHtml: html });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Strip the engine reason down to its human description for the banner: the
 * scorer's reason reads "T1: cold, first touch, Prio 1 (match score 50)" but
 * the banner already shows the code separately and the raw score is noise.
 */
function cleanReason(code: string, reason: string): string {
  let r = reason.startsWith(`${code}:`) ? reason.slice(code.length + 1) : reason;
  r = r.replace(/\s*\(match score \d+\)\s*$/, "");
  return r.trim();
}

/**
 * Strip a previously-auto-appended signature block from HTML. The
 * composer wraps auto-appended signatures in a
 * <div data-composer-signature="true">...</div> element which the
 * Tiptap SignatureBlock node round-trips cleanly. Older drafts may
 * still carry the previous <!--composer-signature--> HTML-comment
 * markers; we strip both shapes so a draft created before the
 * Tiptap port still swaps correctly.
 *
 * Manually-edited signatures (operator deleted the markers or typed
 * their own) are LEFT ALONE — we only strip blocks we own.
 */
function stripSignatureBlock(html: string): string {
  return html
    .replace(/(?:<br\s*\/?>\s*)?<div[^>]*\sdata-composer-signature[^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/(?:<br\s*\/?>\s*)?<!--composer-signature-->[\s\S]*?<!--\/composer-signature-->/gi, "")
    .replace(/\s+$/, "");
}

export function ComposerWindow({ instance, isMobile }: Props) {
  const { close, setMode, setField, setStatus } = useComposer();
  const [inboxes, setInboxes] = useState<ConnectedAccountOption[] | null>(null);
  const [templates, setTemplates] = useState<ComposeTemplate[] | null>(null);
  const [renderContext, setRenderContext] = useState<ComposeRenderContext>({});
  // Team labels (incl. the pre-tagged campaign + city labels) for the
  // always-visible applied-labels chip row.
  const [labels, setLabels] = useState<TeamLabelSummary[] | null>(null);
  // Engine template auto-pick (Phase 1.5). enginePick holds the pick +
  // alternatives for the banner; enginePickOpen toggles the alternatives
  // list; enginePickDismissed hides the banner after "Use blank instead".
  // The ref guards the one-shot auto-load so it never re-fires on re-render.
  const [enginePick, setEnginePick] = useState<EnginePickResult | null>(null);
  const [enginePickOpen, setEnginePickOpen] = useState(false);
  const [enginePickDismissed, setEnginePickDismissed] = useState(false);
  const enginePickRanRef = useRef(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [capBlocked, setCapBlocked] = useState(false);
  const [cooldownBlocked, setCooldownBlocked] = useState(false);
  const [wrongAccountBlocked, setWrongAccountBlocked] = useState(false);
  // Cadence floor block (Phase 2.10). Set when a send is refused because the
  // venue is at its cross-domain cadence floor; the warning block offers
  // Cancel / Schedule-for-earliest / admin Override-with-reason.
  const [cadenceBlock, setCadenceBlock] = useState<{
    reason: string | null;
    earliestAllowedAt: string | null;
    hardCapReached: boolean;
  } | null>(null);
  const [cadenceOverrideReason, setCadenceOverrideReason] = useState("");
  /**
   * Set when the server returned safety warnings (recent decline,
   * cross-staff ownership, duplicate outreach). Triggers the
   * pre-send confirm dialog instead of the generic error toast.
   * Cleared on dismiss/proceed/successful retry.
   *
   * The shape mirrors lib/send-safety SafetyWarning; we type as
   * unknown here so we don't pull a server-only module into the
   * client bundle. The runtime shape check + render-by-kind
   * narrows the type at the rendering site.
   */
  const [pendingSafetyWarnings, setPendingSafetyWarnings] = useState<
    Array<Record<string, unknown>>
  >([]);
  const [sending, startSendTx] = useTransition();
  const toast = useToast();
  /** undo-window timer: when non-null, we're in the queued-send window
   *  and the operator can cancel. */
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [undoActive, setUndoActive] = useState(false);
  const [sentThreadId, setSentThreadId] = useState<string | null>(null);
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // After a successful send we keep the window open showing the
  // FollowUpPrompt (one-click "schedule a follow-up" affordance) rather
  // than closing instantly. But it must not linger forever — operators
  // reported the composer "stays popped up" after sending. Auto-close
  // after a grace window; the operator can still pick a follow-up preset
  // or hit Close before then, and acting flips showFollowUp false (via
  // onClose) which clears this timer.
  useEffect(() => {
    if (!showFollowUp) return;
    const t = setTimeout(() => close(instance.id), 12_000);
    return () => clearTimeout(t);
  }, [showFollowUp, close, instance.id]);
  // Toolbar visibility — Gmail collapses the formatting toolbar by
  // default and surfaces it via the Aa toggle. We default to open
  // on first paint so power users see the affordances; the toggle
  // persists nothing (per-composer state is fine since reopening a
  // draft re-mounts the editor).
  const [toolbarOpen, setToolbarOpen] = useState(true);
  // Three-dot "more" menu in the footer (labels, spell check, etc).
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  // Emoji picker popover state.
  const [emojiOpen, setEmojiOpen] = useState(false);

  // Recipient parsed lists kept as derived arrays for the chip
  // components. The store still holds the canonical CSV string.
  const toList = useMemo(() => parseAddressList(instance.to), [instance.to]);
  const ccList = useMemo(() => parseAddressList(instance.cc), [instance.cc]);
  const bccList = useMemo(() => parseAddressList(instance.bcc), [instance.bcc]);

  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstSaveRef = useRef(true);
  // Latest save inputs captured in a ref so triggerAutosave can stay
  // referentially STABLE. Previously triggerAutosave closed over the whole
  // `instance`, so each successful save -> setStatus(..., "saved") -> new
  // instance identity -> new triggerAutosave -> the autosave effect (which
  // lists triggerAutosave as a dep) re-fired -> another save: upsertDraft
  // looped every ~2s forever, hammering the server and dropping clicks
  // across the page (the "gear needs multiple taps" symptom). Reading from
  // a ref means status/lastSavedAt updates no longer change the callback.
  const saveInputsRef = useRef({ instance, toList, ccList, bccList });
  saveInputsRef.current = { instance, toList, ccList, bccList };

  // -------------------------------------------------------------
  // Load From / templates / render context once per composer.
  // -------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    listComposeContext({
      venueId: instance.venueId ?? undefined,
      cityCampaignId: instance.cityCampaignId ?? undefined,
      sendingAccountId: instance.fromAccountId || undefined,
    })
      .then((ctx) => {
        if (cancelled) return;
        setInboxes(ctx.inboxes);
        setTemplates(ctx.templates);
        setRenderContext(ctx.renderContext);
        setLabels(ctx.labels);
        // Pre-tag a fresh campaign-attributed draft with the campaign + city
        // labels so the operator SEES what the send will apply ("halloween
        // 2026" + city) before sending. Only when the draft has no labels yet
        // -- never clobber a restored draft or a manual selection.
        if (
          ctx.defaultLabelIds.length > 0 &&
          (!instance.pendingLabelIds || instance.pendingLabelIds.length === 0)
        ) {
          setField(instance.id, { pendingLabelIds: ctx.defaultLabelIds });
        }
        if (!instance.fromAccountId && ctx.inboxes[0]) {
          const first = ctx.inboxes[0];
          const patch: Partial<typeof instance> = { fromAccountId: first.id };
          // If the default inbox has a signature, seed the body with it.
          // Skip if the operator already typed content (initial-load
          // would have an empty body normally; defensive).
          if (first.signatureHtml && !instance.bodyHtml && !instance.bodyText.trim()) {
            patch.bodyHtml = `<p></p><div data-composer-signature="true">${first.signatureHtml}</div>`;
          }
          setField(instance.id, patch);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "Couldn't load inboxes.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance.venueId]);

  // -------------------------------------------------------------
  // Engine template auto-pick (Phase 1.5).
  //
  // Once templates have loaded, ask the engine which template fits this
  // composer's context (cold-outreach venue + city-campaign, or a reply
  // thread) and pre-load it. The operator can keep it, swap to an
  // alternative, or use a blank draft. We only auto-pick a FRESH, empty
  // draft the operator has not already templated, so restored drafts and
  // in-progress writing are never clobbered. One-shot via the ref guard.
  //
  // [ReferenceDoc Section 7 + 8.7] engine picks, operator overrides.
  // -------------------------------------------------------------
  useEffect(() => {
    // Cross-mount one-shot: enginePickAttempted lives on the persisted store
    // instance (which survives router.refresh, fired every 60s by
    // RealtimeRefresh). A component-local ref would reset on remount and let
    // the pick re-fire, clobbering the operator's chosen template -- the
    // "draft resets to T1 after a minute" bug. The local ref below still
    // guards against a double-run within a single mount (before the store
    // update propagates).
    if (instance.enginePickAttempted) return;
    if (enginePickRanRef.current) return;
    if (!templates || templates.length === 0) return;
    if (instance.templateId || instance.enginePickedTemplateId) return;
    if (instance.bodyText.trim()) return;
    const hasColdAttribution = Boolean(instance.venueId && instance.cityCampaignId);
    const hasReplyAttribution = instance.composeMode !== "new" && Boolean(instance.replyToThreadId);
    if (!hasColdAttribution && !hasReplyAttribution) return;

    enginePickRanRef.current = true;
    // Persist the attempt immediately so a remount mid-pick never re-runs it.
    setField(instance.id, { enginePickAttempted: true });
    let cancelled = false;
    pickTemplateForComposer({
      venueId: instance.venueId,
      cityCampaignId: instance.cityCampaignId,
      threadId: instance.replyToThreadId,
    })
      .then((res) => {
        if (cancelled || !res.ok) return;
        const pick = res.data.pick;
        if (!pick) return;
        // Defensive: only adopt the pick if its template is in the loaded
        // list (so applyTemplate can resolve subject/body for it).
        if (!templates.some((t) => t.id === pick.templateId)) return;
        setEnginePick(res.data);
        void applyTemplate(pick.templateId, templates, renderContext, (patch) =>
          setField(instance.id, {
            ...patch,
            templateId: pick.templateId,
            enginePickedTemplateId: pick.templateId,
          }),
        );
      })
      .catch(() => {
        /* engine pick is best-effort; composer opens blank on failure */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates, renderContext]);

  // Swap the loaded template to one of the engine's alternatives. The
  // recorded enginePickedTemplateId stays the engine's ORIGINAL pick so the
  // draft preserves the override signal; only the loaded templateId changes.
  const handleSwapToAlternative = useCallback(
    (templateId: string) => {
      if (!templates) return;
      setEnginePickOpen(false);
      void applyTemplate(templateId, templates, renderContext, (patch) =>
        setField(instance.id, { ...patch, templateId }),
      );
    },
    [templates, renderContext, instance.id, setField],
  );

  // "Use blank instead" clears the engine-loaded template + content and
  // hide the banner. enginePickedTemplateId is kept as the override record.
  const handleUseBlank = useCallback(() => {
    setEnginePickDismissed(true);
    setEnginePickOpen(false);
    setField(instance.id, { templateId: null, subject: "", bodyText: "", bodyHtml: null });
  }, [instance.id, setField]);

  // -------------------------------------------------------------
  // Debounced autosave.
  // -------------------------------------------------------------
  const triggerAutosave = useCallback(() => {
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(async () => {
      // Read the latest content from the ref, not a captured closure, so
      // this callback stays stable and save-completion does not re-arm it.
      const { instance: inst, toList: to, ccList: cc, bccList: bcc } = saveInputsRef.current;
      const hasContent = inst.to.trim() || inst.subject.trim() || inst.bodyText.trim();
      if (!hasContent && isFirstSaveRef.current) return;
      isFirstSaveRef.current = false;

      setStatus(inst.id, "saving");
      const result = await upsertDraft({
        id: inst.id,
        connectedAccountId: inst.fromAccountId || null,
        toAddresses: to,
        ccAddresses: cc,
        bccAddresses: bcc,
        subject: inst.subject,
        bodyText: inst.bodyText,
        bodyHtml: inst.bodyHtml,
        venueId: inst.venueId,
        cityCampaignId: inst.cityCampaignId,
        templateId: inst.templateId,
        enginePickedTemplateId: inst.enginePickedTemplateId,
        attachments: inst.attachments.map((a) => ({
          name: a.name,
          size: a.size,
          mime: a.mime,
          storage_key: a.storage_key,
        })),
        scheduledFor: inst.scheduledFor,
        mode: inst.composeMode,
        replyToThreadId: inst.replyToThreadId,
        replyToMessageId: inst.replyToMessageId,
        pendingLabelIds: inst.pendingLabelIds,
      });
      if (result.ok) {
        setStatus(inst.id, "saved", result.data.updatedAt);
      } else {
        setStatus(inst.id, "save_failed");
      }
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [setStatus]);

  useEffect(() => {
    triggerAutosave();
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [
    instance.to,
    instance.cc,
    instance.bcc,
    instance.subject,
    instance.bodyText,
    instance.bodyHtml,
    instance.fromAccountId,
    instance.attachments,
    instance.scheduledFor,
    triggerAutosave,
  ]);

  // -------------------------------------------------------------
  // Close + discard handlers
  // -------------------------------------------------------------
  function handleClose() {
    const hasContent = instance.to.trim() || instance.subject.trim() || instance.bodyText.trim();
    // Empty draft: just delete + close. Gmail does the same — no
    // point keeping a "Draft" row around for an unwritten message.
    if (!hasContent) {
      deleteDraft(instance.id).catch(() => {
        /* row may not exist yet; close anyway */
      });
      close(instance.id);
      return;
    }
    // There's content. Ask the operator whether to keep it saved or
    // delete from the Drafts folder. Binary native confirm — OK
    // discards (matches Gmail's trash-icon behavior); Cancel keeps
    // it saved.
    //
    // Phrased so OK = destructive action (delete) and Cancel =
    // safe (keep). This matches every browser confirm() convention
    // and avoids the trap where the operator mashes Enter and
    // loses work.
    const discard = confirm(
      "Discard this draft?\n\nOK = delete from Drafts.\nCancel = keep saved in Drafts.",
    );
    if (discard) {
      deleteDraft(instance.id).catch(() => {
        // Non-fatal — the row might already be gone; close anyway.
      });
    }
    // Either way the window closes. On Cancel, the draft stays
    // saved server-side (the autosave loop has already flushed) so
    // it'll be visible in the Drafts folder + can be reopened.
    close(instance.id);
  }

  function handleDiscard() {
    const hasContent = instance.to.trim() || instance.subject.trim() || instance.bodyText.trim();
    if (hasContent && !confirm("Permanently discard this draft?")) return;
    deleteDraft(instance.id).catch(() => {
      // Non-fatal — the row might already be gone; close anyway.
    });
    close(instance.id);
  }

  // -------------------------------------------------------------
  // Pre-send validation + dispatch through composeAndSend pipeline
  // with the Gmail-style undo queue
  // -------------------------------------------------------------
  function validate(): string | null {
    if (!instance.fromAccountId) return "Pick a From inbox before sending.";
    if (toList.length === 0) return "Add at least one recipient.";
    for (const addr of [...toList, ...ccList, ...bccList]) {
      if (!isValidEmail(addr)) return `Invalid email address: ${addr}`;
    }
    if (!instance.bodyText.trim()) return "Body can't be empty.";
    return null;
  }

  /** Actually fire the send (called once the undo window elapses). */
  function actuallySend(
    opts: {
      testOnly?: boolean;
      bypassCap?: boolean;
      ackDuplicates?: boolean;
      cadenceOverrideReason?: string;
    } = {},
  ) {
    startSendTx(async () => {
      // Persist final state of the draft so sendDraft has fresh data.
      const saveRes = await upsertDraft({
        id: instance.id,
        connectedAccountId: instance.fromAccountId,
        toAddresses: opts.testOnly
          ? // "Send test to myself" routes to the operator's own inbox
            // (using the From account's email_address as the recipient).
            [
              inboxes?.find((x) => x.id === instance.fromAccountId)?.emailAddress ??
                instance.fromAccountId,
            ]
          : toList,
        ccAddresses: opts.testOnly ? [] : ccList,
        bccAddresses: opts.testOnly ? [] : bccList,
        subject: opts.testOnly ? `[TEST] ${instance.subject}` : instance.subject,
        bodyText: instance.bodyText,
        bodyHtml: instance.bodyHtml,
        venueId: opts.testOnly ? null : instance.venueId,
        cityCampaignId: opts.testOnly ? null : instance.cityCampaignId,
        templateId: instance.templateId,
        enginePickedTemplateId: opts.testOnly ? null : instance.enginePickedTemplateId,
        attachments: instance.attachments,
        scheduledFor: null,
        mode: opts.testOnly ? "new" : instance.composeMode,
        replyToThreadId: opts.testOnly ? null : instance.replyToThreadId,
        replyToMessageId: opts.testOnly ? null : instance.replyToMessageId,
        pendingLabelIds: opts.testOnly ? [] : instance.pendingLabelIds,
      });
      if (!saveRes.ok) {
        setSendError(saveRes.error);
        setUndoActive(false);
        return;
      }
      const sendRes = await sendDraft(instance.id, {
        bypassCap: opts.bypassCap,
        ackDuplicates: opts.ackDuplicates,
        cadenceOverrideReason: opts.cadenceOverrideReason,
      });
      setUndoActive(false);
      if (!sendRes.ok) {
        // Cadence floor block (Phase 2.10) gets a dedicated inline warning
        // (Cancel / Schedule / admin Override) rather than a generic error.
        if (!opts.testOnly && sendRes.cadenceBlocked) {
          setCadenceBlock(
            sendRes.cadence ?? {
              reason: sendRes.error,
              earliestAllowedAt: null,
              hardCapReached: false,
            },
          );
          return;
        }
        // Safety warnings (decline, cross-staff, duplicate) get a
        // dedicated confirm dialog rather than a generic error
        // toast. Operators must explicitly acknowledge before the
        // engine will proceed with the send. Skip this branch on
        // test sends — those never trigger safety checks.
        const warnings = (sendRes.safetyWarnings ?? sendRes.duplicateWarnings ?? null) as Array<
          Record<string, unknown>
        > | null;
        if (!opts.testOnly && warnings && warnings.length > 0) {
          setPendingSafetyWarnings(warnings);
          // Don't show the error toast OR set sendError — the dialog
          // is the surface. sendError is reserved for hard blocks
          // (suppression, DNC, cap) that have no acknowledge path.
          return;
        }
        setSendError(sendRes.error);
        setCapBlocked(sendRes.capBlocked ?? false);
        setCooldownBlocked(sendRes.cooldownBlocked ?? false);
        setWrongAccountBlocked(sendRes.wrongAccountBlocked ?? false);
        toast.show({
          kind: "error",
          message: sendRes.capBlocked
            ? "Daily cold send cap reached."
            : sendRes.cooldownBlocked
              ? "Cold-send cooldown active - pacing between sends."
              : sendRes.wrongAccountBlocked
                ? "Wrong inbox for this thread."
                : `Send failed: ${sendRes.error}`,
        });
        return;
      }
      // Clear any prior safety dialog state on success.
      setPendingSafetyWarnings([]);
      setSentThreadId(sendRes.data.threadId);
      toast.show({
        kind: "success",
        message: opts.testOnly ? "Test sent to your inbox." : "Message sent.",
      });
      // Skip follow-up prompt on test sends.
      if (!opts.testOnly) {
        setShowFollowUp(true);
      } else {
        setTimeout(() => close(instance.id), 1200);
      }
    });
  }

  /** Send-now button entry point: queue with UNDO_WINDOW_MS delay. */
  function handleSendNow() {
    setSendError(null);
    setCapBlocked(false);
    setCooldownBlocked(false);
    setWrongAccountBlocked(false);
    setCadenceBlock(null);
    const err = validate();
    if (err) {
      setSendError(err);
      return;
    }
    if (!instance.subject.trim() && !confirm("Send with an empty subject?")) return;
    if (instance.scheduledFor) {
      // Scheduled drafts: store the timestamp + close. The 5-minute
      // /api/cron/scheduled-sends cron picks them up at the configured
      // time and routes through the same composeAndSend pipeline.
      handleSaveAsDraft();
      toast.show({
        kind: "success",
        message: `Scheduled to send ${new Date(instance.scheduledFor).toLocaleString("en-US")}.`,
      });
      return;
    }
    if (undoActive) return; // already queued
    setUndoActive(true);
    undoTimerRef.current = setTimeout(() => {
      actuallySend();
    }, UNDO_WINDOW_MS);
  }

  function handleUndoSend() {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setUndoActive(false);
    toast.show({ kind: "info", message: "Send canceled — message stays as a draft." });
  }

  function handleSendTest() {
    const err = validate();
    if (err && !err.startsWith("Add at least one recipient")) {
      setSendError(err);
      return;
    }
    actuallySend({ testOnly: true });
  }

  /**
   * Queue (send later): instead of firing now, persist the draft and let
   * queueColdSend assign an auto-staggered randomized scheduled_for (5-8 min
   * after the last queued send on this inbox). The scheduled-sends cron
   * dispatches it; the operator closes the composer and moves on. Lands on
   * the Email Queue page. This is the "send a batch and walk away" path the
   * operators asked for once the cold-send cooldown was added.
   */
  function handleQueue() {
    setSendError(null);
    const err = validate();
    if (err) {
      setSendError(err);
      return;
    }
    if (!instance.subject.trim() && !confirm("Queue with an empty subject?")) return;
    startSendTx(async () => {
      const saveRes = await upsertDraft({
        id: instance.id,
        connectedAccountId: instance.fromAccountId,
        toAddresses: toList,
        ccAddresses: ccList,
        bccAddresses: bccList,
        subject: instance.subject,
        bodyText: instance.bodyText,
        bodyHtml: instance.bodyHtml,
        venueId: instance.venueId,
        cityCampaignId: instance.cityCampaignId,
        templateId: instance.templateId,
        enginePickedTemplateId: instance.enginePickedTemplateId,
        attachments: instance.attachments,
        scheduledFor: null,
        mode: instance.composeMode,
        replyToThreadId: instance.replyToThreadId,
        replyToMessageId: instance.replyToMessageId,
        pendingLabelIds: instance.pendingLabelIds,
      });
      if (!saveRes.ok) {
        setSendError(saveRes.error);
        return;
      }
      const qRes = await queueColdSend(instance.id);
      if (!qRes.ok) {
        setSendError(qRes.error);
        toast.show({ kind: "error", message: qRes.error ?? "Couldn't queue the email." });
        return;
      }
      const at = new Date(qRes.data.scheduledFor).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      });
      toast.show({ kind: "success", message: `Queued - sends around ${at}. On to the next.` });
      close(instance.id);
    });
  }

  /**
   * Cadence "Schedule for <earliest>" (Phase 2.10). Persists the draft with
   * scheduled_for = the floor's earliest-allowed time instead of sending now;
   * the /api/cron/scheduled-sends cron fires it then (re-checking the floor,
   * which will have passed). Writes scheduledFor explicitly so it doesn't race
   * the setField state update.
   */
  function scheduleForCadence(iso: string) {
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    setField(instance.id, { scheduledFor: iso });
    setCadenceBlock(null);
    void upsertDraft({
      id: instance.id,
      connectedAccountId: instance.fromAccountId || null,
      toAddresses: toList,
      ccAddresses: ccList,
      bccAddresses: bccList,
      subject: instance.subject,
      bodyText: instance.bodyText,
      bodyHtml: instance.bodyHtml,
      venueId: instance.venueId,
      cityCampaignId: instance.cityCampaignId,
      templateId: instance.templateId,
      enginePickedTemplateId: instance.enginePickedTemplateId,
      attachments: instance.attachments,
      scheduledFor: iso,
      mode: instance.composeMode,
      replyToThreadId: instance.replyToThreadId,
      replyToMessageId: instance.replyToMessageId,
      pendingLabelIds: instance.pendingLabelIds,
    }).then((res) => {
      if (res.ok) setStatus(instance.id, "saved", res.data.updatedAt);
    });
    toast.show({
      kind: "success",
      message: `Scheduled to send ${new Date(iso).toLocaleString("en-US")}.`,
    });
    close(instance.id);
  }

  function handleSaveAsDraft() {
    // Force one final autosave then close.
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    void upsertDraft({
      id: instance.id,
      connectedAccountId: instance.fromAccountId || null,
      toAddresses: toList,
      ccAddresses: ccList,
      bccAddresses: bccList,
      subject: instance.subject,
      bodyText: instance.bodyText,
      bodyHtml: instance.bodyHtml,
      venueId: instance.venueId,
      cityCampaignId: instance.cityCampaignId,
      templateId: instance.templateId,
      enginePickedTemplateId: instance.enginePickedTemplateId,
      attachments: instance.attachments,
      scheduledFor: instance.scheduledFor,
      mode: instance.composeMode,
      replyToThreadId: instance.replyToThreadId,
      replyToMessageId: instance.replyToMessageId,
      pendingLabelIds: instance.pendingLabelIds,
    }).then((res) => {
      if (res.ok) setStatus(instance.id, "saved", res.data.updatedAt);
    });
    close(instance.id);
  }

  function handleSaveAsTemplate() {
    // Prompt for a name. v1 uses window.prompt; a fancier dialog is
    // possible later (stage picker, brand picker, default checkbox)
    // but for the common case of an admin saving the current draft
    // as a reusable starting point, prompt() is fine + fast.
    const name = prompt("Template name (visible in the picker)");
    if (!name) return;
    void (async () => {
      const mod = await import("../../_actions/compose-and-send");
      const res = await mod.saveDraftAsTemplate({
        name,
        subject: instance.subject,
        bodyText: instance.bodyText,
        bodyHtml: instance.bodyHtml,
      });
      if (res.ok) {
        setSendError(null);
        toast.show({ kind: "success", message: `Template "${name}" saved.` });
      } else {
        setSendError(res.error);
        toast.show({ kind: "error", message: res.error });
      }
    })();
  }

  /**
   * Recipient autocomplete callback shared by the To/Cc/Bcc chip
   * inputs. Returns up to 15 matches across venue contacts +
   * previously-emailed addresses; dedupe + filter against the
   * current chip value happens inside RecipientChips.
   */
  const fetchSuggestions = useCallback(
    async (query: string) => {
      const mod = await import("../../_actions/compose-and-send");
      return mod.suggestRecipients({
        venueId: instance.venueId,
        query,
        fromAccountId: instance.fromAccountId,
      });
    },
    [instance.venueId, instance.fromAccountId],
  );

  // Cmd/Ctrl + Enter sends.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        if (instance.mode === "minimized") return;
        e.preventDefault();
        handleSendNow();
      }
      if (e.key === "Escape") {
        // Esc minimizes (not destructive close) per spec.
        if (instance.mode !== "minimized") {
          setMode(instance.id, "minimized");
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance]);

  // -------------------------------------------------------------
  // Layout / mode classes
  // -------------------------------------------------------------
  const effectiveMode: ComposerMode = isMobile ? "fullscreen" : instance.mode;

  if (effectiveMode === "minimized") {
    return (
      <div
        className="pointer-events-auto flex w-60 shrink-0 items-center justify-between gap-1.5 rounded-t-md border border-zinc-200 border-b-0 bg-white px-2.5 py-1.5 shadow-md hover:shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        role="region"
        aria-label="Minimized composer"
      >
        <button
          type="button"
          onClick={() => setMode(instance.id, "docked")}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs"
          title="Restore composer"
        >
          {instance.composeMode === "reply" || instance.composeMode === "reply_all" ? (
            <span className="shrink-0 font-mono text-[9px] text-blue-600 uppercase tracking-widest dark:text-blue-400">
              Re:
            </span>
          ) : instance.composeMode === "forward" ? (
            <span className="shrink-0 font-mono text-[9px] text-violet-600 uppercase tracking-widest dark:text-violet-400">
              Fwd:
            </span>
          ) : null}
          <span className="truncate font-medium">
            {instance.subject || (instance.to ? `To: ${instance.to}` : "New Message")}
          </span>
          {instance.draftStatus === "saving" && (
            <Loader2
              className="h-2.5 w-2.5 shrink-0 animate-spin text-zinc-400"
              aria-label="Saving"
            />
          )}
        </button>
        <button
          type="button"
          onClick={() => setMode(instance.id, "docked")}
          title="Restore"
          aria-label="Restore composer"
          className="shrink-0 rounded p-0.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <Maximize2 className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={handleClose}
          title="Close"
          aria-label="Close composer"
          className="shrink-0 rounded p-0.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  const widthClass =
    effectiveMode === "fullscreen"
      ? // Mobile: true full screen sized to the DYNAMIC viewport (100dvh)
        // so the footer/Send stays on-screen even with the browser address
        // bar showing (a plain fixed inset-y overflowed below the fold).
        // Desktop (sm+): the floating inset-12 fullscreen window.
        "fixed inset-0 h-[100dvh] max-h-[100dvh] max-w-none sm:inset-x-12 sm:inset-y-12 sm:h-auto sm:max-h-none"
      : effectiveMode === "inline"
        ? // Inline reply: fills the thread-pane width; height is
          // content-driven up to 60vh so a long quoted thread + edit
          // surface stays scrollable inside the window without
          // pushing the whole thread out of view.
          "w-full max-h-[60vh]"
        : effectiveMode === "expanded"
          ? // Mobile: full-bleed (minus a small safe-area margin) so
            // the composer doesn't horizontally overflow on a 375px
            // screen. Desktop keeps the 720px expanded width.
            "fixed inset-x-2 bottom-2 top-12 sm:static sm:w-[720px] sm:h-[640px] sm:max-h-[80vh] sm:inset-auto"
          : "fixed inset-x-2 bottom-2 top-16 sm:static sm:w-[540px] sm:h-[580px] sm:max-h-[80vh] sm:inset-auto";

  return (
    <div
      className={cn(
        "pointer-events-auto flex flex-col overflow-hidden bg-white dark:bg-zinc-950",
        // Inline lives INSIDE the thread surface — borderless, shadowless,
        // flat. Reads as "part of the thread" the way Gmail web does.
        // Docked / expanded / fullscreen sit on a fixed-position layer
        // with the chrome that signals "floating window."
        effectiveMode === "inline"
          ? ""
          : "rounded-t-lg border border-zinc-200 border-b-0 shadow-2xl dark:border-zinc-700",
        effectiveMode === "fullscreen" ? "z-[200] sm:rounded-lg sm:border" : "",
        widthClass,
      )}
      role="dialog"
      aria-label="Compose email"
    >
      {/* Header */}
      <header className="flex items-center justify-between gap-2 border-zinc-200 border-b bg-zinc-50 px-3 py-1.5 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-medium text-xs">{instance.subject || "New Message"}</span>
          <DraftStatusBadge instance={instance} />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/* Mobile: Send lives in the TOP bar (Gmail-style paper-airplane)
              so it's always reachable -- the footer SendMenu can be a long
              scroll away on a small screen. Fires the same queued send. */}
          {isMobile && (
            <button
              type="button"
              onClick={handleSendNow}
              disabled={(!!sendError && !undoActive) || sending || undoActive}
              title="Send"
              aria-label="Send"
              className="mr-1 inline-flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900 text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              <SendHorizontal className="h-4 w-4" />
            </button>
          )}
          {effectiveMode === "inline" ? (
            // Inline-mode popout: move the same draft to the docked
            // bottom-right composer without losing typed content,
            // attachments, formatting, or quoted-thread state. Same
            // composer-store instance, just a mode swap.
            <button
              type="button"
              onClick={() => setMode(instance.id, "docked")}
              title="Pop out to bottom-right composer"
              className="rounded p-1 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setMode(instance.id, "minimized")}
              title="Minimize (Esc)"
              className="rounded p-1 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
          )}
          {effectiveMode !== "inline" && (
            <button
              type="button"
              onClick={() =>
                setMode(
                  instance.id,
                  effectiveMode === "fullscreen"
                    ? "docked"
                    : effectiveMode === "expanded"
                      ? "fullscreen"
                      : "expanded",
                )
              }
              title={
                effectiveMode === "fullscreen"
                  ? "Restore"
                  : effectiveMode === "expanded"
                    ? "Full screen"
                    : "Expand"
              }
              className="rounded p-1 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              {effectiveMode === "fullscreen" ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={handleClose}
            title="Close"
            className="rounded p-1 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-white text-zinc-900">
        {loadError && (
          <p className="border-zinc-200 border-b bg-rose-50 px-3 py-2 text-rose-800 text-xs dark:border-zinc-800 dark:bg-rose-950 dark:text-rose-200">
            {loadError}
          </p>
        )}

        {/* From */}
        <div className="flex items-center gap-2 border-zinc-200 border-b px-4 py-2.5 text-sm dark:border-zinc-800">
          <span className="w-12 shrink-0 text-zinc-500">From</span>
          {inboxes === null ? (
            <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />
          ) : (
            <select
              value={instance.fromAccountId}
              onChange={(e) => {
                const newId = e.target.value;
                const newInbox = inboxes.find((x) => x.id === newId);
                // Swap signature in place: strip the previous inbox's
                // signature block (marked by <!--composer-signature-->)
                // and append the new one. Idempotent if the operator
                // hasn't inlined a different signature.
                const patch: Partial<typeof instance> = { fromAccountId: newId };
                const stripped = stripSignatureBlock(instance.bodyHtml ?? "");
                const newSig = newInbox?.signatureHtml ?? null;
                if (newSig) {
                  patch.bodyHtml = `${stripped}<div data-composer-signature="true">${newSig}</div>`;
                } else {
                  patch.bodyHtml = stripped || null;
                }
                setField(instance.id, patch);
              }}
              className="flex-1 bg-transparent text-xs outline-none"
            >
              <option value="">— Select an inbox —</option>
              {inboxes.map((inbox) => {
                // Show the cap remaining beside each option. When the
                // account is at cap, indicate so the operator sees it
                // before clicking. The actual cold-outreach gate is
                // enforced server-side via preflightSend; this is the
                // UX hint.
                const capHint =
                  typeof inbox.coldSendsUsed === "number" && typeof inbox.coldSendCap === "number"
                    ? ` · ${inbox.coldSendsUsed}/${inbox.coldSendCap}${inbox.atCap ? " (at cap)" : ""}`
                    : "";
                return (
                  <option key={inbox.id} value={inbox.id} disabled={inbox.atCap}>
                    {inbox.emailAddress}
                    {inbox.status !== "connected" ? ` (${inbox.status})` : ""}
                    {inbox.signatureHtml ? " · ✎" : ""}
                    {capHint}
                  </option>
                );
              })}
            </select>
          )}
          {/* Cold-send pacing cooldown ring (migration 0106) for the selected
              From inbox. Renders nothing when no cooldown is active. */}
          <CooldownRing
            until={
              inboxes?.find((x) => x.id === instance.fromAccountId)?.coldSendCooldownUntil ?? null
            }
          />
        </div>

        {/* Applied-labels chip row -- the Gmail labels this send will get
            (campaign + city, pre-tagged for campaign-attributed sends), shown
            at a glance so operators can SEE the tagging without opening the
            labels menu. Hidden when no labels are queued. */}
        {labels && instance.pendingLabelIds && instance.pendingLabelIds.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 border-zinc-200 border-b px-4 py-2 text-xs dark:border-zinc-800">
            <Tag className="h-3 w-3 shrink-0 text-zinc-400" />
            <span className="text-zinc-500">Labels:</span>
            {instance.pendingLabelIds.map((id) => {
              const l = labels.find((x) => x.id === id);
              return l ? (
                <span
                  key={id}
                  className="rounded-full bg-indigo-50 px-2 py-0.5 font-medium text-[11px] text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300"
                >
                  {l.name}
                </span>
              ) : null;
            })}
          </div>
        ) : null}

        {/* To row with CC/BCC reveal */}
        <div className="flex items-start gap-2 border-zinc-200 border-b px-4 py-2.5 text-sm dark:border-zinc-800">
          <span className="w-12 shrink-0 pt-0.5 text-zinc-500">To</span>
          <RecipientChips
            value={toList}
            onChange={(next) => setField(instance.id, { to: next.join(", ") })}
            placeholder="recipient@example.com"
            ariaLabel="To recipients"
            suggestions={fetchSuggestions}
          />
          <div className="flex shrink-0 items-center gap-1 pt-0.5">
            {!instance.showCc && (
              <button
                type="button"
                onClick={() => setField(instance.id, { showCc: true })}
                className="text-[10px] text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                Cc
              </button>
            )}
            {!instance.showBcc && (
              <button
                type="button"
                onClick={() => setField(instance.id, { showBcc: true })}
                className="text-[10px] text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                Bcc
              </button>
            )}
          </div>
        </div>

        {instance.showCc && (
          <div className="flex items-start gap-2 border-zinc-200 border-b px-4 py-2.5 text-sm dark:border-zinc-800">
            <span className="w-12 shrink-0 pt-0.5 text-zinc-500">Cc</span>
            <RecipientChips
              value={ccList}
              onChange={(next) => setField(instance.id, { cc: next.join(", ") })}
              ariaLabel="Cc recipients"
              suggestions={fetchSuggestions}
            />
          </div>
        )}

        {instance.showBcc && (
          <div className="flex items-start gap-2 border-zinc-200 border-b px-4 py-2.5 text-sm dark:border-zinc-800">
            <span className="w-12 shrink-0 pt-0.5 text-zinc-500">Bcc</span>
            <RecipientChips
              value={bccList}
              onChange={(next) => setField(instance.id, { bcc: next.join(", ") })}
              ariaLabel="Bcc recipients"
              suggestions={fetchSuggestions}
            />
          </div>
        )}

        {/* Template */}
        {templates && templates.length > 0 && (
          <div className="flex items-center gap-2 border-zinc-200 border-b px-4 py-2.5 text-sm dark:border-zinc-800">
            <span className="w-12 shrink-0 text-zinc-500">Template</span>
            <select
              value={instance.templateId ?? ""}
              onChange={(e) => {
                const tid = e.target.value || null;
                setField(instance.id, { templateId: tid });
                if (tid) {
                  applyTemplate(tid, templates, renderContext, (patch) =>
                    setField(instance.id, patch),
                  );
                }
              }}
              className="flex-1 bg-transparent text-xs outline-none"
            >
              <option value="">— Pick a template —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.brandName} · {t.name} ({t.stage.replace(/_/g, " ")})
                  {t.isDefaultForStage ? " ★" : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Subject */}
        <div className="flex items-center gap-2 border-zinc-200 border-b px-4 py-2.5 text-sm dark:border-zinc-800">
          <input
            type="text"
            value={instance.subject}
            onChange={(e) => setField(instance.id, { subject: e.target.value })}
            placeholder="Subject"
            className="min-w-0 flex-1 bg-transparent font-medium text-xs outline-none"
          />
          {/* AI subject-line suggester (Haiku ROI #3). Visible when
              the body has > 30 chars; clicking opens 3 chip options
              the operator picks from. Cheap (~$0.001/call). */}
          <SubjectSuggestButton
            bodyText={instance.bodyText}
            currentSubject={instance.subject}
            venueName={null}
            cityName={null}
            recipientName={null}
            recipientEmail={instance.to.split(",")[0]?.trim() || null}
            mode={instance.composeMode === "new" ? "cold" : "reply"}
            onApply={(s) => setField(instance.id, { subject: s })}
          />
        </div>

        {/* Engine template auto-pick banner (Phase 1.5). Shows what the
            engine pre-loaded, with the option to swap to an alternative or
            start from a blank draft. [ReferenceDoc Section 7 + 8.7] */}
        {enginePick?.pick && !enginePickDismissed && (
          <div className="border-zinc-200 border-b bg-indigo-50 px-4 py-2 text-xs dark:border-zinc-800 dark:bg-indigo-950">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-indigo-900 dark:text-indigo-200">
                <span aria-hidden="true">{"\u{1F916}"} </span>
                Engine picked: <span className="font-semibold">{enginePick.pick.templateCode}</span>{" "}
                <span className="text-indigo-700 dark:text-indigo-300">
                  ({cleanReason(enginePick.pick.templateCode, enginePick.pick.reason)})
                </span>
              </span>
              {enginePick.alternatives.length > 0 && (
                <button
                  type="button"
                  onClick={() => setEnginePickOpen((o) => !o)}
                  className="font-medium text-indigo-700 underline underline-offset-2 dark:text-indigo-300"
                >
                  {enginePickOpen ? "Hide alternatives" : "See alternatives"}
                </button>
              )}
              <button
                type="button"
                onClick={handleUseBlank}
                className="font-medium text-indigo-700 underline underline-offset-2 dark:text-indigo-300"
              >
                Use blank instead
              </button>
            </div>
            {enginePickOpen && enginePick.alternatives.length > 0 && (
              <ul className="mt-1.5 flex flex-col gap-1">
                {enginePick.alternatives.map((alt) => (
                  <li key={alt.templateId}>
                    <button
                      type="button"
                      onClick={() => handleSwapToAlternative(alt.templateId)}
                      className="text-left text-indigo-800 hover:underline dark:text-indigo-200"
                    >
                      <span className="font-semibold">{alt.templateCode}</span>
                      {(() => {
                        const desc = cleanReason(alt.templateCode, alt.reason);
                        return desc ? (
                          <span className="text-indigo-600 dark:text-indigo-400">{` ${desc}`}</span>
                        ) : null;
                      })()}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Body — rich text */}
        <RichTextEditor
          valueHtml={instance.bodyHtml}
          valueText={instance.bodyText}
          onChange={({ text, html }) => setField(instance.id, { bodyText: text, bodyHtml: html })}
          // min height keeps the reply field usable when the (now scrollable)
          // body also shows the expanded original below it.
          className="min-h-[10rem] flex-1"
          showToolbar={toolbarOpen}
        />

        {/* Collapsed quoted-thread chip — Gmail-parity. Shows when
            this is a reply/forward draft (quotedHtml present) so the
            operator sees a single "..." button instead of the
            quoted original wall-of-text by default. Click to expand
            in place; click again to re-collapse. The quoted content
            is read-only here — the operator types their reply above
            the editor; compose-send-impl re-attaches the quote on
            send. */}
        {instance.quotedHtml && <QuotedThreadBlock html={instance.quotedHtml} />}

        {sendError && (
          <div className="flex items-start gap-2 border-zinc-200 border-t bg-rose-50 px-3 py-2 text-rose-800 text-xs dark:border-zinc-800 dark:bg-rose-950 dark:text-rose-200">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="flex-1">{sendError}</span>
          </div>
        )}

        {/* Cadence floor warning (Phase 2.10). Surfaced when the send was
            refused because the venue is at its cross-domain cadence floor.
            Non-admins get Cancel + Schedule; admins also get an override that
            logs a reason to email_send_events.cadence_override_reason. */}
        {cadenceBlock && (
          <div className="flex flex-col gap-2 border-zinc-200 border-t bg-amber-50 px-3 py-2 text-amber-900 text-xs dark:border-zinc-800 dark:bg-amber-950/40 dark:text-amber-200">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              <div className="flex-1">
                <p className="font-medium">Cadence floor would be violated</p>
                <p className="mt-0.5 opacity-90">
                  {cadenceBlock.reason ?? "This venue is at its cadence floor."}
                  {cadenceBlock.earliestAllowedAt
                    ? ` Earliest allowed: ${new Date(
                        cadenceBlock.earliestAllowedAt,
                      ).toLocaleDateString("en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        timeZone: "America/Toronto",
                      })}.`
                    : ""}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setCadenceBlock(null)}
                className="rounded-md border border-amber-300 bg-white px-2 py-1 text-amber-800 dark:border-amber-900/40 dark:bg-zinc-900 dark:text-amber-200"
              >
                Cancel
              </button>
              {cadenceBlock.earliestAllowedAt && (
                <button
                  type="button"
                  onClick={() => scheduleForCadence(cadenceBlock.earliestAllowedAt as string)}
                  className="rounded-md border border-amber-300 bg-amber-100 px-2 py-1 text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/40 dark:text-amber-100"
                >
                  Schedule for{" "}
                  {new Date(cadenceBlock.earliestAllowedAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    timeZone: "America/Toronto",
                  })}
                </button>
              )}
            </div>
            {instance.isAdmin && (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={cadenceOverrideReason}
                  onChange={(e) => setCadenceOverrideReason(e.target.value)}
                  placeholder="Override reason (required, admin)"
                  className="min-w-48 flex-1 rounded-md border border-amber-300 bg-white px-2 py-1 text-amber-900 placeholder:text-amber-500 dark:border-amber-900/40 dark:bg-zinc-900 dark:text-amber-100"
                />
                <button
                  type="button"
                  disabled={!cadenceOverrideReason.trim()}
                  onClick={() => {
                    const reason = cadenceOverrideReason.trim();
                    if (!reason) return;
                    setCadenceBlock(null);
                    setCadenceOverrideReason("");
                    actuallySend({ cadenceOverrideReason: reason });
                  }}
                  className="rounded-md border border-amber-400 bg-amber-200 px-2 py-1 font-medium text-amber-900 disabled:opacity-50 dark:border-amber-800 dark:bg-amber-800/50 dark:text-amber-100"
                >
                  Override + send
                </button>
              </div>
            )}
          </div>
        )}

        {undoActive && (
          <div className="flex items-center justify-between gap-2 border-zinc-200 border-t bg-zinc-900 px-3 py-2 text-white text-xs dark:bg-zinc-100 dark:text-zinc-900">
            <span>Email queued. You have {UNDO_WINDOW_MS / 1000}s to undo.</span>
            <button
              type="button"
              onClick={handleUndoSend}
              className="font-medium underline underline-offset-2"
            >
              Undo
            </button>
          </div>
        )}

        {showFollowUp && (
          <FollowUpPrompt
            venueId={instance.venueId}
            threadId={sentThreadId}
            subject={instance.subject}
            to={toList[0] ?? ""}
            onClose={() => {
              setShowFollowUp(false);
              setTimeout(() => close(instance.id), 200);
            }}
          />
        )}
      </div>

      {/* Footer */}
      <footer className="flex items-center justify-between gap-2 border-zinc-200 border-t bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
        {/* min-w-0 + flex-wrap so on a narrow (mobile) footer the tool
            icons wrap to a second row instead of compressing the Send
            split-button into a deformed shape. */}
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <SendMenu
            disabled={!!sendError && !undoActive}
            pending={sending || undoActive}
            scheduledFor={instance.scheduledFor}
            onSendNow={handleSendNow}
            onSchedule={(iso) => setField(instance.id, { scheduledFor: iso })}
            onQueue={instance.composeMode === "new" ? handleQueue : undefined}
            onSendTest={handleSendTest}
            onSaveAsDraft={handleSaveAsDraft}
            onPreview={() => setShowPreview(true)}
            showSaveAsTemplate={instance.isAdmin}
            onSaveAsTemplate={handleSaveAsTemplate}
          />
          {capBlocked && instance.isAdmin && (
            <button
              type="button"
              onClick={() => {
                // Admin path: re-fire actuallySend with bypassCap=true.
                // composeAndSend re-checks the operator's role
                // server-side before honoring the flag.
                setCapBlocked(false);
                setSendError(null);
                actuallySend({ bypassCap: true });
              }}
              className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-amber-800 text-xs dark:border-amber-900/40 dark:bg-amber-950 dark:text-amber-200"
            >
              Bypass cap
            </button>
          )}
          {cooldownBlocked && instance.isAdmin && (
            <button
              type="button"
              onClick={() => {
                // Admin path: override the cold-send pacing cooldown. Reuses the
                // bypassCap flag (server re-checks the admin role).
                setCooldownBlocked(false);
                setSendError(null);
                actuallySend({ bypassCap: true });
              }}
              className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-amber-800 text-xs dark:border-amber-900/40 dark:bg-amber-950 dark:text-amber-200"
              title="Override the cold-send pacing cooldown (admin only)"
            >
              Send anyway
            </button>
          )}
          {wrongAccountBlocked && instance.isAdmin && (
            <button
              type="button"
              onClick={() => {
                // Admin path: re-fire with bypassCap=true. Same form
                // field as the cap bypass — compose-send-impl uses it
                // for both checks since the only legitimate reason to
                // hit either is admin override. Server re-checks role.
                setWrongAccountBlocked(false);
                setSendError(null);
                actuallySend({ bypassCap: true });
              }}
              className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-amber-800 text-xs dark:border-amber-900/40 dark:bg-amber-950 dark:text-amber-200"
              title="Send from the chosen From inbox anyway (admin only)"
            >
              Send anyway
            </button>
          )}
          {/* Aa — formatting toolbar toggle. Matches Gmail's
              placement: directly next to Send. */}
          <button
            type="button"
            onClick={() => setToolbarOpen((v) => !v)}
            title={toolbarOpen ? "Hide formatting options" : "Show formatting options"}
            aria-pressed={toolbarOpen}
            className={cn(
              "rounded p-1.5 font-semibold text-[11px]",
              toolbarOpen
                ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100"
                : "text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
            )}
          >
            Aa
          </button>
          {/* Compact icon row — Gmail-shaped affordances: attach
              files (handled by AttachmentList), insert link, emoji,
              photo (attachment with image MIME), signature, more. */}
          <AttachmentList
            draftId={instance.id}
            attachments={instance.attachments}
            onChange={(updater) =>
              setField(instance.id, {
                attachments:
                  typeof updater === "function" ? updater(instance.attachments) : updater,
              })
            }
          />
          <FooterIconButton
            title="Insert link"
            onClick={() => {
              const url = prompt("Link URL");
              if (!url) return;
              const safe = /^https?:\/\//i.test(url) ? url : `https://${url}`;
              // Wrap the selected text (or insert a link) in the body
              // HTML. The contenteditable inside RichTextEditor has the
              // focus selection; running execCommand here applies it.
              if (document.activeElement && "execCommand" in document) {
                // biome-ignore lint/suspicious/noExplicitAny: legacy surface
                (document as any).execCommand("createLink", false, safe);
              }
            }}
          >
            <LinkIcon className="h-3.5 w-3.5" />
          </FooterIconButton>
          <div className="relative">
            <FooterIconButton title="Insert emoji" onClick={() => setEmojiOpen((v) => !v)}>
              <Smile className="h-3.5 w-3.5" />
            </FooterIconButton>
            {emojiOpen && (
              <EmojiPicker
                onPick={(emoji) => {
                  setEmojiOpen(false);
                  // Append into the body text via setField; the editor
                  // will re-seed innerHTML on next paint.
                  const nextText = `${instance.bodyText}${emoji}`;
                  const nextHtml = `${instance.bodyHtml ?? ""}${emoji}`;
                  setField(instance.id, { bodyText: nextText, bodyHtml: nextHtml });
                }}
                onClose={() => setEmojiOpen(false)}
              />
            )}
          </div>
          <FooterIconButton
            title="Insert photo (uses attachment storage)"
            onClick={() => {
              // Fire a click on a hidden input that filters to images
              // — uses the same upload path as the paperclip.
              const input = document.createElement("input");
              input.type = "file";
              input.accept = "image/*";
              input.onchange = () => {
                // The AttachmentList component is mounted; we can't
                // call its add() directly without a ref, so we
                // dispatch a synthetic CustomEvent it can listen for.
                window.dispatchEvent(
                  new CustomEvent("composer-add-image", {
                    detail: { draftId: instance.id, files: input.files },
                  }),
                );
              };
              input.click();
            }}
          >
            <ImageIcon className="h-3.5 w-3.5" />
          </FooterIconButton>
          <FooterIconButton
            title="Insert signature"
            onClick={() => {
              // Re-insert the inbox's signature into the body via the
              // existing signature marker block. The composer mounts
              // this on initial seed; this is a manual re-trigger.
              const inbox = inboxes?.find((x) => x.id === instance.fromAccountId);
              if (!inbox?.signatureHtml) {
                alert(
                  "No signature configured for this inbox. Set one in Settings -> Inbox signatures.",
                );
                return;
              }
              const stripped = stripSignatureBlock(instance.bodyHtml ?? "");
              const nextHtml = `${stripped}<div data-composer-signature="true">${inbox.signatureHtml}</div>`;
              setField(instance.id, { bodyHtml: nextHtml });
            }}
          >
            <PenLine className="h-3.5 w-3.5" />
          </FooterIconButton>
          {/* Three-dot more menu — labels, spell check, etc. */}
          <div className="relative">
            <FooterIconButton title="More options" onClick={() => setMoreMenuOpen((v) => !v)}>
              <MoreHorizontal className="h-3.5 w-3.5" />
            </FooterIconButton>
            {moreMenuOpen && (
              <MoreMenu
                replyToThreadId={instance.replyToThreadId}
                pendingLabelIds={instance.pendingLabelIds}
                onPendingLabelsChange={(next) => setField(instance.id, { pendingLabelIds: next })}
                onClose={() => setMoreMenuOpen(false)}
                onCheckSpelling={() => {
                  // Hand off to the browser's native spell check by
                  // toggling the contenteditable's spellcheck attr.
                  const editor = document.querySelector('[contenteditable="true"]');
                  if (editor) {
                    editor.setAttribute(
                      "spellcheck",
                      editor.getAttribute("spellcheck") === "false" ? "true" : "false",
                    );
                  }
                  setMoreMenuOpen(false);
                }}
              />
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDiscard}
            title="Discard draft"
            className="rounded p-1 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </footer>
      {showPreview && (
        <PreviewModal
          instance={instance}
          fromEmailAddress={
            inboxes?.find((x) => x.id === instance.fromAccountId)?.emailAddress ?? null
          }
          onClose={() => setShowPreview(false)}
        />
      )}

      {/* Pre-send safety warning confirm dialog. Shown when the
          server returned warnings the operator needs to acknowledge
          before the send goes through. Calling actuallySend with
          ackDuplicates:true re-fires the same draft + skips the
          warning check. The form-field name `ackDuplicates` is
          historical — it covers every SafetyWarning kind today
          (decline, cross-staff, duplicate). */}
      {pendingSafetyWarnings.length > 0 && (
        <SafetyWarningDialog
          warnings={pendingSafetyWarnings}
          sending={sending}
          onCancel={() => setPendingSafetyWarnings([])}
          onConfirm={() => {
            setPendingSafetyWarnings([]);
            actuallySend({ ackDuplicates: true });
          }}
        />
      )}
    </div>
  );
}

function DraftStatusBadge({ instance }: { instance: ComposerInstance }) {
  switch (instance.draftStatus) {
    case "saving":
      return <span className="font-mono text-[10px] text-zinc-400">Saving…</span>;
    case "saved":
      return (
        <span className="font-mono text-[10px] text-zinc-500">
          Saved
          {instance.lastSavedAt && (
            <span title={new Date(instance.lastSavedAt).toLocaleString("en-US")} className="ml-1">
              ·{" "}
              {new Date(instance.lastSavedAt).toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "America/Toronto",
              })}
            </span>
          )}
        </span>
      );
    case "save_failed":
      return <span className="font-mono text-[10px] text-rose-600">Save failed — retrying</span>;
    default:
      return null;
  }
}

/** Small icon button for the composer footer's tool row. */
function FooterIconButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      onMouseDown={(e) => e.preventDefault()}
      className="rounded p-1.5 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
    >
      {children}
    </button>
  );
}

/** Minimal emoji picker — popover with a curated grid. Full Unicode
 *  picker would need a heavy library (emoji-picker-react ~150KB);
 *  for v1 we cover the common ones operators reach for in business
 *  email. A future commit can swap to a full picker behind the
 *  same surface. */
function EmojiPicker({ onPick, onClose }: { onPick: (e: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [onClose]);
  const COMMON = [
    "👋",
    "🙏",
    "👍",
    "🎉",
    "🔥",
    "✅",
    "✨",
    "💯",
    "🚀",
    "💪",
    "👀",
    "💼",
    "📧",
    "📅",
    "⏰",
    "🎯",
    "🤝",
    "💡",
    "📌",
    "🙌",
    "❤️",
    "😀",
    "😄",
    "😊",
    "😎",
    "🤔",
    "😢",
    "😅",
    "🙂",
    "😉",
    "👏",
    "🎊",
  ];
  return (
    <div
      ref={ref}
      className="absolute bottom-full left-0 z-30 mb-1 w-56 rounded-lg border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
    >
      <div className="mb-1 px-1 font-mono text-[9px] text-zinc-500 uppercase tracking-widest">
        Common emoji
      </div>
      <div className="grid grid-cols-8 gap-0.5">
        {COMMON.map((e) => (
          <button
            key={e}
            type="button"
            onMouseDown={(ev) => ev.preventDefault()}
            onClick={() => onPick(e)}
            className="rounded p-1 text-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Three-dot more menu — labels + spell check toggle. */
function MoreMenu({
  replyToThreadId,
  pendingLabelIds,
  onPendingLabelsChange,
  onClose,
  onCheckSpelling,
}: {
  replyToThreadId: string | null;
  /** Labels queued during compose (for new compose) or initial set
   *  (for reply compose). For replies, we still use the thread's
   *  applied labels as the source of truth and ignore this; it's
   *  only meaningful pre-send. */
  pendingLabelIds: string[];
  /** Setter for the composer-store's pendingLabelIds field. Called
   *  on every toggle so autosave can flush it to draft.pending_label_ids
   *  before the operator sends. */
  onPendingLabelsChange: (next: string[]) => void;
  onClose: () => void;
  onCheckSpelling: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [teamLabels, setTeamLabels] = useState<Array<{
    id: string;
    name: string;
    color: string | null;
  }> | null>(null);
  // For REPLY compose, this mirrors the thread's applied labels —
  // toggleLabel calls applyLabel/removeLabel actions immediately.
  // For NEW compose, this mirrors pendingLabelIds — toggleLabel just
  // updates the composer-store; actual apply happens on send.
  const [appliedLabelIds, setAppliedLabelIds] = useState<Set<string>>(
    () => new Set(pendingLabelIds),
  );
  const [labelsLoading, setLabelsLoading] = useState(false);

  useEffect(() => {
    function onDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [onClose]);

  // Lazy-load the team's labels + (for replies) the thread's
  // currently-applied set. Both modes need the team-labels list
  // for the picker; only replies need the thread-applied set.
  useEffect(() => {
    if (!labelsOpen) return;
    if (teamLabels !== null) return;
    setLabelsLoading(true);
    (async () => {
      try {
        const mod = await import("../../inbox/_actions");
        if (replyToThreadId) {
          // REPLY compose: load both. appliedLabelIds reflects the
          // thread state and toggles apply immediately.
          const [allLabels, threadLabels] = await Promise.all([
            mod.listTeamLabelsAction(),
            mod.listThreadLabelsAction(replyToThreadId),
          ]);
          if (allLabels.ok) setTeamLabels(allLabels.data);
          if (threadLabels.ok) {
            setAppliedLabelIds(new Set(threadLabels.data.map((l) => l.id)));
          }
        } else {
          // NEW compose: just the team-labels list. appliedLabelIds
          // is seeded from pendingLabelIds via useState initializer.
          const allLabels = await mod.listTeamLabelsAction();
          if (allLabels.ok) setTeamLabels(allLabels.data);
        }
      } finally {
        setLabelsLoading(false);
      }
    })();
  }, [labelsOpen, replyToThreadId, teamLabels]);

  async function toggleLabel(labelId: string) {
    const currentlyApplied = appliedLabelIds.has(labelId);
    // Optimistic flip so the operator sees the change instantly.
    const nextSet = new Set(appliedLabelIds);
    if (currentlyApplied) nextSet.delete(labelId);
    else nextSet.add(labelId);
    setAppliedLabelIds(nextSet);

    if (!replyToThreadId) {
      // NEW compose: queue locally. The composer-store's autosave
      // loop will flush this to draft.pending_label_ids; on send
      // the labels apply to the resulting thread.
      onPendingLabelsChange(Array.from(nextSet));
      return;
    }

    // REPLY compose: existing immediate-apply path.
    const mod = await import("../../inbox/_actions");
    const fd = new FormData();
    fd.set("threadId", replyToThreadId);
    fd.set("teamLabelId", labelId);
    const res = currentlyApplied
      ? await mod.removeLabelFromThreadAction(null, fd)
      : await mod.applyLabelToThreadAction(null, fd);
    if (!res.ok) {
      // Revert on failure.
      setAppliedLabelIds((prev) => {
        const next = new Set(prev);
        if (currentlyApplied) next.add(labelId);
        else next.delete(labelId);
        return next;
      });
      alert(res.error);
    }
  }

  return (
    <div
      ref={ref}
      className="absolute right-0 bottom-full z-30 mb-1 w-52 rounded-md border border-zinc-200 bg-white py-1 shadow-md dark:border-zinc-800 dark:bg-zinc-950"
    >
      <button
        type="button"
        onClick={onCheckSpelling}
        className="block w-full px-3 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-900"
      >
        Toggle spell check
      </button>
      <button
        type="button"
        onClick={() => setLabelsOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-900"
      >
        <span>
          Labels
          {!replyToThreadId && appliedLabelIds.size > 0 && (
            <span className="ml-1 rounded-sm bg-indigo-100 px-1 font-mono text-[9px] text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
              {appliedLabelIds.size}
            </span>
          )}
          {!replyToThreadId && (
            <span
              className="ml-1 font-mono text-[9px] text-zinc-400"
              title="Labels queued during compose — applied to the new thread after send"
            >
              (after send)
            </span>
          )}
        </span>
        <span className="text-zinc-400">{labelsOpen ? "▲" : "▼"}</span>
      </button>
      {labelsOpen && (
        <div className="max-h-56 overflow-y-auto border-zinc-200/70 border-t dark:border-zinc-800">
          {labelsLoading && <p className="px-3 py-1.5 text-[10px] text-zinc-400">Loading…</p>}
          {teamLabels && teamLabels.length === 0 && (
            <p className="px-3 py-1.5 text-[10px] text-zinc-400">
              No team labels. Create one in Settings.
            </p>
          )}
          {teamLabels?.map((label) => {
            const applied = appliedLabelIds.has(label.id);
            return (
              <button
                key={label.id}
                type="button"
                onClick={() => toggleLabel(label.id)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-900"
              >
                <span
                  aria-hidden="true"
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: label.color ?? "#a1a1aa" }}
                />
                <span className="flex-1 truncate">{label.name}</span>
                {applied && <span className="text-[10px] text-emerald-600">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * QuotedThreadBlock — Gmail-style "..." chip that toggles a
 * read-only preview of the quoted original message. Collapsed by
 * default so the editable surface above stays uncluttered. The
 * actual quoted content is stored on draft.quoted_html and gets
 * concatenated onto bodyHtml at send time inside sendDraftAsUser,
 * so it's always delivered regardless of whether the operator
 * expanded the chip in the composer.
 *
 * dangerouslySetInnerHTML is safe here because:
 *   1. The HTML originated server-side from openReplyDraft which
 *      HTML-escapes the message text before wrapping in the quote
 *      structure. We never store user-typed HTML into quotedHtml.
 *   2. The rendered block is non-editable and isolated from form
 *      submission paths — its content travels with the draft row,
 *      not through any client-side form parsing.
 */
function QuotedThreadBlock({ html }: { html: string }) {
  // Expanded by default so the original message shows below the reply for
  // context (Gmail-mobile behavior). The operator can collapse it.
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="border-zinc-200 border-t bg-white px-3 py-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        title={expanded ? "Hide original message" : "Show original message"}
        aria-label={expanded ? "Hide original message" : "Show original message"}
        className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700"
      >
        <span className="inline-flex items-center gap-0.5">
          <span className="h-1 w-1 rounded-full bg-current" />
          <span className="h-1 w-1 rounded-full bg-current" />
          <span className="h-1 w-1 rounded-full bg-current" />
        </span>
        {expanded ? "Hide original" : "Show original"}
      </button>
      {expanded && (
        <div
          // Forced-light card so the quoted original reads on white (matching
          // the message you're replying to) regardless of app theme, and so
          // the original email's own HTML colors stay legible.
          className="mt-2 max-w-full overflow-x-auto break-words rounded-md bg-white p-3 text-xs text-zinc-700 [&_.gmail_attr]:mb-1 [&_.gmail_attr]:text-zinc-500 [&_.gmail_attr]:italic [&_blockquote]:my-1 [&_blockquote]:border-zinc-300 [&_blockquote]:border-l [&_blockquote]:pl-2 [&_img]:max-w-full [&_table]:max-w-full"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted server-built quote markup, see comment above
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}
