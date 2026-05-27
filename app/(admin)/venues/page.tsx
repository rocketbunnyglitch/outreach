import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cities, venues } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { listOutreachBrands } from "@/lib/brand-context";
import { loadComposerData } from "@/lib/composer-data";
import { db } from "@/lib/db";
import { asc, eq, isNull } from "drizzle-orm";
import { Plus } from "lucide-react";
import Link from "next/link";
import { queueBulkSend } from "./../send-queue/_actions";
import { bulkUpdateVenues } from "./_actions";
import { VenuesTable } from "./_components/venues-table";

export const dynamic = "force-dynamic";

export default async function VenuesListPage() {
  const { staff } = await requireStaff();
  const rows = await db
    .select({
      venue: venues,
      city: cities,
    })
    .from(venues)
    .innerJoin(cities, eq(cities.id, venues.cityId))
    .where(isNull(venues.archivedAt))
    .orderBy(asc(cities.name), asc(venues.name));

  // Group venues by city
  const byCity = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.city.name;
    const existing = byCity.get(key);
    if (existing) existing.push(row);
    else byCity.set(key, [row]);
  }
  const _groups = Array.from(byCity.entries()).map(([cityName, cityRows]) => ({
    cityName,
    venues: cityRows.map((r) => ({
      id: r.venue.id,
      name: r.venue.name,
      address: r.venue.address,
      capacity: r.venue.capacity,
      doNotContact: r.venue.doNotContact,
    })),
  }));

  // Flatten rows for the table; build distinct city list for the filter
  const flatRows = rows.map((r) => ({
    id: r.venue.id,
    name: r.venue.name,
    cityName: r.city.name,
    address: r.venue.address,
    capacity: r.venue.capacity,
    doNotContact: r.venue.doNotContact,
  }));
  const cityOptions = Array.from(new Set(flatRows.map((r) => r.cityName)))
    .sort()
    .map((name) => ({ value: name, label: name }));

  // Bulk-send dialog data — brands + templates + inbox throttle status per
  // brand for the logged-in staffer. Shape is what BulkSendDialog needs.
  const outreachBrandsList = await listOutreachBrands();
  const composerData = await loadComposerData({
    staffMemberId: staff.id,
    outreachBrandIds: outreachBrandsList.map((b) => b.id),
  });

  // Reshape: composer returns full inbox status; bulk dialog only needs
  // a subset (min spacing + cap + counters). Null out brands without a
  // connected inbox.
  const bulkBrandConfig = Object.fromEntries(
    outreachBrandsList.map((b) => {
      const c = composerData[b.id];
      const inbox = c?.inbox;
      return [
        b.id,
        {
          templates: c?.templates ?? [],
          inbox: inbox?.inboxId
            ? {
                inboxId: inbox.inboxId,
                minSecondsBetweenSends: 90, // default; composer doesn't surface it
                effectiveDailyCap: inbox.effectiveDailyCap ?? 30,
                sent24h: inbox.sent24h ?? 0,
                warmupDay: inbox.warmupDay ?? null,
              }
            : null,
        },
      ];
    }),
  );

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-semibold text-4xl tracking-tight ">Venues</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Bars, restaurants, and event spaces. Click a column header to sort; use the filter row
            for a quick narrow. Inline-edit name, capacity, and DNC on any row.
          </p>
        </div>
        <Button asChild>
          <Link href="/venues/new">
            <Plus className="h-4 w-4" /> New venue
          </Link>
        </Button>
      </header>

      {rows.length === 0 ? (
        <Card className="border-dashed bg-transparent p-10 text-center">
          <p className="font-semibold text-2xl tracking-tight ">No venues yet.</p>
          <p className="mt-2 text-sm text-zinc-500">
            Phase 5 will populate venues automatically from Google Maps; for now add them manually
            or import from CSV via /import.
          </p>
        </Card>
      ) : (
        <VenuesTable
          rows={flatRows}
          cityOptions={cityOptions}
          bulkAction={bulkUpdateVenues}
          currentStaffId={staff.id}
          bulkSend={{
            brands: outreachBrandsList.map((b) => ({
              id: b.id,
              displayName: b.displayName,
              outreachPhase: (b.outreachPhase as 1 | 2 | 3 | 4) ?? 1,
            })),
            brandConfig: bulkBrandConfig,
            queueAction: queueBulkSend,
          }}
        />
      )}
    </div>
  );
}
