/**
 * /admin/archived-campaigns — restore-and-purge surface for
 * soft-deleted campaigns.
 *
 * Admin-only. Lists every campaign with archived_at IS NOT NULL.
 * Two per-row actions:
 *
 *   - Restore (admin) — clears archived_at, resets status to
 *                       'planning' so it shows up in the switcher
 *                       again
 *   - Delete permanently (admin) — uses the existing
 *                       deleteCampaignWithConfirmation cascade
 *                       (typed confirm)
 *
 * Per operator: "campaigns tab should let me do a switch button on
 * campaigns to choose archive, archived campaigns should not show
 * on the dropdown campaign at the top nor on the non-admin home
 * page." Both filters are already in place (campaign-switcher.tsx
 * line 25 + getCurrentCampaign line 63). This page is the restore
 * surface for items archived via the new per-row button on /campaigns.
 */

import { campaigns, crawlBrands, outreachBrands } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { desc, eq, isNotNull } from "drizzle-orm";
import { Archive } from "lucide-react";
import { ArchivedCampaignsList } from "./_components/archived-campaigns-list";

export const metadata = {
  title: "Archived campaigns",
};

export default async function ArchivedCampaignsPage() {
  await requireAdmin();

  const rows = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      slug: campaigns.slug,
      holidayType: campaigns.holidayType,
      startDate: campaigns.startDate,
      endDate: campaigns.endDate,
      archivedAt: campaigns.archivedAt,
      outreachBrand: outreachBrands.displayName,
      crawlBrand: crawlBrands.displayName,
    })
    .from(campaigns)
    .innerJoin(outreachBrands, eq(outreachBrands.id, campaigns.outreachBrandId))
    .innerJoin(crawlBrands, eq(crawlBrands.id, campaigns.crawlBrandId))
    .where(isNotNull(campaigns.archivedAt))
    .orderBy(desc(campaigns.archivedAt))
    .limit(500);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8">
      <header className="flex items-start gap-3">
        <Archive className="mt-1 h-5 w-5 text-zinc-500" />
        <div>
          <h1 className="font-semibold text-lg tracking-tight">Archived campaigns</h1>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
            Soft-deleted campaigns. Archived campaigns don't appear in the campaign switcher or the
            non-admin home page. Restore brings them back into rotation (status resets to
            "planning"); "Delete permanently" cascades the archive through every city_campaign +
            event + cold_outreach beneath the campaign (per CLAUDE.md §6, engine-wide rule: never
            hard-delete, only soft-archive).
          </p>
        </div>
      </header>

      <ArchivedCampaignsList
        rows={rows.map((r) => ({
          id: r.id,
          name: r.name,
          slug: r.slug,
          holidayType: r.holidayType ?? null,
          startDate: r.startDate ?? null,
          endDate: r.endDate ?? null,
          archivedAt: r.archivedAt ? r.archivedAt.toISOString() : null,
          outreachBrand: r.outreachBrand,
          crawlBrand: r.crawlBrand,
        }))}
      />
    </div>
  );
}
