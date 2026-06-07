"use client";

/**
 * Pre-send safety warning confirmation dialog.
 *
 * Shown when the server returns safety warnings (recent decline,
 * cross-staff ownership, duplicate outreach) on a send attempt.
 * The operator must explicitly choose "Send anyway" (re-fires the
 * send with ackDuplicates=true) or "Cancel" (dismiss + leave the
 * draft open so they can edit).
 *
 * Each warning kind renders in its own card with a kind-specific
 * icon + color reservation:
 *
 *   recent_decline       — rose (warning, destructive)
 *   cross_staff_owner    — amber (coordinate-needed)
 *   duplicate            — zinc  (informational)
 *
 * Rationale for the color mapping:
 *
 *   recent_decline is the strongest signal — the venue has
 *     ALREADY said no. Rose flags "are you sure?"
 *   cross_staff_owner is a coordination problem, not a venue
 *     problem. Amber says "talk to someone first".
 *   duplicate is the most common + lowest-stakes case
 *     (another open thread exists; not necessarily a problem).
 *     Zinc keeps it from drowning out the others.
 */

import { useFocusTrap } from "@/lib/use-focus-trap";
import { AlertTriangle, Building2, Mail, UserCircle } from "lucide-react";

export type SafetyWarningInput = Record<string, unknown>;

export function SafetyWarningDialog({
  warnings,
  onCancel,
  onConfirm,
  sending,
}: {
  warnings: SafetyWarningInput[];
  onCancel: () => void;
  onConfirm: () => void;
  sending: boolean;
}) {
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="safety-warning-title"
      onClick={(e) => {
        // Click on backdrop dismisses. Don't allow accidentally
        // dismissing through a card; only the explicit backdrop.
        if (e.target === e.currentTarget) onCancel();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <div
        ref={trapRef}
        tabIndex={-1}
        className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-xl outline-none dark:border-zinc-800 dark:bg-zinc-950"
      >
        <header className="border-zinc-200/80 border-b px-4 py-3 dark:border-zinc-800/60">
          <h2
            id="safety-warning-title"
            className="font-semibold text-sm text-zinc-900 dark:text-zinc-100"
          >
            Before you send
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            We caught {warnings.length === 1 ? "a concern" : `${warnings.length} concerns`} you
            should consider.
          </p>
        </header>

        <div className="space-y-2 p-3">
          {warnings.map((w, i) => (
            <WarningCard key={`${String(w.kind ?? "unknown")}-${i}`} w={w} />
          ))}
        </div>

        <footer className="flex items-center justify-end gap-2 border-zinc-200/80 border-t px-4 py-3 dark:border-zinc-800/60">
          <button
            type="button"
            onClick={onCancel}
            disabled={sending}
            className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 font-medium text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={sending}
            className="rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white text-xs hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {sending ? "Sending..." : "Send anyway"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function WarningCard({ w }: { w: SafetyWarningInput }) {
  const kind = String(w.kind ?? "");

  if (kind === "recent_decline") {
    const venueName = String(w.venueName ?? "This venue");
    const daysAgo = Number(w.daysAgo ?? 0);
    const eventLabel = w.eventLabel ? String(w.eventLabel) : null;
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 p-3 dark:border-rose-900/40 dark:bg-rose-950/30">
        <div className="flex items-start gap-2">
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-rose-900 text-xs dark:text-rose-100">Recent decline</p>
            <p className="mt-0.5 text-rose-800 text-xs dark:text-rose-300">
              <span className="font-medium">{venueName}</span> declined {daysAgo} day
              {daysAgo === 1 ? "" : "s"} ago
              {eventLabel ? ` (${eventLabel})` : ""}.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (kind === "cross_staff_owner") {
    const venueName = String(w.venueName ?? "this venue");
    const ownerName = w.ownerStaffName ? String(w.ownerStaffName) : "Another teammate";
    const eventLabel = w.eventLabel ? String(w.eventLabel) : null;
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/40 dark:bg-amber-950/30">
        <div className="flex items-start gap-2">
          <UserCircle
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-amber-900 text-xs dark:text-amber-100">
              Teammate already contacting
            </p>
            <p className="mt-0.5 text-amber-800 text-xs dark:text-amber-300">
              <span className="font-medium">{ownerName}</span> is contacting{" "}
              <span className="font-medium">{venueName}</span>
              {eventLabel ? ` (${eventLabel})` : ""}. Coordinate before sending.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (kind === "duplicate") {
    const subject = w.subject ? String(w.subject) : "(no subject)";
    const ownerDisplayName = w.ownerDisplayName ? String(w.ownerDisplayName) : null;
    const inboxEmail = w.inboxEmail ? String(w.inboxEmail) : null;
    return (
      <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
        <div className="flex items-start gap-2">
          <Mail
            className="mt-0.5 h-4 w-4 shrink-0 text-zinc-600 dark:text-zinc-400"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-xs text-zinc-900 dark:text-zinc-100">
              Open thread already exists
            </p>
            <p className="mt-0.5 truncate text-xs text-zinc-700 dark:text-zinc-300">{subject}</p>
            {(ownerDisplayName || inboxEmail) && (
              <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-500">
                {ownerDisplayName ? `${ownerDisplayName} ` : ""}
                {inboxEmail ? `(${inboxEmail})` : ""}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (kind === "domain_alias_suggestion") {
    // Render up to 3 candidate venues. The dialog stays informational --
    // the operator's options are: cancel + attach in the composer, or
    // send anyway. We surface the venue names but don't add inline
    // "attach this" buttons because the safety dialog's job is to
    // surface, not to mutate (and the composer already owns the venue
    // attach UI).
    const domain = w.domain ? String(w.domain) : "(unknown)";
    const rawCandidates = Array.isArray(w.candidates) ? w.candidates : [];
    const names = rawCandidates
      .map((c) =>
        c && typeof c === "object" && "venueName" in c
          ? String((c as { venueName?: unknown }).venueName ?? "")
          : "",
      )
      .filter((n) => n.length > 0);
    return (
      <div className="rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-900/40 dark:bg-blue-950/30">
        <div className="flex items-start gap-2">
          <Building2
            className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-blue-900 text-xs dark:text-blue-100">
              Recipient domain is aliased
            </p>
            <p className="mt-0.5 text-blue-800 text-xs dark:text-blue-300">
              <span className="font-mono">{domain}</span> is set up as a domain alias for{" "}
              {names.length === 1 ? (
                <span className="font-medium">{names[0]}</span>
              ) : names.length > 1 ? (
                <>
                  <span className="font-medium">{names[0]}</span>
                  {names.length === 2 ? " and " : ", "}
                  {names.length > 2 ? (
                    <>
                      <span className="font-medium">{names[1]}</span>, and {names.length - 2} other
                      {names.length - 2 === 1 ? "" : "s"}
                    </>
                  ) : (
                    <span className="font-medium">{names[1]}</span>
                  )}
                </>
              ) : (
                "a venue"
              )}
              . Cancel and attach the venue if this email belongs there.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Unknown kind -- render as a generic info card. Should not
  // happen in normal operation; defensive coverage so a future
  // kind doesn't blank-render before the UI catches up.
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-300">
      <p className="font-medium">Safety warning</p>
      <p className="mt-0.5 text-zinc-500 dark:text-zinc-400">Review the send before continuing.</p>
    </div>
  );
}
