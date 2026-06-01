/**
 * /admin/archived-cities — restore-and-purge surface for soft-deleted
 * cities.
 *
 * Admin-only. Lists every city with archived_at IS NOT NULL. Two
 * per-row actions:
 *
 *   - Restore  (admin) — clears archived_at; the city reappears
 *                        across the app
 *   - Delete permanently (admin) — cascading DELETE through venues
 *                        + campaigns + history
 *
 * Per operator: "from the cities tab you should be able to permanently
 * delete a city as an admin not just archive". Mirrors the venue
 * pattern from /admin/archived-venues.
 */

import { cities, countries } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { desc, eq, isNotNull } from "drizzle-orm";
import { Archive } from "lucide-react";
import { ArchivedCitiesList } from "./_components/archived-cities-list";

export const metadata = {
  title: "Archived cities",
};

export default async function ArchivedCitiesPage() {
  await requireAdmin();

  const rows = await db
    .select({
      id: cities.id,
      name: cities.name,
      region: cities.region,
      countryCode: cities.countryCode,
      countryName: countries.name,
      timezone: cities.timezone,
      archivedAt: cities.archivedAt,
    })
    .from(cities)
    .innerJoin(countries, eq(countries.code, cities.countryCode))
    .where(isNotNull(cities.archivedAt))
    .orderBy(desc(cities.archivedAt))
    .limit(500);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8">
      <header className="flex items-start gap-3">
        <Archive className="mt-1 h-5 w-5 text-zinc-500" />
        <div>
          <h1 className="font-semibold text-lg tracking-tight">Archived cities</h1>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
            Soft-deleted cities. Restore to bring back into the main directory, or permanently
            delete to remove for good (cascades through venues + campaigns + history —
            irreversible). Most recent archives first; capped at 500.
          </p>
        </div>
      </header>

      <ArchivedCitiesList
        rows={rows.map((r) => ({
          id: r.id,
          name: r.name,
          region: r.region ?? null,
          countryCode: r.countryCode,
          countryName: r.countryName,
          timezone: r.timezone,
          archivedAt: r.archivedAt ? r.archivedAt.toISOString() : null,
        }))}
      />
    </div>
  );
}
