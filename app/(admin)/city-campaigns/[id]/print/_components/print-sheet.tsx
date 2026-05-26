import type { PrintCitySheet, PrintCrawl, PrintVenueRow } from "@/lib/print-city-sheet";

interface Props {
  data: PrintCitySheet;
}

const DAY_LABEL: Record<string, string> = {
  thursday_night: "Thursday Night",
  friday_night: "Friday Night",
  saturday_day: "Saturday Day",
  saturday_night: "Saturday Night",
  sunday_day: "Sunday Day",
  sunday_night: "Sunday Night",
  other: "Other",
};

const ROLE_LABEL: Record<string, string> = {
  wristband: "🎟  Wristband Pickup",
  middle: "🍻  Middle Stop",
  final: "🏁  Final",
  alt_final: "🏁  Alt Final",
};

/**
 * Print sheet — the actual printed pages.
 *
 * Layout:
 *   • Cover page — city + date + lead staff + totals + ops note
 *   • One page per crawl — date/day/crawl#/tickets header, then
 *     each confirmed venue with full address, phone, hours,
 *     drink specials, night-of contact name + phone
 *
 * Print CSS:
 *   • @page sets US Letter / 0.5in margins
 *   • Each .print-page block forces a new page via
 *     page-break-before: always
 *   • Body background reset to white, color to black so
 *     screen styles don't bleed into print
 *
 * Designed for legibility under fluorescent venue lighting.
 * No clever tinted backgrounds — just black text on white paper
 * with clear hierarchy.
 */
export function PrintSheet({ data }: Props) {
  return (
    <main className="mx-auto max-w-5xl bg-white px-6 py-8 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 print:max-w-none print:px-0 print:py-0 print:dark:bg-white print:dark:text-zinc-900">
      <style>
        {`
          @media print {
            @page {
              size: letter;
              margin: 0.5in;
            }
            body {
              background: white !important;
              color: #000 !important;
            }
            .print-page {
              page-break-before: always;
            }
            .print-page:first-of-type {
              page-break-before: auto;
            }
            .print-no-break {
              page-break-inside: avoid;
            }
            a[href]:after {
              content: none !important;
            }
          }
        `}
      </style>

      {/* Cover page */}
      <section className="print-page mb-12 print:mb-0">
        <CoverPage data={data} />
      </section>

      {/* One page per crawl */}
      {data.crawls.map((crawl) => (
        <section key={crawl.eventId} className="print-page mb-12 print:mb-0">
          <CrawlPage crawl={crawl} cityName={data.cityName} />
        </section>
      ))}
    </main>
  );
}

function CoverPage({ data }: { data: PrintCitySheet }) {
  return (
    <div className="flex h-[10in] flex-col justify-between print:h-[9.5in]">
      <header>
        <p className="font-mono text-[11px] text-zinc-500 uppercase tracking-[0.18em]">
          {data.campaignName} · CITY SHEET
        </p>
        <h1 className="mt-2 font-semibold text-6xl tracking-tight print:text-5xl">
          {data.cityName}
          {data.cityRegion && (
            <span className="ml-3 font-mono font-normal text-2xl text-zinc-500 print:text-xl">
              {data.cityRegion}
            </span>
          )}
        </h1>
        {data.earliestCrawlDate && (
          <p className="mt-3 font-mono text-lg text-zinc-700 tabular-nums tracking-tight">
            Starting {formatLongDate(data.earliestCrawlDate)}
          </p>
        )}
      </header>

      <section className="grid grid-cols-3 gap-6 border-zinc-300 border-y py-6">
        <Stat label="Crawls" value={String(data.totals.crawlCount)} />
        <Stat label="Confirmed venues" value={String(data.totals.confirmedVenueCount)} />
        <Stat label="Tickets sold" value={String(data.totals.totalTicketsSold)} />
      </section>

      <section className="space-y-6">
        {data.leadStaffName && (
          <div>
            <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.14em]">
              Lead staff
            </p>
            <p className="mt-1 font-medium text-2xl">{data.leadStaffName}</p>
            {data.leadStaffPhone && (
              <p className="mt-0.5 font-mono text-base text-zinc-700 tabular-nums">
                {data.leadStaffPhone}
              </p>
            )}
          </div>
        )}

        {data.dashboardNote && (
          <div className="rounded-lg border-zinc-800 border-l-4 bg-zinc-100/60 px-5 py-3 print:bg-zinc-50 print:dark:bg-zinc-50">
            <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.14em]">
              Ops note
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{data.dashboardNote}</p>
          </div>
        )}
      </section>

      <footer className="border-zinc-300 border-t pt-3 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
        Generated {new Date().toISOString().slice(0, 10)} · One page per crawl follows
      </footer>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.14em]">{label}</p>
      <p className="mt-1 font-semibold text-4xl tabular-nums tracking-tight print:text-3xl">
        {value}
      </p>
    </div>
  );
}

