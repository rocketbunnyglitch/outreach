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
 * Lifecycle / persistence:
 *   - First render creates an in-memory draft id (already set in the
 *     store). Every keystroke debounced-autosaves via upsertDraft.
 *   - Send button calls sendDraft via the existing composeAndSend
 *     pipeline (cap + DNC + suppression + dedupe all enforced server-side).
 *   - Close button:
 *       * with unsaved content + draft status != 'saved' → confirm
 *       * otherwise → close immediately; row stays in DB so the user
 *         can resume from listMyDrafts (future feature)
 *
 * Composability:
 *   The window doesn't know what page it's mounted from. All entry
 *   points pass venueId/cityCampaignId in OpenComposerInput and the
 *   window uses those for attribution + render context.
 */

import { cn } from "@/lib/cn";
import {
  AlertCircle,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  type ComposeRenderContext,
  type ComposeTemplate,
  type ConnectedAccountOption,
  listComposeContext,
} from "../../_actions/compose-and-send";
import { deleteDraft, sendDraft, upsertDraft } from "../../_actions/email-drafts";
import { type ComposerInstance, type ComposerMode, useComposer } from "./composer-store";

const AUTOSAVE_DEBOUNCE_MS = 1500;

interface Props {
  instance: ComposerInstance;
  index: number;
  isMobile: boolean;
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
  const [sent, setSent] = useState(false);

  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstSaveRef = useRef(true);

