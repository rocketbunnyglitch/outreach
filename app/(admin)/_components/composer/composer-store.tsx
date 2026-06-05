"use client";

/**
 * ComposerStore — global state for the Gmail-style floating composer.
 *
 * Mounted once at the admin layout level so the composer survives
 * route changes. Any page can call useComposer().open({...}) to
 * spawn a new composer; the host component (ComposerHost) renders
 * all open composers in a bottom-right stack.
 *
 * Architecture:
 *   - Reducer-backed Map<id, ComposerInstance> in a Context
 *   - Each composer has an id (uuid), stable for its lifetime, used
 *     as the email_drafts row id so autosaves hit the same row
 *   - Modes: 'docked' | 'minimized' | 'expanded' | 'fullscreen'
 *
 * Why a reducer not Zustand:
 *   The engine already standardises on Context + useReducer for
 *   global state (ToastProvider, ShortcutProvider). Staying with
 *   that pattern keeps the dependency footprint flat and the
 *   debugging tools (React DevTools) consistent.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer } from "react";

export type ComposerMode = "docked" | "minimized" | "expanded" | "fullscreen" | "inline";

export type DraftStatus = "idle" | "saving" | "saved" | "save_failed";

export interface ComposerAttachment {
  /** Stable id for React keys (client-generated). */
  id: string;
  name: string;
  size: number;
  mime: string;
  /** Future S3 key once file storage ships; null for now. */
  storage_key?: string;
}

export type ComposeMode = "new" | "reply" | "reply_all" | "forward";

export interface ComposerInstance {
  id: string;
  mode: ComposerMode;
  /** From inbox id. Empty string = unset. */
  fromAccountId: string;
  to: string;
  cc: string;
  bcc: string;
  showCc: boolean;
  showBcc: boolean;
  subject: string;
  /** Plain text representation (canonical for safety + send pipeline). */
  bodyText: string;
  /** Optional HTML — populated by the rich text editor. */
  bodyHtml: string | null;
  /** Attribution. */
  venueId: string | null;
  cityCampaignId: string | null;
  /** Picked template id (drives merge + AI+template mode). */
  templateId: string | null;
  /** Template the engine auto-picked when this composer opened (Phase 1.5).
   *  Stays fixed even if the operator swaps templateId, so the draft records
   *  the original engine suggestion for override tracking. */
  enginePickedTemplateId: string | null;
  attachments: ComposerAttachment[];
  /** ISO string of scheduled send time; null = send now. */
  scheduledFor: string | null;
  draftStatus: DraftStatus;
  /** ISO of last successful autosave. */
  lastSavedAt: string | null;
  /** Show admin-bypass affordances when the operator has admin role. */
  isAdmin: boolean;
  /** Compose intent — "new" for a fresh draft, "reply"/"reply_all"/
   *  "forward" for thread-anchored drafts. Drives the send pipeline's
   *  threading behavior (Gmail thread continuation + In-Reply-To
   *  headers). */
  composeMode: ComposeMode;
  /** Thread the operator is replying to/forwarding from. Set when
   *  composeMode != "new". */
  replyToThreadId: string | null;
  /** Specific message within the reply thread to anchor against.
   *  null falls back to the latest message at send time. */
  replyToMessageId: string | null;
  /** team_labels.id[] queued during compose. For replies, also
   *  applied immediately to the existing thread via
   *  applyLabelToThreadAction so the operator sees the chip on the
   *  thread row right away. For new compose, only stored here +
   *  persisted to draft.pending_label_ids; applied after Gmail send
   *  creates the new thread row. */
  pendingLabelIds: string[];
  /** Read-only quoted original message for replies/forwards.
   *  Rendered behind a "..." chip below the editable surface;
   *  concatenated onto bodyHtml at send time. */
  quotedHtml: string | null;
  /** Whether the engine template auto-pick (Phase 1.5) has already run for
   *  this draft. Lives on the persisted store instance (not a component ref)
   *  so a router.refresh()-driven remount of the composer NEVER re-fires the
   *  pick and clobbers the operator's chosen template. Restored drafts set
   *  this true (they already had their chance); fresh drafts start false. */
  enginePickAttempted: boolean;
}

export interface OpenComposerInput {
  /** Pre-fill recipient. */
  to?: string;
  cc?: string;
  subject?: string;
  bodyText?: string;
  bodyHtml?: string | null;
  /** Outreach attribution. */
  venueId?: string | null;
  cityCampaignId?: string | null;
  /** Picked template id (optional). */
  templateId?: string | null;
  isAdmin?: boolean;
  /** Reply/forward intent. Defaults to "new". */
  composeMode?: ComposeMode;
  /** Thread anchor for replies/forwards. */
  replyToThreadId?: string | null;
  replyToMessageId?: string | null;
}

type Action =
  | { type: "open"; payload: { id: string; instance: ComposerInstance } }
  | { type: "close"; payload: { id: string } }
  | { type: "set_mode"; payload: { id: string; mode: ComposerMode } }
  | { type: "set_field"; payload: { id: string; patch: Partial<ComposerInstance> } }
  | { type: "set_status"; payload: { id: string; status: DraftStatus; lastSavedAt?: string } }
  | { type: "hydrate_from_server"; payload: ComposerInstance[] };

