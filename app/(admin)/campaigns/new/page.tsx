import { listCrawlBrands, listOutreachBrands } from "@/lib/brand-context";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { createCampaign } from "../_actions";
import { CampaignForm } from "../_components/campaign-form";

export const dynamic = "force-dynamic";

export default async function NewCampaignPage() {
  const [outreachBrands, crawlBrands] = await Promise.all([
    listOutreachBrands(),
    listCrawlBrands(),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <header>
        <Link
          href="/campaigns"
          className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"
        >
          <ChevronLeft className="h-3 w-3" /> All campaigns
        </Link>
        <h1 className="mt-3 font-serif text-4xl tracking-tight">New campaign</h1>
        <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
          The brand pair is permanent — pick carefully.
        </p>
      </header>

      <CampaignForm
        mode="create"
        outreachBrands={outreachBrands.map((b) => ({
          id: b.id,
          displayName: b.displayName,
        }))}
        crawlBrands={crawlBrands.map((b) => ({
          id: b.id,
          displayName: b.displayName,
          holidayType: b.holidayType,
        }))}
        action={createCampaign}
      />
    </div>
  );
}
