"use client";

/**
 * ComposeEmailModal — in-app email composer used by buttons that
 * previously opened mailto: links (cold-outreach mail button,
 * venue summary strip "Email" button, AI-draft "Use draft" handoff).
 *
 * Why this exists:
 *   mailto: bounces the operator out to whatever the OS thinks the
 *   default email client is (Outlook? Mac Mail? Gmail web?). That
 *   loses the team-shared-inbox model entirely: the message gets
 *   sent from the operator's personal Gmail, our DB knows nothing
 *   about it, replies don't appear in /inbox.
 *
 *   This modal stays in the dashboard, lists the team's connected
 *   Gmails as From options, sends via the existing Gmail send
 *   pipeline (lib/gmail.sendGmailMessage), and records the resulting
 *   thread in email_threads so it's immediately visible in /inbox.
 *
 * Trigger pattern:
 *   <ComposeEmailModal
 *     defaultTo="venue@..."
 *     defaultSubject="..."
 *     defaultBody="..."
 *     venueId="..."  // optional attribution
 *   >
 *     <Mail className="h-3 w-3" />
 *   </ComposeEmailModal>
 */

import { Loader2, X } from "lucide-react";
import { type ReactNode, useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import {
  type ConnectedAccountOption,
  composeAndSend,
  listSendableInboxes,
} from "../_actions/compose-and-send";

interface Props {
  /** What renders as the click target (icon, button, anything). */
  children: ReactNode;
  /** Pre-fill these fields when the modal opens. */
  defaultTo?: string;
  defaultSubject?: string;
  defaultBody?: string;
  /** When provided, the new thread is attributed to this venue. */
  venueId?: string;
  /** Aria label for the trigger button. */
  ariaLabel?: string;
  /** Optional className applied to the inline wrapper around children. */
  className?: string;
}

export function ComposeEmailModal({
  children,
  defaultTo = "",
  defaultSubject = "",
  defaultBody = "",
  venueId,
  ariaLabel = "Compose email",
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [inboxes, setInboxes] = useState<ConnectedAccountOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fromAccountId, setFromAccountId] = useState("");
  const [to, setTo] = useState(defaultTo);
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [isPending, startTx] = useTransition();

  // Lazy-load the inbox list on first open. Reset state every open so
  // re-opening from a different row doesn't carry over stale fields.
  useEffect(() => {
    if (!open) return;
    setTo(defaultTo);
    setSubject(defaultSubject);
    setBody(defaultBody);
    setError(null);
    setSent(false);
    if (inboxes !== null) return; // already loaded
    listSendableInboxes()
      .then((list) => {
        setInboxes(list);
        // Default-select the first "mine" inbox if one exists; otherwise
        // the first available team inbox. The user can change before
        // sending.
        if (list.length > 0 && list[0]) setFromAccountId(list[0].id);
      })
      .catch((err) => {
        setLoadError(err instanceof Error ? err.message : "Couldn't load inboxes.");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Also open imperatively from a window event so callers without a
  // direct ref (e.g. an AiDraftButton handler) can fill + open the
  // composer in one shot. Multiple modals on the page would all fire;
  // for now there's only one modal mounted per click target, so the
  // duplication is acceptable. If that changes, scope the event by a
  // composer id.
  useEffect(() => {
    function onCompose(e: Event) {
      const ce = e as CustomEvent<{
        to?: string;
        subject?: string;
        body?: string;
        venueId?: string;
      }>;
      const detail = ce.detail ?? {};
      if (detail.to !== undefined) setTo(detail.to);
      if (detail.subject !== undefined) setSubject(detail.subject);
      if (detail.body !== undefined) setBody(detail.body);
      setError(null);
      setSent(false);
      setOpen(true);
    }
    window.addEventListener("compose-email", onCompose);
    return () => window.removeEventListener("compose-email", onCompose);
  }, []);

  function close() {
    setOpen(false);
    // Don't reset inboxes — keep them cached for subsequent opens.
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const fd = new FormData();
    fd.set("fromAccountId", fromAccountId);
    fd.set("to", to);
    fd.set("subject", subject);
    fd.set("body", body);
    if (venueId) fd.set("venueId", venueId);
    startTx(async () => {
      const result = await composeAndSend(null, fd);
      if (result.ok) {
        setSent(true);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={ariaLabel}
        className={className}
      >
        {children}
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/40 px-4 pt-[8vh] pb-10 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            onClick={(e) => {
              if (e.target === e.currentTarget) close();
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
            }}
          >
            <div className="w-full max-w-xl rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
                    Compose
                  </p>
                  <h2 className="mt-1 font-semibold text-lg tracking-tight">New email</h2>
                </div>
                <button
                  type="button"
                  onClick={close}
                  className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {sent ? (
                <div className="flex flex-col gap-3">
                  <p className="text-emerald-700 text-sm dark:text-emerald-400">
                    Sent. The thread is now visible in your inbox.
                  </p>
                  <button
                    type="button"
                    onClick={close}
                    className="self-end rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                  >
                    Done
                  </button>
                </div>
              ) : loadError ? (
                <p className="text-rose-700 text-sm dark:text-rose-400">{loadError}</p>
              ) : inboxes === null ? (
                <p className="flex items-center gap-2 text-sm text-zinc-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading inboxes...
                </p>
              ) : inboxes.length === 0 ? (
                <p className="text-rose-700 text-sm dark:text-rose-400">
                  No connected Gmail accounts on your team. Connect one in Settings &rarr; Inboxes.
                </p>
              ) : (
                <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="font-medium text-xs">From</span>
                    <select
                      value={fromAccountId}
                      onChange={(e) => setFromAccountId(e.target.value)}
                      className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      <FromOptions inboxes={inboxes} />
                    </select>
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="font-medium text-xs">To</span>
                    <input
                      type="email"
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                      required
                      className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-700 dark:bg-zinc-900"
                    />
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="font-medium text-xs">Subject</span>
                    <input
                      type="text"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      required
                      className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-700 dark:bg-zinc-900"
                    />
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="font-medium text-xs">Message</span>
                    <textarea
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      required
                      rows={9}
                      className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm leading-relaxed shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-700 dark:bg-zinc-900"
                    />
                  </label>

                  {error && (
                    <div className="rounded-md bg-rose-50 px-3 py-2 text-rose-700 text-xs dark:bg-rose-950/40 dark:text-rose-300">
                      {error}
                    </div>
                  )}

                  <div className="mt-1 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={close}
                      className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isPending || !fromAccountId}
                      className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-zinc-50 hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                    >
                      {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      Send
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * Splits the inbox list into "Mine" / "Team" optgroups so the From
 * dropdown is easy to read with 10+ accounts.
 */
function FromOptions({ inboxes }: { inboxes: ConnectedAccountOption[] }) {
  const mine = inboxes.filter((i) => i.scope === "mine");
  const team = inboxes.filter((i) => i.scope === "team");
  const renderOption = (i: ConnectedAccountOption) => (
    <option key={i.id} value={i.id}>
      {i.emailAddress}
      {i.ownerDisplayName ? ` (${i.ownerDisplayName})` : ""}
      {i.status === "needs_reauth" ? " — needs reauth" : ""}
    </option>
  );
  return (
    <>
      {mine.length > 0 && <optgroup label="My inboxes">{mine.map(renderOption)}</optgroup>}
      {team.length > 0 && <optgroup label="Team inboxes">{team.map(renderOption)}</optgroup>}
    </>
  );
}