  // ---------------------------------------------------------------
  // Load From/templates/render context once per composer instance.
  // Tied to instance.venueId so different attribution → different
  // render context (and never mixes).
  // ---------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    listComposeContext({ venueId: instance.venueId ?? undefined })
      .then((ctx) => {
        if (cancelled) return;
        setInboxes(ctx.inboxes);
        setTemplates(ctx.templates);
        setRenderContext(ctx.renderContext);
        // Default-select the first inbox if the operator hasn't picked one.
        if (!instance.fromAccountId && ctx.inboxes[0]) {
          setField(instance.id, { fromAccountId: ctx.inboxes[0].id });
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

  // ---------------------------------------------------------------
  // Debounced autosave. Runs on every relevant field change.
  // ---------------------------------------------------------------
  const triggerAutosave = useCallback(() => {
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(async () => {
      // Skip autosave on truly empty drafts (no recipient, no subject,
      // no body) — no point creating empty rows in email_drafts.
      const hasContent = instance.to.trim() || instance.subject.trim() || instance.bodyText.trim();
      if (!hasContent && isFirstSaveRef.current) return;
      isFirstSaveRef.current = false;

      setStatus(instance.id, "saving");
      const result = await upsertDraft({
        id: instance.id,
        connectedAccountId: instance.fromAccountId || null,
        toAddresses: parseAddressList(instance.to),
        ccAddresses: parseAddressList(instance.cc),
        bccAddresses: parseAddressList(instance.bcc),
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
      });
      if (result.ok) {
        setStatus(instance.id, "saved", result.data.updatedAt);
      } else {
        setStatus(instance.id, "save_failed");
      }
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [instance, setStatus]);

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

  // ---------------------------------------------------------------
  // Close handling. Warn-on-discard when content is present + not saved.
  // ---------------------------------------------------------------
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

  // ---------------------------------------------------------------
  // Send. Validates locally then dispatches sendDraft, which routes
  // through composeAndSend on the server.
  // ---------------------------------------------------------------
  function handleSend() {
    setSendError(null);
    setCapBlocked(false);
    if (!instance.fromAccountId) {
      setSendError("Pick a From inbox before sending.");
      return;
    }
    const toList = parseAddressList(instance.to);
    if (toList.length === 0) {
      setSendError("Add at least one recipient.");
      return;
    }
    for (const addr of [
      ...toList,
      ...parseAddressList(instance.cc),
      ...parseAddressList(instance.bcc),
    ]) {
      if (!isValidEmail(addr)) {
        setSendError(`Invalid email address: ${addr}`);
        return;
      }
    }
    if (!instance.subject.trim()) {
      if (!confirm("Send with an empty subject?")) return;
    }
    if (!instance.bodyText.trim()) {
      setSendError("Body can't be empty.");
      return;
    }
    startSendTx(async () => {
      // Ensure the latest fields hit the row before sending.
      const saveRes = await upsertDraft({
        id: instance.id,
        connectedAccountId: instance.fromAccountId,
        toAddresses: toList,
        ccAddresses: parseAddressList(instance.cc),
        bccAddresses: parseAddressList(instance.bcc),
        subject: instance.subject,
        bodyText: instance.bodyText,
        bodyHtml: instance.bodyHtml,
        venueId: instance.venueId,
        cityCampaignId: instance.cityCampaignId,
        templateId: instance.templateId,
        attachments: instance.attachments,
        scheduledFor: instance.scheduledFor,
      });
      if (!saveRes.ok) {
        setSendError(saveRes.error);
        return;
      }
      const sendRes = await sendDraft(instance.id);
      if (!sendRes.ok) {
        setSendError(sendRes.error);
        setCapBlocked(sendRes.capBlocked ?? false);
        return;
      }
      setSent(true);
      // Auto-close after a short confirmation pause.
      setTimeout(() => close(instance.id), 1500);
    });
  }

  // Cmd/Ctrl + Enter sends.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        if (instance.mode === "minimized") return;
        e.preventDefault();
        handleSend();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance]);

  // ---------------------------------------------------------------
  // Layout / mode classes
  // ---------------------------------------------------------------
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

  // Width by mode. Fullscreen uses positioned overlay.
  const widthClass =
    effectiveMode === "fullscreen"
      ? "fixed inset-x-2 inset-y-4 sm:inset-x-12 sm:inset-y-12 max-w-none"
      : effectiveMode === "expanded"
        ? "w-[720px] h-[640px] max-h-[80vh]"
        : "w-[540px] h-[560px] max-h-[80vh]";

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
      {/* Header bar — title + window controls */}
      <header className="flex items-center justify-between gap-2 border-zinc-200 border-b bg-zinc-50 px-3 py-1.5 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-medium text-xs">{instance.subject || "New Message"}</span>
          <DraftStatusBadge instance={instance} />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setMode(instance.id, "minimized")}
            title="Minimize"
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

      {/* Body */}
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
              onChange={(e) => setField(instance.id, { fromAccountId: e.target.value })}
              className="flex-1 bg-transparent text-xs outline-none"
            >
              <option value="">— Select an inbox —</option>
              {inboxes.map((inbox) => (
                <option key={inbox.id} value={inbox.id}>
                  {inbox.emailAddress}
                  {inbox.status !== "connected" ? ` (${inbox.status})` : ""}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* To row with CC/BCC reveal */}
        <div className="flex items-center gap-2 border-zinc-200 border-b px-3 py-1.5 text-xs dark:border-zinc-800">
          <span className="w-12 shrink-0 text-zinc-500">To</span>
          <input
            type="text"
            value={instance.to}
            onChange={(e) => setField(instance.id, { to: e.target.value })}
            placeholder="recipient@example.com"
            className="flex-1 bg-transparent text-xs outline-none"
          />
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

        {instance.showCc && (
          <div className="flex items-center gap-2 border-zinc-200 border-b px-3 py-1.5 text-xs dark:border-zinc-800">
            <span className="w-12 shrink-0 text-zinc-500">Cc</span>
            <input
              type="text"
              value={instance.cc}
              onChange={(e) => setField(instance.id, { cc: e.target.value })}
              placeholder="comma-separated"
              className="flex-1 bg-transparent text-xs outline-none"
            />
          </div>
        )}

        {instance.showBcc && (
          <div className="flex items-center gap-2 border-zinc-200 border-b px-3 py-1.5 text-xs dark:border-zinc-800">
            <span className="w-12 shrink-0 text-zinc-500">Bcc</span>
            <input
              type="text"
              value={instance.bcc}
              onChange={(e) => setField(instance.id, { bcc: e.target.value })}
              placeholder="comma-separated"
              className="flex-1 bg-transparent text-xs outline-none"
            />
          </div>
        )}

        {/* Template picker (visible when templates exist) */}
        {templates && templates.length > 0 && (
          <div className="flex items-center gap-2 border-zinc-200 border-b px-3 py-1.5 text-xs dark:border-zinc-800">
            <span className="w-12 shrink-0 text-zinc-500">Template</span>
            <select
              value={instance.templateId ?? ""}
              onChange={(e) => {
                const tid = e.target.value || null;
                setField(instance.id, { templateId: tid });
                if (tid) {
                  // Render the template into subject + body using the
                  // existing renderTemplate engine. Importing it
                  // dynamically keeps the client bundle slim until
                  // the operator actually picks a template.
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

        {/* Body */}
        <textarea
          value={instance.bodyText}
          onChange={(e) => setField(instance.id, { bodyText: e.target.value })}
          placeholder="Write your message…"
          className="flex-1 resize-none bg-transparent px-3 py-2 text-sm outline-none placeholder:text-zinc-400"
        />

        {/* Error strip */}
        {sendError && (
          <div className="flex items-start gap-2 border-zinc-200 border-t bg-rose-50 px-3 py-2 text-rose-800 text-xs dark:border-zinc-800 dark:bg-rose-950 dark:text-rose-200">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="flex-1">{sendError}</span>
          </div>
        )}

        {sent && (
          <div className="border-zinc-200 border-t bg-emerald-50 px-3 py-2 text-emerald-700 text-xs dark:border-zinc-800 dark:bg-emerald-950 dark:text-emerald-300">
            Sent.
          </div>
        )}
      </div>

      {/* Footer — send + discard */}
      <footer className="flex items-center justify-between gap-2 border-zinc-200 border-t bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || sent}
            className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white text-xs hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            Send
          </button>
          {capBlocked && instance.isAdmin && (
            <button
              type="button"
              onClick={() => {
                // TODO: bypass-cap on the global composer needs the
                // server action to accept a bypass flag. Wire in a
                // follow-up commit; for now we surface the message.
                setSendError(
                  "Bypass-cap on the global composer is not yet wired. Use the old modal path on /inbox if you need to bypass.",
                );
              }}
              className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-amber-800 text-xs dark:border-amber-900/40 dark:bg-amber-950 dark:text-amber-200"
            >
              Bypass cap
            </button>
          )}
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
    </div>
  );
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

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
  setPatch: (patch: { subject: string; bodyText: string }) => void,
) {
  const t = templates.find((x) => x.id === templateId);
  if (!t) return;
  const { renderTemplate } = await import("@/lib/template-render");
  const subj = renderTemplate(t.subjectTemplate, renderContext);
  const body = renderTemplate(t.bodyTemplateText, renderContext);
  setPatch({ subject: subj.output, bodyText: body.output });
}

function DraftStatusBadge({ instance }: { instance: ComposerInstance }) {
  switch (instance.draftStatus) {
    case "saving":
      return <span className="font-mono text-[10px] text-zinc-400">Saving…</span>;
    case "saved":
      return (
        <span className="flex items-center gap-1 font-mono text-[10px] text-zinc-500">
          <Sparkles className="h-2.5 w-2.5" />
          Saved
          {instance.lastSavedAt && (
            <span title={new Date(instance.lastSavedAt).toLocaleString()}>
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
      return <span className="font-mono text-[10px] text-rose-600">Draft save failed</span>;
    default:
      return null;
  }
}
