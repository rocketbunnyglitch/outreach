import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { createCampaign } from "../_actions";
import { CampaignForm } from "../_components/campaign-form";

export const dynamic = "force-dynamic";

export default async function NewCampaignPage() {
  return (
    <div className="flex flex-col gap-8">
      <header>
        <Link
          href="/campaigns"
          className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          <ChevronLeft className="h-3 w-3" /> All campaigns
        </Link>
        <h1 className="mt-3 font-semibold text-4xl tracking-tight ">New campaign</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Name the campaign and set its dates. Brand + alias are picked at send time.
        </p>
      </header>

      <CampaignForm mode="create" action={createCampaign} />
    </div>
  );
}