type State = Map<string, ComposerInstance>;

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "open": {
      const next = new Map(state);
      next.set(action.payload.id, action.payload.instance);
      return next;
    }
    case "close": {
      const next = new Map(state);
      next.delete(action.payload.id);
      return next;
    }
    case "set_mode": {
      const cur = state.get(action.payload.id);
      if (!cur) return state;
      const next = new Map(state);
      next.set(action.payload.id, { ...cur, mode: action.payload.mode });
      return next;
    }
    case "set_field": {
      const cur = state.get(action.payload.id);
      if (!cur) return state;
      const next = new Map(state);
      next.set(action.payload.id, { ...cur, ...action.payload.patch });
      return next;
    }
    case "set_status": {
      const cur = state.get(action.payload.id);
      if (!cur) return state;
      const next = new Map(state);
      next.set(action.payload.id, {
        ...cur,
        draftStatus: action.payload.status,
        lastSavedAt: action.payload.lastSavedAt ?? cur.lastSavedAt,
      });
      return next;
    }
    case "hydrate_from_server": {
      const next = new Map(state);
      for (const inst of action.payload) {
        // Don't overwrite an open composer that already exists locally
        // (rare race when the operator opened a fresh draft client-side
        // while a server fetch was in flight).
        if (!next.has(inst.id)) next.set(inst.id, inst);
      }
      return next;
    }
    default:
      return state;
  }
}

interface ComposerStoreValue {
  composers: State;
  open: (input: OpenComposerInput) => string;
  close: (id: string) => void;
  setMode: (id: string, mode: ComposerMode) => void;
  setField: (id: string, patch: Partial<ComposerInstance>) => void;
  setStatus: (id: string, status: DraftStatus, lastSavedAt?: string) => void;
  hydrate: (instances: ComposerInstance[]) => void;
}

const Ctx = createContext<ComposerStoreValue | null>(null);

/**
 * Generate a v4-ish uuid using crypto.randomUUID when available,
 * falling back to a less-rigorous random for older browsers. The
 * draft persistence layer doesn't care about cryptographic strength;
 * it just needs uniqueness within the user's draft namespace.
 */
