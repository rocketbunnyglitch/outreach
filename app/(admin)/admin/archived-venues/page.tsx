/**
 * /admin/archived-venues — restore-and-purge surface for soft-deleted
 * venues.
 *
 * Admin-only. Lists every venue with archived_at IS NOT NULL. Two
 * per-row actions:
 *
 *   - Restore  (admin) — clears archived_at; the venue reappears
 *                        across the app
 *   - Delete permanently (admin) — hard DELETE FROM venues cascading
 *                        to outreach + venue_events + etc.
 *
 * Per operator: "an Archived Venue tab should be in Admin and allow
 * me to restore if needed". The matching archive verb is on the
 * per-row affordance in city-venues-table.tsx (or /venues/[id]).
 */

import { cities, venues } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { desc, eq, isNotNull } from "drizzle-orm";
import { Archive } from "lucide-react";
import { ArchivedVenuesList } from "./_components/archived-venues-list";

export const metadata = {
  title: "Archived venues",
};

export default async function ArchivedVenuesPage() {
  await requireAdmin();

  const rows = await db
    .select({
      id: venues.id,
      name: venues.name,
      address: venues.address,
      email: venues.email,
      phoneE164: venues.phoneE164,
      archivedAt: venues.archivedAt,
      cityName: cities.name,
      cityRegion: cities.region,
    })
    .from(venues)
    .leftJoin(cities, eq(cities.id, venues.cityId))
    .where(isNotNull(venues.archivedAt))
    .orderBy(desc(venues.archivedAt))
    .limit(500);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8">
      <header className="flex items-start gap-3">
        <Archive className="mt-1 h-5 w-5 text-zinc-500" />
        <div>
          <h1 className="font-semibold text-lg tracking-tight">Archived venues</h1>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
            Soft-deleted venues. Restore to bring back into the main lists, or permanently delete to
            remove for good (cascades through outreach + events + history — irreversible). Most
            recent archives first; capped at 500.
          </p>
        </div>
      </header>

      <ArchivedVenuesList
        rows={rows.map((r) => ({
          id: r.id,
          name: r.name,
          address: r.address ?? null,
          email: r.email ?? null,
          phoneE164: r.phoneE164 ?? null,
          archivedAt: r.archivedAt ? r.archivedAt.toISOString() : null,
          cityName: r.cityName ?? null,
          cityRegion: r.cityRegion ?? null,
        }))}
      />
    </div>
  );
}
