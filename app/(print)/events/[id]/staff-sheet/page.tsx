import {
  events,
  campaigns,
  cities,
  cityCampaigns,
  crawlBrands,
  staffMembers,
  venueEvents,
  venues,
} from "@/db/schema";
import { effectiveAgreedHours, effectiveNightOfContact } from "@/lib/contact-inherit";
import { db } from "@/lib/db";
import { generateQrSvg } from "@/lib/qrcode";
import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { PrintToolbar } from "../../../_components/print-toolbar";

export const dynamic = "force-dynamic";

interface VenueEventDetail {
  ve: typeof venueEvents.$inferSelect;
  venue: typeof venues.$inferSelect;
  ourContactName: string | null;
  qrSvg: string;
}

export default async function StaffSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const eventRow = await db
    .select({
      event: events,
      cc: cityCampaigns,
      city: cities,
      campaign: campaigns,
      crawlBrand: crawlBrands,
    })
    .from(events)
    .innerJoin(cityCampaigns, eq(cityCampaigns.id, events.cityCampaignId))
    .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
    .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
    .innerJoin(crawlBrands, eq(crawlBrands.id, campaigns.crawlBrandId))
    .where(eq(events.id, id))
    .limit(1)
    .then((r) => r[0]);
  if (!eventRow) notFound();

  // ALL linked venues — staff sheet covers lead/interested/confirmed
  // because a venue can still confirm on the day-of. Only declined and
  // cancelled get hidden.
  const veRows = await db
    .select({
      ve: venueEvents,
      venue: venues,
      ourContact: staffMembers,
    })
    .from(venueEvents)
    .innerJoin(venues, eq(venues.id, venueEvents.venueId))
    .leftJoin(staffMembers, eq(staffMembers.id, venueEvents.ourContactStaffId))
    .where(eq(venueEvents.eventId, id))
    .orderBy(asc(venueEvents.role), asc(venueEvents.slotStartTime));

  const active = veRows.filter((r) => r.ve.status !== "declined" && r.ve.status !== "cancelled");

  // Generate a Google Maps directions QR per venue. The link uses lat/lng
  // when present, falling back to the address. URL format:
  // https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>
  const venuesWithQrs: VenueEventDetail[] = await Promise.all(
    active.map(async (r) => {
      const dest = r.venue.location
        ? `${r.venue.location.lat},${r.venue.location.lng}`
        : (r.venue.address ?? r.venue.name);
      const mapUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
      return {
        ve: r.ve,
        venue: r.venue,
        ourContactName: r.ourContact?.displayName ?? null,
        qrSvg: await generateQrSvg(mapUrl, { size: 100, margin: 0 }),
      };
    }),
  );

  // Group by role so the operator can read the sheet by crawl-stage order
  // (wristband → middle → final → alt_final).
  const grouped: Record<"wristband" | "middle" | "final" | "alt_final", VenueEventDetail[]> = {
    wristband: [],
    middle: [],
    final: [],
    alt_final: [],
  };
  for (const v of venuesWithQrs) {
    grouped[v.ve.role].push(v);
  }

  const accentColor = eventRow.crawlBrand.accentColorHex ?? "#d97706";

  return (
    <>
      <style
        // biome-ignore lint/security/noDangerouslySetInnerHtml: static CSS template
        dangerouslySetInnerHTML={{ __html: PRINT_STYLES }}
      />
      <PrintToolbar
        backHref={`/events/${id}`}
        backLabel="Back to event"
        meta={`${venuesWithQrs.length} active venues`}
      />

      <main className="staff-sheet mx-auto my-6 flex flex-col bg-white text-zinc-900 shadow-xl">
        {/* Header */}
        <header className="border-zinc-900 border-b-2 px-10 pt-8 pb-6">
          <div className="flex items-baseline justify-between gap-6">
            <div>
              <p className="font-mono text-xs text-zinc-500 uppercase tracking-[0.3em]">
                Staff sheet · night of
              </p>
              <h1 className="mt-2 font-semibold text-4xl leading-tight tracking-tight ">
                {eventRow.crawlBrand.displayName}
              </h1>
              <p className="mt-1 text-lg text-zinc-600">
                {eventRow.city.name} · {formatDate(eventRow.event.eventDate)}
                {eventRow.event.slotNumber !== 1 && ` · slot ${eventRow.event.slotNumber}`}
              </p>
            </div>
            <div className="text-right">
              <p className="font-mono text-xs text-zinc-500 uppercase tracking-widest">Lineup</p>
              <p className="mt-1 font-mono text-3xl">
                <span style={{ color: accentColor }}>{grouped.wristband.length}</span>
                <span className="text-zinc-300">·</span>
                <span style={{ color: accentColor }}>{grouped.middle.length}</span>
                <span className="text-zinc-300">·</span>
                <span style={{ color: accentColor }}>{grouped.final.length}</span>
              </p>
              <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider">
                wristband · middle · final
              </p>
            </div>
          </div>
        </header>

        {/* Venues by role */}
        <div className="flex flex-col gap-8 px-10 py-8">
          {(["wristband", "middle", "final"] as const).map((role) => {
            const items = grouped[role];
            if (items.length === 0) return null;
            return (
              <section key={role} className="flex flex-col gap-4">
                <div className="flex items-baseline gap-3 border-zinc-200 border-b pb-2">
                  <h2
                    className="font-mono text-xs uppercase tracking-[0.3em]"
                    style={{ color: accentColor }}
                  >
                    {role}
                  </h2>
                  <span className="font-mono text-xs text-zinc-500">
                    {items.length} {items.length === 1 ? "stop" : "stops"}
                  </span>
                </div>
                <ol className="flex flex-col gap-4">
                  {items.map((v) => (
                    <VenueCard key={v.ve.id} detail={v} accentColor={accentColor} />
                  ))}
                </ol>
              </section>
            );
          })}

          {venuesWithQrs.length === 0 && (
            <p className="font-semibold text-2xl text-zinc-400 italic tracking-tight">
              No active venues linked to this event yet.
            </p>
          )}
        </div>

        {/* Footer */}
        <footer className="mt-auto border-zinc-200 border-t px-10 py-4 text-xs text-zinc-500">
          <div className="flex items-baseline justify-between">
            <span className="font-mono uppercase tracking-wider">Internal — do not distribute</span>
            <span className="font-mono">Generated {new Date().toLocaleDateString("en-US")}</span>
          </div>
        </footer>
      </main>
    </>
  );
}