function uuidv4(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function ComposerProvider({ children }: { children: React.ReactNode }) {
  const [composers, dispatch] = useReducer(reducer, new Map<string, ComposerInstance>());

  const open = useCallback((input: OpenComposerInput) => {
    const id = uuidv4();
    const ccPrefilled = input.cc ?? "";
    const instance: ComposerInstance = {
      id,
      mode: "docked",
      fromAccountId: "",
      to: input.to ?? "",
      cc: ccPrefilled,
      bcc: "",
      showCc: ccPrefilled !== "",
      showBcc: false,
      subject: input.subject ?? "",
      bodyText: input.bodyText ?? "",
      bodyHtml: input.bodyHtml ?? null,
      venueId: input.venueId ?? null,
      cityCampaignId: input.cityCampaignId ?? null,
      templateId: input.templateId ?? null,
      enginePickedTemplateId: null,
      attachments: [],
      scheduledFor: null,
      draftStatus: "idle",
      lastSavedAt: null,
      isAdmin: input.isAdmin ?? false,
      composeMode: input.composeMode ?? "new",
      replyToThreadId: input.replyToThreadId ?? null,
      replyToMessageId: input.replyToMessageId ?? null,
      pendingLabelIds: [],
      quotedHtml: null,
      // Fresh draft -> eligible for exactly one engine auto-pick.
      enginePickAttempted: false,
    };
    dispatch({ type: "open", payload: { id, instance } });
    return id;
  }, []);

  const close = useCallback((id: string) => {
    dispatch({ type: "close", payload: { id } });
  }, []);

  const setMode = useCallback((id: string, mode: ComposerMode) => {
    dispatch({ type: "set_mode", payload: { id, mode } });
  }, []);

  const setField = useCallback((id: string, patch: Partial<ComposerInstance>) => {
    dispatch({ type: "set_field", payload: { id, patch } });
  }, []);

  const setStatus = useCallback((id: string, status: DraftStatus, lastSavedAt?: string) => {
    dispatch({ type: "set_status", payload: { id, status, lastSavedAt } });
  }, []);

  const hydrate = useCallback((instances: ComposerInstance[]) => {
    dispatch({ type: "hydrate_from_server", payload: instances });
  }, []);

  // Warn-on-leave when at least one composer has unsaved content.
  // The browser only fires beforeunload if the page actually has
  // interaction history; this is best-effort safety net for
  // accidental tab closes / refreshes.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      let hasContent = false;
      for (const c of composers.values()) {
        if (c.draftStatus === "saving") {
          hasContent = true;
          break;
        }
        if (c.bodyText.trim() || c.subject.trim() || c.to.trim()) {
          if (c.draftStatus !== "saved") {
            hasContent = true;
            break;
          }
        }
      }
      if (hasContent) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [composers]);

  // Compatibility bridge: legacy code dispatches a "compose-email"
  // CustomEvent on window to hand off an AI-drafted email. The old
  // ComposeEmailModal listened for it; we maintain the same contract
  // here so callers don't need to be rewritten.
  //
  // Additional contract: when detail.draftId is set, the event means
  // "expand the existing draft" rather than "create a new one." Used
  // by the inbox Drafts/Scheduled list when the operator clicks
  // Resume — the draft is already in the store (hydrated on mount)
  // so we just flip the mode to 'docked'.
  useEffect(() => {
    function onCompose(e: Event) {
      const ce = e as CustomEvent<{
        draftId?: string;
        hydrateDraftId?: string;
        /** Initial mode for the new composer instance. Defaults to
         *  "docked" (the bottom-right popout). Used by inline-reply
         *  callers that want the draft to render at the bottom of
         *  the thread instead. */
        initialMode?: ComposerInstance["mode"];
        to?: string;
        subject?: string;
        body?: string;
        bodyText?: string;
        bodyHtml?: string;
        venueId?: string;
        cityCampaignId?: string;
        templateId?: string;
        isAdmin?: boolean;
      }>;
      const d = ce.detail ?? {};
      const initialMode: ComposerInstance["mode"] = d.initialMode ?? "docked";
      // Shared loader: pull a draft row from the server and add it to
      // the store with the requested mode. hydrate() never overwrites
      // an already-open composer, so calling this when the draft is
      // already loaded is a safe no-op for its fields.
      async function hydrateDraftById(
        id: string,
        mode: ComposerInstance["mode"],
        enginePickAttempted: boolean,
      ) {
        const mod = await import("../../_actions/email-drafts");
        const rows = await mod.listMyDrafts();
        const row = rows.find((r) => r.id === id);
        if (!row) return;
        hydrate([
          {
            id: row.id,
            mode,
            fromAccountId: row.connectedAccountId ?? "",
            to: row.toAddresses.join(", "),
            cc: row.ccAddresses.join(", "),
            bcc: row.bccAddresses.join(", "),
            showCc: row.ccAddresses.length > 0,
            showBcc: row.bccAddresses.length > 0,
            subject: row.subject,
            bodyText: row.bodyText,
            bodyHtml: row.bodyHtml,
            venueId: row.venueId,
            cityCampaignId: row.cityCampaignId,
            templateId: row.templateId,
            enginePickedTemplateId: row.enginePickedTemplateId,
            attachments: (row.attachments ?? []).map((a, i) => ({
              id: `${row.id}-att-${i}`,
              name: a.name,
              size: a.size,
              mime: a.mime,
              storage_key: a.storage_key,
            })),
            scheduledFor: row.scheduledFor,
            draftStatus: "saved",
            lastSavedAt: row.updatedAt,
            isAdmin: false,
            composeMode: (row.mode as ComposerInstance["composeMode"]) ?? "new",
            replyToThreadId: row.replyToThreadId,
            replyToMessageId: row.replyToMessageId,
            pendingLabelIds: row.pendingLabelIds ?? [],
            quotedHtml: row.quotedHtml ?? null,
            enginePickAttempted,
          },
        ]);
      }
      if (d.draftId) {
        // Resume an existing draft (worklist "Review & send", inbox
        // Drafts list, draft-ready notifications). Bring it forward if
        // it's already in the store; otherwise hydrate it from the
        // server so the click reliably pops the composer instead of
        // silently no-op'ing. enginePickAttempted=true -> a resumed
        // draft keeps its own template (no engine re-pick clobber).
        const id = d.draftId;
        setMode(id, initialMode);
        void hydrateDraftById(id, initialMode, true);
        return;
      }
      if (d.hydrateDraftId) {
        // Server just created a draft (e.g. openReplyDraft); pull it
        // from the server + add to the store with the requested mode
        // (inline for thread replies, docked otherwise).
        // enginePickAttempted=false -> a fresh reply/forward draft is
        // eligible for exactly one engine auto-pick (Phase 1.5 / 2.7).
        void hydrateDraftById(d.hydrateDraftId, initialMode, false);
        return;
      }
      open({
        to: d.to,
        subject: d.subject,
        bodyText: d.bodyText ?? d.body,
        bodyHtml: d.bodyHtml ?? null,
        venueId: d.venueId ?? null,
        cityCampaignId: d.cityCampaignId ?? null,
        templateId: d.templateId ?? null,
        isAdmin: d.isAdmin ?? false,
      });
    }
    window.addEventListener("compose-email", onCompose);
    return () => window.removeEventListener("compose-email", onCompose);
  }, [open, setMode, hydrate]);

  const value = useMemo<ComposerStoreValue>(
    () => ({ composers, open, close, setMode, setField, setStatus, hydrate }),
    [composers, open, close, setMode, setField, setStatus, hydrate],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * useComposer — access the global composer store from any client
 * component under the admin layout. Throws when called outside the
 * provider so misuse fails loud.
 */
export function useComposer(): ComposerStoreValue {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error("useComposer must be used within ComposerProvider");
  }
  return v;
}
