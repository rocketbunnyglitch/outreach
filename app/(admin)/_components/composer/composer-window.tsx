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
import { AlertCircle, Loader2, Maximize2, Minimize2, Minus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  type ComposeRenderContext,
  type ComposeTemplate,
  type ConnectedAccountOption,
  listComposeContext,
} from "../../_actions/compose-and-send";
import { deleteDraft, sendDraft, upsertDraft } from "../../_actions/email-drafts";
import { AttachmentList } from "./attachment-list";
import { type ComposerInstance, type ComposerMode, useComposer } from "./composer-store";
import { FollowUpPrompt } from "./follow-up-prompt";
import { PreviewModal } from "./preview-modal";
import { RecipientChips } from "./recipient-chips";
import { RichTextEditor } from "./rich-text-editor";
import { SendMenu } from "./send-menu";

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
  const subj = renderTemplate(t.subjectTemplate, renderContext);
  const body = renderTemplate(t.bodyTemplateText, renderContext);
  // Convert plain-text template body to minimal HTML so the rich
  // text editor seeds correctly (paragraphs preserved).
  const html = body.output
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
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
 * Strip a previously-auto-appended signature block from HTML. The
 * composer wraps auto-appended signatures in
 * <!--composer-signature--> ... <!--/composer-signature--> so we can
 * cleanly swap them when the operator changes From inbox.
 *
 * Manually-edited signatures (operator deleted the markers or typed
 * their own) are LEFT ALONE — we only strip blocks we own.
 */
function stripSignatureBlock(html: string): string {
  return html
    .replace(/(?:<br\s*\/?>\s*)?<!--composer-signature-->[\s\S]*?<!--\/composer-signature-->/gi, "")
    .replace(/\s+$/, "");
}

