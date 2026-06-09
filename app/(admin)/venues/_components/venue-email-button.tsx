"use client";

/**
 * VenueEmailButton — opens the global composer pre-attributed to this venue.
 *
 * Dispatches the same `compose-email` event the cold-outreach table uses, so
 * the composer engine-picks the right template (it derives the city-campaign
 * from the venue) and pre-fills the recipient. The composer is mounted in the
 * admin layout, so this works from the venue page.
 */

import { Mail } from "lucide-react";

export function VenueEmailButton({
  venueId,
  email,
  alternateEmails = [],
}: {
  venueId: string;
  email: string | null;
  /** Additional known addresses (e.g. promoted from a contact scrape). When
   *  present, the composer is pre-filled to email ALL of them at once. */
  alternateEmails?: string[];
}) {
  function open() {
    const all = [email, ...alternateEmails].filter((e): e is string => Boolean(e?.trim()));
    const deduped = [...new Map(all.map((e) => [e.toLowerCase(), e])).values()];
    const to = deduped.length > 0 ? deduped.join(", ") : undefined;
    window.dispatchEvent(
      new CustomEvent("compose-email", {
        detail: { venueId, to },
      }),
    );
  }
  return (
    <button
      type="button"
      onClick={open}
      className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-zinc-900 px-3 py-2 font-medium text-sm text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
    >
      <Mail className="h-4 w-4" />
      Email this venue
    </button>
  );
}
