import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { campaigns, crawlBrands, outreachBrands } from "@/db/schema";
import { db } from "@/lib/db";
import { desc, isNull } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { Megaphone, Plus } from "lucide-react";
import Link from "next/link";
import { EditCampaignButton } from "./_components/edit-campaign-button";

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
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-semibold text-4xl tracking-tight ">Campaigns</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
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
        <Card className="border-dashed bg-transparent p-2">
          <EmptyState
            icon={Megaphone}
            title="No campaigns yet"
            description="A campaign pairs an outreach brand with a crawl brand. Create one to start building city + venue plans against the pair."
            action={{ label: "Create campaign", href: "/campaigns/new" }}
          />
        </Card>
      ) : (
        <div className="grid gap-3">
          {rows.map(({ campaign, outreachBrand, crawlBrand }) => (
            <Card
              key={campaign.id}
              className="relative flex flex-col gap-3 p-5 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900"
            >
              {/* Edit button — anchored top-right, stops Link navigation on click */}
              <div className="absolute top-3 right-3 z-10">
                <EditCampaignButton
                  campaign={{
                    id: campaign.id,
                    name: campaign.name,
                    status: campaign.status as "planning" | "active" | "completed" | "archived",
                    holidayType: campaign.holidayType as
                      | "stpaddys"
                      | "halloween"
                      | "newyears"
                      | "custom",
                    startDate: campaign.startDate ?? null,
                    endDate: campaign.endDate ?? null,
                  }}
                />
              </div>
              <Link href={`/campaigns/${campaign.id}`} className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3 pr-10">
                  <div className="flex min-w-0 flex-wrap items-baseline gap-3">
                    <h2 className="font-semibold text-2xl tracking-tight ">{campaign.name}</h2>
                    <span className="font-mono text-xs text-zinc-400 uppercase tracking-wider">
                      {campaign.slug}
                    </span>
                  </div>
                  <Badge tone={statusTone(campaign.status)}>{campaign.status}</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
                  <span>
                    <span className="text-zinc-400">via</span>{" "}
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">
                      {outreachBrand.displayName}
                    </span>
                  </span>
                  <span className="text-zinc-300">·</span>
                  <span>
                    <span className="text-zinc-400">as</span>{" "}
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">
                      {crawlBrand.displayName}
                    </span>{" "}
                    ({campaign.holidayType})
                  </span>
                  {campaign.startDate && (
                    <>
                      <span className="text-zinc-300">·</span>
                      <span>
                        {campaign.startDate}
                        {campaign.endDate && ` → ${campaign.endDate}`}
                      </span>
                    </>
                  )}
                </div>
              </Link>
            </Card>
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
