import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { campaigns, crawlBrands, outreachBrands } from "@/db/schema";
import { db } from "@/lib/db";
import { desc, isNull } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { Plus } from "lucide-react";
import Link from "next/link";

// Live DB state — never prerender.
export const dynamic = "force-dynamic";

export default async function CampaignsListPage() {
  const rows = await db
    .select({
      campaign: campaigns,
      outreachBrand: outreachBrands,
      crawlBrand: crawlBrands,
    })
    .from(campaigns)
    .innerJoin(outreachBrands, eq(outreachBrands.id, campaigns.outreachBrandId))
    .innerJoin(crawlBrands, eq(crawlBrands.id, campaigns.crawlBrandId))
    .where(isNull(campaigns.archivedAt))
    .orderBy(desc(campaigns.createdAt));

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-semibold text-4xl tracking-tight ">Campaigns</h1>
          <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
            Each campaign ties an outreach brand to a crawl brand for a specific holiday cycle.
          </p>
        </div>
        <Button asChild>
          <Link href="/campaigns/new">
            <Plus className="h-4 w-4" /> New campaign
          </Link>
        </Button>
      </header>

      {rows.length === 0 ? (
        <Card className="border-dashed bg-transparent p-10 text-center">
          <p className="font-semibold text-2xl tracking-tight ">No campaigns yet.</p>
          <p className="mt-2 text-sm text-stone-500">
            Create one to start building city + venue plans against a brand pair.
          </p>
        </Card>
      ) : (
        <div className="grid gap-3">
          {rows.map(({ campaign, outreachBrand, crawlBrand }) => (
            <Link key={campaign.id} href={`/campaigns/${campaign.id}`} className="group">
              <Card className="flex flex-col gap-3 p-5 transition-colors group-hover:bg-stone-50 dark:group-hover:bg-stone-900">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-baseline gap-3">
                    <h2 className="font-semibold text-2xl tracking-tight ">{campaign.name}</h2>
                    <span className="font-mono text-stone-400 text-xs uppercase tracking-wider">
                      {campaign.slug}
                    </span>
                  </div>
                  <Badge tone={statusTone(campaign.status)}>{campaign.status}</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-stone-500 text-xs">
                  <span>
                    <span className="text-stone-400">via</span>{" "}
                    <span className="font-medium text-stone-700 dark:text-stone-300">
                      {outreachBrand.displayName}
                    </span>
                  </span>
                  <span className="text-stone-300">·</span>
                  <span>
                    <span className="text-stone-400">as</span>{" "}
                    <span className="font-medium text-stone-700 dark:text-stone-300">
                      {crawlBrand.displayName}
                    </span>{" "}
                    ({campaign.holidayType})
                  </span>
                  {campaign.startDate && (
                    <>
                      <span className="text-stone-300">·</span>
                      <span>
                        {campaign.startDate}
                        {campaign.endDate && ` → ${campaign.endDate}`}
                      </span>
                    </>
                  )}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function statusTone(status: string): "default" | "success" | "muted" | "warning" {
  switch (status) {
    case "active":
      return "success";
    case "completed":
      return "muted";
    case "archived":
      return "muted";
    default:
      return "default";
  }
}
