import { VenueEmailsButton } from "@/app/(admin)/city-campaigns/_components/venue-emails-popover";
import type { VenueContactsData } from "@/lib/venue-contacts-data";
import { Mail, MessageSquareReply, Moon, Phone, StickyNote, User, Users } from "lucide-react";

/**
 * Unified contact roster on the venue detail page (operator request
 * 2026-06-11). One card showing every contact identity the engine
 * knows, instead of scattering them across the edit form, crawl
 * tables, and email threads:
 *
 *   - The email list (primary + alternates) with the same multi-email
 *     editor the cold table uses — sends go to every address.
 *   - People who REPLIED, newest first (the operator's best contacts).
 *   - The on-file contact person (venues.contact_name).
 *   - Night-of contacts entered on crawl slots.
 *
 * Server component; all timestamps preformatted in the loader.
 */
export function VenueContactsSection({
  venueId,
  email,
  alternateEmails,
  contactName,
  phoneE164,
  contacts,
}: {
  venueId: string;
  email: string | null;
  alternateEmails: string[];
  contactName: string | null;
  phoneE164: string | null;
  contacts: VenueContactsData;
}) {
  const allEmails = [email, ...alternateEmails].filter((e): e is string => Boolean(e?.trim()));
  // Replying people lead (sorted latest-reply-first by the loader) —
  // they are who the operator should talk to next.
  const hasAnything =
    allEmails.length > 0 ||
    contacts.replying.length > 0 ||
    contacts.slotContacts.length > 0 ||
    Boolean(contactName);

  return (
    <section className="card-surface flex flex-col gap-3 p-4">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-zinc-400" />
          <h3 className="font-semibold text-sm tracking-tight">Contacts</h3>
        </div>
        <VenueEmailsButton venueId={venueId} email={email} alternateEmails={alternateEmails} />
      </header>

      {!hasAnything && (
        <p className="text-xs text-zinc-500">
          No contacts yet. Add emails with the button above — replies and crawl-table contacts will
          collect here automatically.
        </p>
      )}

      {/* Email list — every address sends get addressed to. */}
      {allEmails.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Mail className="h-3 w-3 shrink-0 text-zinc-400" />
          {allEmails.map((e, i) => (
            <span
              key={e}
              className="inline-flex items-center gap-1 rounded-full bg-zinc-500/10 px-2 py-0.5 font-mono text-[10px] text-zinc-700 ring-1 ring-zinc-500/20 ring-inset dark:text-zinc-300"
              title={i === 0 ? "Primary email" : "Also receives every email to this venue"}
            >
              {e}
              {i === 0 && allEmails.length > 1 && (
                <span className="text-[8px] text-zinc-400 uppercase">primary</span>
              )}
            </span>
          ))}
        </div>
      )}

      {/* The humans who replied — latest first. */}
      {contacts.replying.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {contacts.replying.map((p) => (
            <li key={p.email} className="flex items-center justify-between gap-2 text-xs">
              <span className="flex min-w-0 items-center gap-1.5">
                <MessageSquareReply className="h-3 w-3 shrink-0 text-emerald-500" />
                <span className="truncate">
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    {p.name ?? p.email}
                  </span>
                  {p.name && (
                    <span className="ml-1.5 font-mono text-[10px] text-zinc-500">{p.email}</span>
                  )}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                replied {p.lastReplyLabel}
                {!p.onFile && (
                  <span
                    className="ml-1 text-amber-600 dark:text-amber-400"
                    title="This address isn't saved on the venue yet — add it via the mail button above so sends include them"
                  >
                    · not saved
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* On-file contact person + phone. */}
      {(contactName || phoneE164) && (
        <p className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
          <User className="h-3 w-3 shrink-0 text-zinc-400" />
          {contactName ?? "Contact on file"}
          {phoneE164 && (
            <span className="inline-flex items-center gap-1 font-mono text-[10px] text-zinc-500">
              <Phone className="h-2.5 w-2.5" />
              {phoneE164}
            </span>
          )}
        </p>
      )}

      {/* Cold-table remarks (linkage-gap fix: "call back Tuesday" used
          to be visible ONLY on the outreach table). */}
      {contacts.remarks.length > 0 && (
        <div className="border-zinc-200/60 border-t pt-2 dark:border-zinc-800/40">
          <ul className="flex flex-col gap-1">
            {contacts.remarks.map((r) => (
              <li
                key={`${r.cityName ?? ""}|${r.updatedLabel}|${r.text.slice(0, 24)}`}
                className="flex items-start gap-1.5 text-xs text-zinc-600 dark:text-zinc-400"
              >
                <StickyNote className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{r.text}</span>
                <span className="shrink-0 font-mono text-[9px] text-zinc-400 uppercase">
                  {r.cityName ? `${r.cityName} · ` : ""}
                  {r.updatedLabel}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Night-of contacts from crawl slots. */}
      {contacts.slotContacts.length > 0 && (
        <ul className="flex flex-col gap-1">
          {contacts.slotContacts.map((c) => (
            <li
              key={`${c.name ?? ""}|${c.phone ?? ""}`}
              className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400"
            >
              <Moon className="h-3 w-3 shrink-0 text-zinc-400" />
              <span className="truncate">
                {c.name ?? "Night-of contact"}
                {c.phone && <span className="ml-1.5 font-mono text-[10px]">{c.phone}</span>}
              </span>
              {c.eventLabel && (
                <span className="ml-auto shrink-0 font-mono text-[9px] text-zinc-400 uppercase">
                  {c.eventLabel}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