function VenueCard({ detail, accentColor }: { detail: VenueEventDetail; accentColor: string }) {
  const { ve, venue, ourContactName, qrSvg } = detail;
  const slot = formatSlot(ve.slotStartTime, ve.slotEndTime);
  // Inherit-unless-overridden (lib/contact-inherit): when the slot has
  // no night-of contact / agreed hours of its own, the venue record
  // shows through — so a phone fix on the venue propagates here
  // instead of staff calling a stale number on the night.
  const contact = effectiveNightOfContact(ve, venue);
  const hours = effectiveAgreedHours(ve, venue);
  return (
    <li className="flex gap-5 rounded-md border border-zinc-200 p-4">
      <div className="flex flex-1 flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <h3 className="font-semibold text-2xl leading-tight tracking-tight">{venue.name}</h3>
            {venue.address && <p className="text-sm text-zinc-500">{venue.address}</p>}
          </div>
          <div className="text-right">
            <span
              className="rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider"
              style={{ borderColor: accentColor, color: accentColor }}
            >
              {ve.status}
            </span>
            {slot && (
              <p className="mt-1 font-mono text-sm" style={{ color: accentColor }}>
                {slot}
              </p>
            )}
          </div>
        </div>

        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          {(contact.name || contact.phone) && (
            <Detail
              label={contact.inherited ? "Contact (venue main)" : "Night-of contact"}
              value={
                contact.phone ? (
                  <a href={`tel:${contact.phone}`} className="font-mono underline">
                    {contact.name ? `${contact.name} · ` : ""}
                    {contact.phone}
                  </a>
                ) : (
                  <span>{contact.name}</span>
                )
              }
            />
          )}
          {ourContactName && (
            <Detail
              label="Our contact"
              value={
                ve.ourContactOverridePhoneE164 ? (
                  <a href={`tel:${ve.ourContactOverridePhoneE164}`} className="font-mono underline">
                    {ourContactName} · {ve.ourContactOverridePhoneE164}
                  </a>
                ) : (
                  <span>{ourContactName}</span>
                )
              }
            />
          )}
          {hours.text && (
            <Detail label={hours.inherited ? "Venue hours" : "Agreed hours"} value={hours.text} />
          )}
          {ve.drinkSpecials && (
            <Detail label="Drink specials" value={ve.drinkSpecials} colSpan={2} />
          )}
          {venue.internalNotes && (
            <Detail
              label="Notes"
              value={
                <span className="text-zinc-600 italic">
                  {venue.internalNotes.length > 200
                    ? `${venue.internalNotes.slice(0, 200)}…`
                    : venue.internalNotes}
                </span>
              }
              colSpan={2}
            />
          )}
        </dl>
      </div>

      {/* Per-venue QR linking to Google Maps directions */}
      <div className="flex flex-col items-center gap-1">
        <div
          className="h-20 w-20"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted QR SVG output
          dangerouslySetInnerHTML={{ __html: qrSvg }}
        />
        <p className="font-mono text-[9px] text-zinc-500 uppercase tracking-widest">directions</p>
      </div>
    </li>
  );
}

function Detail({
  label,
  value,
  colSpan = 1,
}: {
  label: string;
  value: React.ReactNode;
  colSpan?: 1 | 2;
}) {
  return (
    <div className={`flex flex-col ${colSpan === 2 ? "col-span-2" : ""}`}>
      <dt className="font-mono text-[10px] text-zinc-400 uppercase tracking-widest">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

function formatSlot(start: string | null, end: string | null): string | null {
  if (!start && !end) return null;
  if (start && end) return `${formatTime(start)} – ${formatTime(end)}`;
  if (start) return `from ${formatTime(start)}`;
  return null;
}

function formatTime(t: string): string {
  const [hStr, mStr] = t.split(":");
  const h = Number.parseInt(hStr ?? "0", 10);
  const m = Number.parseInt(mStr ?? "0", 10);
  if (Number.isNaN(h)) return t;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`;
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

const PRINT_STYLES = `
  @page {
    size: letter portrait;
    margin: 0;
  }
  @media print {
    .no-print { display: none !important; }
    body { margin: 0; padding: 0; background: white; }
    .staff-sheet {
      box-shadow: none !important;
      margin: 0 !important;
    }
  }
  .staff-sheet {
    width: 8.5in;
    min-height: 11in;
    color: #1a1a1a;
  }
`;