export function ComposerWindow({ instance, isMobile }: Props) {
  const { close, setMode, setField, setStatus } = useComposer();
  const [inboxes, setInboxes] = useState<ConnectedAccountOption[] | null>(null);
  const [templates, setTemplates] = useState<ComposeTemplate[] | null>(null);
  const [renderContext, setRenderContext] = useState<ComposeRenderContext>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [capBlocked, setCapBlocked] = useState(false);
  const [sending, startSendTx] = useTransition();
  const toast = useToast();
  /** undo-window timer: when non-null, we're in the queued-send window
   *  and the operator can cancel. */
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [undoActive, setUndoActive] = useState(false);
  const [sentThreadId, setSentThreadId] = useState<string | null>(null);
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Recipient parsed lists kept as derived arrays for the chip
  // components. The store still holds the canonical CSV string.
  const toList = useMemo(() => parseAddressList(instance.to), [instance.to]);
  const ccList = useMemo(() => parseAddressList(instance.cc), [instance.cc]);
  const bccList = useMemo(() => parseAddressList(instance.bcc), [instance.bcc]);

  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstSaveRef = useRef(true);

  // -------------------------------------------------------------
  // Load From / templates / render context once per composer.
  // -------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    listComposeContext({ venueId: instance.venueId ?? undefined })
      .then((ctx) => {
        if (cancelled) return;
        setInboxes(ctx.inboxes);
        setTemplates(ctx.templates);
        setRenderContext(ctx.renderContext);
        if (!instance.fromAccountId && ctx.inboxes[0]) {
          const first = ctx.inboxes[0];
          const patch: Partial<typeof instance> = { fromAccountId: first.id };
          // If the default inbox has a signature, seed the body with it.
          // Skip if the operator already typed content (initial-load
          // would have an empty body normally; defensive).
          if (first.signatureHtml && !instance.bodyHtml && !instance.bodyText.trim()) {
            patch.bodyHtml = `<!--composer-signature-->\n<br>\n${first.signatureHtml}\n<!--/composer-signature-->`;
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
  // Debounced autosave.
  // -------------------------------------------------------------
  const triggerAutosave = useCallback(() => {
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(async () => {
      const hasContent = instance.to.trim() || instance.subject.trim() || instance.bodyText.trim();
      if (!hasContent && isFirstSaveRef.current) return;
      isFirstSaveRef.current = false;

      setStatus(instance.id, "saving");
      const result = await upsertDraft({
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
        attachments: instance.attachments.map((a) => ({
          name: a.name,
          size: a.size,
          mime: a.mime,
          storage_key: a.storage_key,
        })),
        scheduledFor: instance.scheduledFor,
        mode: instance.composeMode,
        replyToThreadId: instance.replyToThreadId,
        replyToMessageId: instance.replyToMessageId,
      });
      if (result.ok) {
        setStatus(instance.id, "saved", result.data.updatedAt);
      } else {
        setStatus(instance.id, "save_failed");
      }
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [instance, toList, ccList, bccList, setStatus]);

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
    if (hasContent && instance.draftStatus !== "saved") {
      if (!confirm("Discard unsaved changes?")) return;
    }
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
  function actuallySend(opts: { testOnly?: boolean; bypassCap?: boolean } = {}) {
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
        attachments: instance.attachments,
        scheduledFor: null,
        mode: opts.testOnly ? "new" : instance.composeMode,
        replyToThreadId: opts.testOnly ? null : instance.replyToThreadId,
        replyToMessageId: opts.testOnly ? null : instance.replyToMessageId,
      });
      if (!saveRes.ok) {
        setSendError(saveRes.error);
        setUndoActive(false);
        return;
      }
      const sendRes = await sendDraft(instance.id, { bypassCap: opts.bypassCap });
      setUndoActive(false);
      if (!sendRes.ok) {
        setSendError(sendRes.error);
        setCapBlocked(sendRes.capBlocked ?? false);
        toast.show({
          kind: "error",
          message: sendRes.capBlocked
            ? "Daily cold send cap reached."
            : `Send failed: ${sendRes.error}`,
        });
        return;
      }
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
        message: `Scheduled to send ${new Date(instance.scheduledFor).toLocaleString()}.`,
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
      attachments: instance.attachments,
      scheduledFor: instance.scheduledFor,
      mode: instance.composeMode,
      replyToThreadId: instance.replyToThreadId,
      replyToMessageId: instance.replyToMessageId,
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
      });
    },
    [instance.venueId],
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
        className="pointer-events-auto flex w-72 items-center justify-between gap-2 rounded-t-md border border-zinc-200 border-b-0 bg-white px-3 py-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        role="region"
        aria-label="Minimized composer"
      >
        <button
          type="button"
          onClick={() => setMode(instance.id, "docked")}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs"
        >
          <span className="truncate font-medium">
            {instance.subject || (instance.to ? `To: ${instance.to}` : "New Message")}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setMode(instance.id, "docked")}
          title="Restore"
          className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={handleClose}
          title="Close"
          className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  const widthClass =
    effectiveMode === "fullscreen"
      ? "fixed inset-x-2 inset-y-4 sm:inset-x-12 sm:inset-y-12 max-w-none"
      : effectiveMode === "expanded"
        ? "w-[720px] h-[640px] max-h-[80vh]"
        : "w-[540px] h-[580px] max-h-[80vh]";

  return (
    <div
      className={cn(
        "pointer-events-auto flex flex-col overflow-hidden rounded-t-lg border border-zinc-200 border-b-0 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-950",
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
          <button
            type="button"
            onClick={() => setMode(instance.id, "minimized")}
            title="Minimize (Esc)"
            className="rounded p-1 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
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

      <div className="flex flex-1 flex-col overflow-hidden">
        {loadError && (
          <p className="border-zinc-200 border-b bg-rose-50 px-3 py-2 text-rose-800 text-xs dark:border-zinc-800 dark:bg-rose-950 dark:text-rose-200">
            {loadError}
          </p>
        )}

        {/* From */}
        <div className="flex items-center gap-2 border-zinc-200 border-b px-3 py-1.5 text-xs dark:border-zinc-800">
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
                  patch.bodyHtml = `${stripped}<!--composer-signature-->\n<br>\n${newSig}\n<!--/composer-signature-->`;
                } else {
                  patch.bodyHtml = stripped || null;
                }
                setField(instance.id, patch);
              }}
              className="flex-1 bg-transparent text-xs outline-none"
            >
              <option value="">— Select an inbox —</option>
              {inboxes.map((inbox) => (
                <option key={inbox.id} value={inbox.id}>
                  {inbox.emailAddress}
                  {inbox.status !== "connected" ? ` (${inbox.status})` : ""}
                  {inbox.signatureHtml ? " · ✎" : ""}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* To row with CC/BCC reveal */}
        <div className="flex items-start gap-2 border-zinc-200 border-b px-3 py-1.5 text-xs dark:border-zinc-800">
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
          <div className="flex items-start gap-2 border-zinc-200 border-b px-3 py-1.5 text-xs dark:border-zinc-800">
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
          <div className="flex items-start gap-2 border-zinc-200 border-b px-3 py-1.5 text-xs dark:border-zinc-800">
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
          <div className="flex items-center gap-2 border-zinc-200 border-b px-3 py-1.5 text-xs dark:border-zinc-800">
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
        <div className="border-zinc-200 border-b px-3 py-1.5 text-xs dark:border-zinc-800">
          <input
            type="text"
            value={instance.subject}
            onChange={(e) => setField(instance.id, { subject: e.target.value })}
            placeholder="Subject"
            className="w-full bg-transparent font-medium text-xs outline-none"
          />
        </div>

        {/* Body — rich text */}
        <RichTextEditor
          valueHtml={instance.bodyHtml}
          valueText={instance.bodyText}
          onChange={({ text, html }) => setField(instance.id, { bodyText: text, bodyHtml: html })}
          className="flex-1"
        />

        {sendError && (
          <div className="flex items-start gap-2 border-zinc-200 border-t bg-rose-50 px-3 py-2 text-rose-800 text-xs dark:border-zinc-800 dark:bg-rose-950 dark:text-rose-200">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="flex-1">{sendError}</span>
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
        <div className="flex items-center gap-2">
          <SendMenu
            disabled={!!sendError && !undoActive}
            pending={sending || undoActive}
            scheduledFor={instance.scheduledFor}
            onSendNow={handleSendNow}
            onSchedule={(iso) => setField(instance.id, { scheduledFor: iso })}
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
        </div>
        <div className="flex items-center gap-2">
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
            <span title={new Date(instance.lastSavedAt).toLocaleString()} className="ml-1">
              ·{" "}
              {new Date(instance.lastSavedAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
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
