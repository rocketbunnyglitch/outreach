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

import { Loader2, Tag, X } from "lucide-react";
import { type ReactNode, useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import {
  type ConnectedAccountOption,
  composeAndSend,
  listComposeContext,
} from "../_actions/compose-and-send";

interface TeamLabel {
  id: string;
  name: string;
  color: string | null;
}

interface DuplicateWarning {
  threadId: string;
  subject: string | null;
  lastMessageAt: Date | string;
  lastSenderName: string | null;
  inboxEmail: string | null;
  ownerDisplayName: string | null;
}

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
  /** When true, a "Bypass cap" button appears on cap-block errors.
   *  Server-side admin gate is the source of truth; this only
   *  governs whether the affordance is visible. */
  isAdmin?: boolean;
}

export function ComposeEmailModal({
  children,
  defaultTo = "",
  defaultSubject = "",
  defaultBody = "",
  venueId,
  ariaLabel = "Compose email",
  className,
  isAdmin = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [inboxes, setInboxes] = useState<ConnectedAccountOption[] | null>(null);
  const [labels, setLabels] = useState<TeamLabel[]>([]);
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fromAccountId, setFromAccountId] = useState("");
  const [to, setTo] = useState(defaultTo);
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);
  const [error, setError] = useState<string | null>(null);
  const [capBlocked, setCapBlocked] = useState(false);
  /** Server returned duplicate-outreach warnings. When non-empty the
   *  modal shows a confirm step instead of the regular Send flow. */
  const [duplicateWarnings, setDuplicateWarnings] = useState<DuplicateWarning[]>([]);
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
    setCapBlocked(false);
    setDuplicateWarnings([]);
    setSent(false);
    setSelectedLabelIds([]);
    if (inboxes !== null) return; // already loaded
    listComposeContext()
      .then((ctx) => {
        setInboxes(ctx.inboxes);
        setLabels(ctx.labels);
        // Default-select the first "mine" inbox if one exists; otherwise
        // the first available team inbox. The user can change before
        // sending.
        if (ctx.inboxes.length > 0 && ctx.inboxes[0]) setFromAccountId(ctx.inboxes[0].id);
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

  function handleSubmit(
    e: React.FormEvent | null,
    opts: { bypass?: boolean; ackDuplicates?: boolean } = {},
  ) {
    if (e) e.preventDefault();
    setError(null);
    const fd = new FormData();
    fd.set("fromAccountId", fromAccountId);
    fd.set("to", to);
    fd.set("subject", subject);
    fd.set("body", body);
    if (venueId) fd.set("venueId", venueId);
    if (selectedLabelIds.length > 0) fd.set("labelIds", selectedLabelIds.join(","));
    if (opts.bypass) fd.set("bypassCap", "1");
    if (opts.ackDuplicates) fd.set("ackDuplicates", "1");
    startTx(async () => {
      const result = await composeAndSend(null, fd);
      if (result.ok) {
        setSent(true);
        setCapBlocked(false);
        setDuplicateWarnings([]);
      } else {
        setError(result.error);
        setCapBlocked(Boolean(result.capBlocked));
        // If server returned dup warnings, capture them and surface
        // the confirm step (rather than just an error string).
        setDuplicateWarnings((result.duplicateWarnings as DuplicateWarning[] | undefined) ?? []);
      }
    });
  }

  function toggleLabel(id: string) {
    setSelectedLabelIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
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

                  {labels.length > 0 && (
                    <div className="flex flex-col gap-1">
                      <span className="flex items-center gap-1 font-medium text-xs">
                        <Tag className="h-3 w-3 text-zinc-400" /> Labels
                        <span className="font-normal text-[10px] text-zinc-500">
                          (applied to the new thread; mirrored to Gmail)
                        </span>
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {labels.map((l) => {
                          const selected = selectedLabelIds.includes(l.id);
                          return (
                            <button
                              type="button"
                              key={l.id}
                              onClick={() => toggleLabel(l.id)}
                              aria-pressed={selected}
                              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                                selected
                                  ? "border-zinc-900 bg-zinc-900 text-zinc-50 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                                  : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                              }`}
                            >
                              <span
                                aria-hidden="true"
                                className={`inline-block h-1.5 w-1.5 rounded-full ${
                                  l.color === "emerald"
                                    ? "bg-emerald-500"
                                    : l.color === "rose"
                                      ? "bg-rose-500"
                                      : l.color === "blue"
                                        ? "bg-blue-500"
                                        : l.color === "amber"
                                          ? "bg-amber-500"
                                          : l.color === "violet"
                                            ? "bg-violet-500"
                                            : l.color === "sky"
                                              ? "bg-sky-500"
                                              : l.color === "orange"
                                                ? "bg-orange-500"
                                                : l.color === "yellow"
                                                  ? "bg-yellow-500"
                                                  : "bg-zinc-400"
                                }`}
                              />
                              {l.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

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

                  {duplicateWarnings.length > 0 ? (
                    <DuplicateConfirmPanel warnings={duplicateWarnings} />
                  ) : error ? (
                    <div className="rounded-md bg-rose-50 px-3 py-2 text-rose-700 text-xs dark:bg-rose-950/40 dark:text-rose-300">
                      {error}
                    </div>
                  ) : null}

                  <div className="mt-1 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={close}
                      className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                    >
                      Cancel
                    </button>
                    {capBlocked && isAdmin && (
                      <button
                        type="button"
                        onClick={() => handleSubmit(null, { bypass: true })}
                        disabled={isPending || !fromAccountId}
                        className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-amber-800 text-sm hover:bg-amber-100 disabled:opacity-50 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200 dark:hover:bg-amber-950/50"
                      >
                        {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        Bypass cap
                      </button>
                    )}
                    {duplicateWarnings.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => handleSubmit(null, { ackDuplicates: true })}
                        disabled={isPending || !fromAccountId}
                        className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-sm text-white hover:bg-amber-700 disabled:opacity-50 dark:bg-amber-500 dark:hover:bg-amber-400"
                      >
                        {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        Send anyway
                      </button>
                    ) : (
                      <button
                        type="submit"
                        disabled={isPending || !fromAccountId}
                        className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-zinc-50 hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                      >
                        {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        Send
                      </button>
                    )}
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

/**
 * DuplicateConfirmPanel — when the server detects open threads to
 * the same recipient on the same team, this panel lists them so the
 * operator can decide:
 *   - open the existing thread (linked subject)
 *   - send anyway (the "Send anyway" amber button in the footer)
 *   - cancel
 *
 * The panel itself is informational; the action buttons live in the
 * modal footer so they're consistent with the regular Send flow.
 */
function DuplicateConfirmPanel({ warnings }: { warnings: DuplicateWarning[] }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-900/40 dark:bg-amber-950/30">
      <p className="font-medium text-amber-900 text-xs dark:text-amber-200">
        {warnings.length === 1
          ? "1 open thread already exists to this address."
          : `${warnings.length} open threads already exist to this address.`}{" "}
        Review before sending a duplicate.
      </p>
      <ul className="flex flex-col gap-1">
        {warnings.map((w) => (
          <li
            key={w.threadId}
            className="rounded border border-amber-200 bg-white px-2 py-1.5 text-xs dark:border-amber-900/40 dark:bg-zinc-950"
          >
            <a
              href={`/inbox/${w.threadId}`}
              target="_blank"
              rel="noreferrer"
              className="block truncate font-medium text-amber-900 underline-offset-2 hover:underline dark:text-amber-200"
            >
              {w.subject ?? "(no subject)"}
            </a>
            <p className="mt-0.5 truncate text-[10px] text-zinc-600 dark:text-zinc-400">
              {w.ownerDisplayName ? `${w.ownerDisplayName} · ` : ""}
              {w.inboxEmail ? `${w.inboxEmail} · ` : ""}
              last activity {formatWarningTime(w.lastMessageAt)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatWarningTime(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const now = Date.now();
  const ms = now - date.getTime();
  if (ms < 0) return "in the future";
  const hr = Math.floor(ms / 3_600_000);
  if (hr < 1) return "moments ago";
  if (hr < 24) return `${hr}h ago`;
  const d2 = Math.floor(hr / 24);
  return `${d2}d ago`;
}