function CrawlPage({ crawl, cityName }: { crawl: PrintCrawl; cityName: string }) {
  const dayLabel = DAY_LABEL[crawl.dayPart] ?? crawl.dayPart;

  return (
    <div>
      <header className="border-zinc-900 border-b pb-3">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] text-zinc-500 uppercase tracking-[0.18em]">
              {cityName} · {formatLongDate(crawl.eventDate)}
            </p>
            <h2 className="mt-1 font-semibold text-4xl tracking-tight print:text-3xl">
              {dayLabel}
              {crawl.crawlNumber > 1 && (
                <span className="ml-2 font-mono text-2xl text-zinc-500">#{crawl.crawlNumber}</span>
              )}
            </h2>
          </div>
          <div className="text-right">
            <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
              Tickets sold
            </p>
            <p className="mt-0.5 font-semibold text-2xl tabular-nums">{crawl.ticketsSold}</p>
          </div>
        </div>
      </header>

      {crawl.venues.length === 0 ? (
        <p className="mt-6 rounded-lg border border-zinc-400 border-dashed px-5 py-8 text-center text-sm text-zinc-500 italic">
          No confirmed venues for this crawl yet.
        </p>
      ) : (
        <ol className="mt-6 space-y-5">
          {crawl.venues.map((v, i) => (
            <li key={v.venueEventId} className="print-no-break">
              <VenueBlock venue={v} order={i + 1} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function VenueBlock({ venue, order }: { venue: PrintVenueRow; order: number }) {
  const role = ROLE_LABEL[venue.role] ?? venue.role;
  return (
    <article className="rounded-lg border border-zinc-300 p-4 print:border-zinc-400">
      <header className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <span className="font-mono font-semibold text-2xl text-zinc-400 tabular-nums print:text-xl">
            {String(order).padStart(2, "0")}
          </span>
          <div>
            <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.14em]">
              {role}
              {venue.slotPosition > 1 && ` · Slot ${venue.slotPosition}`}
            </p>
            <h3 className="mt-0.5 font-semibold text-2xl tracking-tight print:text-xl">
              {venue.venueName}
            </h3>
          </div>
        </div>
        {venue.venueCapacity && (
          <div className="text-right">
            <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
              Capacity
            </p>
            <p className="mt-0.5 font-mono text-base tabular-nums">{venue.venueCapacity}</p>
          </div>
        )}
      </header>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {venue.venueAddress && (
          <Field label="Address">
            <p className="font-medium leading-snug">{venue.venueAddress}</p>
          </Field>
        )}
        {venue.venuePhone && (
          <Field label="Venue phone">
            <p className="font-mono text-base tabular-nums">{venue.venuePhone}</p>
          </Field>
        )}
        {venue.agreedHoursText && (
          <Field label="Agreed hours">
            <p className="font-medium">{venue.agreedHoursText}</p>
          </Field>
        )}
        {(venue.nightOfContactName || venue.nightOfContactPhone) && (
          <Field label="Night-of contact">
            {venue.nightOfContactName && <p className="font-medium">{venue.nightOfContactName}</p>}
            {venue.nightOfContactPhone && (
              <p className="font-mono tabular-nums">{venue.nightOfContactPhone}</p>
            )}
          </Field>
        )}
      </div>

      {venue.drinkSpecials && (
        <div className="mt-3 rounded border-zinc-700 border-l-4 bg-zinc-50 px-3 py-2 print:bg-zinc-100">
          <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
            Drink specials
          </p>
          <p className="mt-1 whitespace-pre-wrap leading-snug">{venue.drinkSpecials}</p>
        </div>
      )}

      {venue.notes && (
        <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-700">{venue.notes}</p>
      )}
    </article>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.14em]">{label}</p>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function formatLongDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
