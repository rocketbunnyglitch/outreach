import { ComposeEmailButton } from "@/app/(admin)/_components/composer/compose-email-button";
import { cn } from "@/lib/cn";
import type { PendingEscalation } from "@/lib/escalations-data";
import { AlertTriangle, ArrowRight, Mail, MapPin, Phone, User } from "lucide-react";
import Link from "next/link";

interface Props {
  /** Pending escalations for the current staff member. Empty array
   *  means the assignee has nothing on their plate — widget renders
   *  a quiet empty state rather than disappearing, so the operator
   *  knows the system is working and just has no escalations right
   *  now. */
  escalations: PendingEscalation[];
  /** Display name of the current staff member, used in the header
   *  copy ("Brandon, you have 3 escalations…"). */
  staffFirstName: string;
}

/**
 * Escalations dashboard widget.
 *
 * Renders on the home dashboard for any staff member who has at
 * least one escalation flagged to them. Hidden entirely when the
 * list is empty AND the staffer isn't a typical recipient (admin /
 * lead) — see "render only when meaningful" in the parent page.
 *
 * Each row shows:
 *   - Venue name + city
 *   - Current cold-outreach status pill (so the assignee knows
 *     whether it's already been contacted, voicemail'd, etc.)
 *   - Who escalated + when (relative time)
 *   - The operator's verbatim notes ("wants a call at 7pm…")
 *   - Phone + email shortcuts (tel: for one-tap call, in-app composer for email)
 *   - Deep link to the venue page
 *
 * Each escalation card is self-contained — the assignee can
 * understand WHAT and ACT (call/email) without leaving the
 * dashboard. The deep link is for follow-up edits on the row
 * itself (un-escalate, change status).
 */
export function EscalationsWidget({ escalations, staffFirstName }: Props) {
  const count = escalations.length;

  return (
    <section className="card-surface overflow-hidden">
      <header className="flex items-start justify-between gap-3 px-6 py-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-rose-500" />
          <div>
            <h2 className="font-semibold text-lg tracking-tight">
              {count > 0 ? (
                <>
                  {staffFirstName}, you have{" "}
                  <span className="text-rose-700 dark:text-rose-300">
                    {count} escalation{count === 1 ? "" : "s"}
                  </span>
                </>
              ) : (
                <>Escalations</>
              )}
            </h2>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
              {count > 0
                ? "Venues asking for senior-staff attention — sorted newest first."
                : "Nothing escalated to you right now. You'll see venues here when a teammate escalates one."}
            </p>
          </div>
        </div>
      </header>

      {count > 0 && (
        <ul className="divide-y divide-zinc-200/60 dark:divide-zinc-800/40">
          {escalations.map((esc) => (
            <EscalationRow key={esc.entryId} escalation={esc} />
          ))}
        </ul>
      )}
    </section>
  );
}

function EscalationRow({ escalation }: { escalation: PendingEscalation }) {
  return (
    <li className="px-6 py-4 transition-colors hover:bg-rose-500/[0.04] dark:hover:bg-rose-500/[0.06]">
      {/* Top row: venue + city + status + meta */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <Link
              href={`/venues/${escalation.venueId}`}
              className="font-medium text-zinc-900 hover:underline dark:text-zinc-100"
            >
              {escalation.venueName}
            </Link>
            <span className="inline-flex items-center gap-1 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
              <MapPin className="h-2.5 w-2.5" />
              {escalation.cityLabel}
            </span>
            <StatusPill status={escalation.currentStatus} />
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
            {escalation.escalatedByName ? (
              <>
                <User className="-mt-0.5 mr-1 inline h-2.5 w-2.5" />
                {escalation.escalatedByName} escalated · {relativeTime(escalation.escalatedAt)}
              </>
            ) : (
              <>escalated · {relativeTime(escalation.escalatedAt)}</>
            )}
          </div>
        </div>
        <Link
          href={`/venues/${escalation.venueId}`}
          className="shrink-0 rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          aria-label="Open venue detail"
          title="Open venue detail"
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* Operator's verbatim notes — the heart of the escalation.
          Bordered block so it visually reads as "the venue said this". */}
      <blockquote className="mt-2 rounded-md border-rose-500/20 border-l-2 bg-rose-50/40 px-3 py-2 text-sm text-zinc-700 dark:bg-rose-950/20 dark:text-zinc-300">
        <p className="whitespace-pre-wrap">{escalation.escalationNotes}</p>
      </blockquote>

      {/* Contact shortcuts — tel: for one-tap call, in-app composer
          for email (replaces mailto so messages route through a
          connected_account and ingest to the team inbox). Hidden when
          the venue has no value on file. */}
      {(escalation.venuePhone || escalation.venueEmail) && (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
          {escalation.venuePhone && (
            <a
              href={`tel:${escalation.venuePhone}`}
              className="inline-flex items-center gap-1.5 font-mono text-zinc-600 hover:text-blue-600 hover:underline dark:text-zinc-400 dark:hover:text-blue-400"
            >
              <Phone className="h-3 w-3" />
              {escalation.venuePhone}
            </a>
          )}
          {escalation.venueEmail && (
            <ComposeEmailButton
              defaultTo={escalation.venueEmail}
              venueId={escalation.venueId}
              ariaLabel={`Email ${escalation.venueEmail}`}
              className="inline-flex items-center gap-1.5 font-mono text-zinc-600 hover:text-blue-600 hover:underline dark:text-zinc-400 dark:hover:text-blue-400"
            >
              <Mail className="h-3 w-3" />
              {escalation.venueEmail}
            </ComposeEmailButton>
          )}
        </div>
      )}
    </li>
  );
}

/** Tone-coded pill for the venue's current cold-outreach status —
 *  reuses the palette pattern from the table. Just the most common
 *  buckets the assignee will see; rare statuses fall back to neutral. */
function StatusPill({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? "bg-zinc-500/10 text-zinc-500 ring-zinc-500/20";
  const label = status.replace(/_/g, " ");
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] ring-1 ring-inset",
        tone,
      )}
    >
      {label}
    </span>
  );
}

const STATUS_TONE: Record<string, string> = {
  not_contacted: "bg-zinc-500/10 text-zinc-500 ring-zinc-500/20",
  email_sent: "bg-blue-500/10 text-blue-700 ring-blue-500/20 dark:text-blue-300",
  follow_up_due: "bg-rose-400/15 text-rose-800 ring-rose-400/25 dark:text-rose-200",
  called: "bg-blue-500/10 text-blue-700 ring-blue-500/20 dark:text-blue-300",
  voicemail: "bg-rose-400/15 text-rose-800 ring-rose-400/25 dark:text-rose-200",
  no_answer: "bg-rose-400/15 text-rose-800 ring-rose-400/25 dark:text-rose-200",
  interested: "bg-emerald-500/15 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300",
  bad_email: "bg-rose-500/15 text-rose-700 ring-rose-500/25 dark:text-rose-300",
  wrong_number: "bg-rose-500/15 text-rose-700 ring-rose-500/25 dark:text-rose-300",
};

/**
 * Minimal relative-time formatter for "5 minutes ago" / "2 days ago"
 * style strings. Intl.RelativeTimeFormat is widely supported now;
 * fallback to a plain date string if not.
 */
function relativeTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const deltaMs = Date.now() - d.getTime();
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return d.toLocaleDateString("en-US");
}
