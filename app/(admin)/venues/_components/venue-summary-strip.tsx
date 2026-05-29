import { ComposeEmailModal } from "@/app/(admin)/_components/compose-email-modal";
import { Globe, Instagram, Mail, MapPin, Phone } from "lucide-react";
import Link from "next/link";

/**
 * Compact, at-a-glance facts about a venue — shown right under the page
 * header so the staffer doesn't have to read the full edit form to know
 * "when did we last touch this place" or "how many crawls has it done."
 */
export function VenueSummaryStrip({
  lastTouchAt,
  lastTouchChannel,
  touchCount,
  crawlsCount,
  doNotContact,
  doNotContactReason,
  archivedAt,
}: {
  lastTouchAt: Date | null;
  lastTouchChannel: string | null;
  touchCount: number;
  crawlsCount: number;
  doNotContact: boolean;
  doNotContactReason: string | null;
  archivedAt: Date | null;
}) {
  return (
    <div className="flex flex-wrap items-stretch gap-3">
      <StatTile
        label="Last contact"
        value={lastTouchAt ? formatAge(lastTouchAt) : "—"}
        sub={
          lastTouchChannel
            ? lastTouchChannel.replace(/_/g, " ")
            : touchCount === 0
              ? "no outreach yet"
              : null
        }
      />
      <StatTile label="Touches" value={String(touchCount)} sub="email + call log entries" />
      <StatTile
        label="Crawls"
        value={String(crawlsCount)}
        sub={crawlsCount === 0 ? "never scheduled" : "confirmed / signed"}
        tint={crawlsCount > 0 ? "emerald" : "zinc"}
      />
      {archivedAt && <Badge tone="zinc">Archived</Badge>}
      {doNotContact && (
        <Badge tone="rose" title={doNotContactReason ?? undefined}>
          Do not contact
        </Badge>
      )}
    </div>
  );
}

/**
 * Top-right quick links — single-tap reach for the actions a staffer wants
 * most when opening a venue: call, email, see on Maps, open the venue's
 * site, check their Instagram. Icons only (with native title tooltips).
 */
export function VenueQuickLinks({
  venueId,
  phoneE164,
  email,
  websiteUrl,
  instagramHandle,
  googlePlaceId,
  address,
  venueName,
}: {
  /** Optional venue UUID; if provided, emails composed from this row
   *  are attributed to the venue so the new thread shows up linked. */
  venueId?: string;
  phoneE164: string | null;
  email: string | null;
  websiteUrl: string | null;
  instagramHandle: string | null;
  googlePlaceId: string | null;
  address: string | null;
  venueName: string;
}) {
  const mapsHref = googlePlaceId
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venueName)}&query_place_id=${googlePlaceId}`
    : address
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${venueName} ${address}`)}`
      : null;
  const igHandle = instagramHandle?.replace(/^@/, "");
  const igHref = igHandle ? `https://instagram.com/${igHandle}` : null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {phoneE164 && (
        <IconLink href={`tel:${phoneE164}`} title={`Call ${phoneE164}`} label="Call">
          <Phone className="h-3.5 w-3.5" />
        </IconLink>
      )}
      {email && (
        // In-app composer instead of mailto so the message goes through
        // a chosen connected_account and ingests into /inbox.
        <ComposeEmailModal
          defaultTo={email}
          venueId={venueId}
          ariaLabel={`Email ${email}`}
          className="inline-flex h-6 items-center justify-center gap-1 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          <Mail className="h-3.5 w-3.5" />
          Email
        </ComposeEmailModal>
      )}
      {mapsHref && (
        <IconLink href={mapsHref} title="Open in Google Maps" label="Maps" external>
          <MapPin className="h-3.5 w-3.5" />
        </IconLink>
      )}
      {websiteUrl && (
        <IconLink href={websiteUrl} title={websiteUrl} label="Website" external>
          <Globe className="h-3.5 w-3.5" />
        </IconLink>
      )}
      {igHref && (
        <IconLink href={igHref} title={`@${igHandle}`} label="Instagram" external>
          <Instagram className="h-3.5 w-3.5" />
        </IconLink>
      )}
    </div>
  );
}

// -----------------------------------------------------------------
// internals
// -----------------------------------------------------------------

function StatTile({
  label,
  value,
  sub,
  tint = "zinc",
}: {
  label: string;
  value: string;
  sub?: string | null;
  tint?: "zinc" | "emerald";
}) {
  const tintBg =
    tint === "emerald"
      ? "bg-emerald-50/40 dark:bg-emerald-950/20"
      : "bg-zinc-50/40 dark:bg-zinc-900/30";
  return (
    <div
      className={`flex min-w-[120px] flex-col rounded-xl border border-zinc-200/60 px-3 py-2 dark:border-zinc-800/40 ${tintBg}`}
    >
      <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-[0.14em]">
        {label}
      </span>
      <span className="mt-1 font-semibold text-base tracking-tight">{value}</span>
      {sub && <span className="text-[10px] text-zinc-500">{sub}</span>}
    </div>
  );
}

function Badge({
  tone,
  title,
  children,
}: {
  tone: "rose" | "zinc";
  title?: string;
  children: React.ReactNode;
}) {
  const classes =
    tone === "rose"
      ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
      : "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300";
  return (
    <span
      title={title}
      className={`inline-flex items-center self-start rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${classes}`}
    >
      {children}
    </span>
  );
}

function IconLink({
  href,
  title,
  label,
  external,
  children,
}: {
  href: string;
  title: string;
  label: string;
  external?: boolean;
  children: React.ReactNode;
}) {
  const cls =
    "inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-600 transition-colors hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:text-zinc-50";
  if (external) {
    return (
      <a
        href={href}
        title={title}
        aria-label={label}
        target="_blank"
        rel="noopener noreferrer"
        className={cls}
      >
        {children}
      </a>
    );
  }
  return (
    <Link href={href} title={title} aria-label={label} className={cls}>
      {children}
    </Link>
  );
}

function formatAge(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days < 1) {
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    if (hours < 1) return "just now";
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  }
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}
