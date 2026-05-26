import {
  events,
  campaigns,
  cities,
  cityCampaigns,
  crawlBrands,
  outreachBrands,
  venueEvents,
  venues,
} from "@/db/schema";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { generateQrSvg } from "@/lib/qrcode";
import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { PrintToolbar } from "../../../_components/print-toolbar";

export const dynamic = "force-dynamic";

export default async function PosterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const eventRow = await db
    .select({
      event: events,
      cc: cityCampaigns,
      city: cities,
      campaign: campaigns,
      crawlBrand: crawlBrands,
      outreachBrand: outreachBrands,
    })
    .from(events)
    .innerJoin(cityCampaigns, eq(cityCampaigns.id, events.cityCampaignId))
    .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
    .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
    .innerJoin(crawlBrands, eq(crawlBrands.id, campaigns.crawlBrandId))
    .innerJoin(outreachBrands, eq(outreachBrands.id, campaigns.outreachBrandId))
    .where(eq(events.id, id))
    .limit(1)
    .then((r) => r[0]);
  if (!eventRow) notFound();

  // Only confirmed venues land on the public poster — leads / interested
  // / negotiating shouldn't be advertised publicly.
  const veRows = await db
    .select({ ve: venueEvents, venue: venues })
    .from(venueEvents)
    .innerJoin(venues, eq(venues.id, venueEvents.venueId))
    .where(eq(venueEvents.eventId, id))
    .orderBy(asc(venueEvents.slotStartTime), asc(venueEvents.role));

  const confirmed = veRows.filter((r) => r.ve.status === "confirmed");
  const totalLinked = veRows.length;

  // QR code links to the public landing page for this event (Phase 8). For
  // now this URL won't resolve to a real page but the QR is fixed-format so
  // updating the route later doesn't require regenerating the poster.
  const publicSubdomain = eventRow.campaign.publicSubdomain ?? eventRow.campaign.slug;
  const qrTarget = `${env.APP_URL}/p/${publicSubdomain}/${eventRow.event.eventDate}`;
  const qrSvg = await generateQrSvg(qrTarget, { size: 220, margin: 0 });

  const primaryColor = eventRow.crawlBrand.primaryColorHex ?? "#1a1a1a";
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
        meta={`${confirmed.length} confirmed of ${totalLinked} linked`}
      />

      <main className="poster-sheet mx-auto my-6 flex flex-col items-stretch bg-white shadow-xl">
        <header className="px-12 pt-12 pb-8 text-white" style={{ backgroundColor: primaryColor }}>
          <p
            className="font-mono text-xs uppercase tracking-[0.3em]"
            style={{ color: accentColor }}
          >
            {eventRow.crawlBrand.holidayType.replace(/^\w/, (c) => c.toUpperCase())} ·{" "}
            {eventRow.city.name}
          </p>
          <h1 className="mt-4 font-serif text-7xl leading-none tracking-tight">
            {eventRow.crawlBrand.displayName}
          </h1>
          {eventRow.crawlBrand.tagline && (
            <p className="mt-4 text-xl leading-tight" style={{ color: accentColor }}>
              {eventRow.crawlBrand.tagline}
            </p>
          )}
          <p className="mt-8 font-serif text-5xl leading-tight">
            {formatDate(eventRow.event.eventDate)}
          </p>
        </header>

        <section className="flex flex-1 flex-col gap-6 px-12 py-10 text-stone-900">
          {confirmed.length === 0 ? (
            <p className="font-serif text-2xl text-stone-400 italic">Venues to be announced.</p>
          ) : (
            <>
              <h2 className="font-mono text-stone-500 text-xs uppercase tracking-[0.3em]">
                The lineup
              </h2>
              <ol className="flex flex-col gap-5">
                {confirmed.map(({ ve, venue }) => (
                  <li
                    key={ve.id}
                    className="flex items-baseline gap-5 border-stone-200 border-b pb-5"
                  >
                    <span
                      className="font-mono text-xs uppercase tracking-wider"
                      style={{ color: accentColor, minWidth: "80px" }}
                    >
                      {ve.slotStartTime ? formatTime(ve.slotStartTime) : ""}
                    </span>
                    <div className="flex flex-1 flex-col gap-1">
                      <h3 className="font-serif text-3xl leading-tight">{venue.name}</h3>
                      {venue.address && <p className="text-sm text-stone-500">{venue.address}</p>}
                    </div>
                    <span
                      className="rounded-full border px-3 py-0.5 font-mono text-[10px] uppercase tracking-wider"
                      style={{
                        borderColor: accentColor,
                        color: accentColor,
                      }}
                    >
                      {ve.role}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>

        <footer className="flex items-end justify-between gap-6 px-12 pb-12">
          <div className="flex flex-col gap-1">
            <p className="font-mono text-stone-500 text-xs uppercase tracking-[0.3em]">
              Tickets &amp; info
            </p>
            <p className="font-serif text-lg" style={{ color: primaryColor }}>
              {publicSubdomain}.{extractRootHost(env.APP_URL)}
            </p>
          </div>
          <div className="flex flex-col items-center gap-1">
            <div
              className="h-32 w-32"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted QR SVG output
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
            <p className="font-mono text-[9px] text-stone-500 uppercase tracking-widest">
              scan to RSVP
            </p>
          </div>
        </footer>
      </main>
    </>
  );
}

const PRINT_STYLES = `
  @page {
    size: letter portrait;
    margin: 0;
  }
  @media print {
    .no-print { display: none !important; }
    body { margin: 0; padding: 0; background: white; }
    .poster-sheet {
      box-shadow: none !important;
      margin: 0 !important;
    }
  }
  .poster-sheet {
    width: 8.5in;
    min-height: 11in;
    color: #1a1a1a;
  }
`;

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

function formatTime(t: string): string {
  const [hStr, mStr] = t.split(":");
  const h = Number.parseInt(hStr ?? "0", 10);
  const m = Number.parseInt(mStr ?? "0", 10);
  if (Number.isNaN(h)) return t;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`;
}

function extractRootHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "example.com";
  }
}
