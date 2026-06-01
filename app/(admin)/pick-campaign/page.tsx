/**
 * /pick-campaign — one-click campaign picker for non-admin staff.
 *
 * When a non-admin operator hits the home dashboard without a
 * current-campaign cookie set, they used to land on /campaigns
 * (the full management list with create + edit + archive UI),
 * which is overkill — they just want to pick one and start
 * working.
 *
 * Per operator: "If a non admin logins and doesn't select a
 * campaign they have a loading screen with active campaigns
 * to click to automatically load it rather than having to
 * select it from the drop down at the top."
 *
 * This page is the simpler version:
 *   - Hero card per active (non-archived) campaign
 *   - One click sets the cookie + redirects to / (the
 *     campaign-scoped dashboard the operator actually wants)
 *   - No edit / archive / create affordances — those live on
 *     /campaigns for admins
 *
 * Admin operators can still use this page if they want — the
 * route is open — but their home redirect points them at /admin
 * instead so they rarely hit it.
 */

import { Button } from "@/components/ui/button";
import { campaigns, crawlBrands, outreachBrands } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { asc, desc, eq, isNull } from "drizzle-orm";
import { ArrowRight, Megaphone } from "lucide-react";
import { goToCampaignDashboard } from "../_actions";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Pick a campaign",
};

export default async function PickCampaignPage() {
  await requireStaff();

  // Active campaigns first (status='active'), then planning, then
  // completed. Archived campaigns are excluded by archivedAt IS NULL,
  // matching the campaign-switcher behavior.
  //
  // Custom ordering: 'active' status has priority because that's
  // the campaign the operator is most likely working on. The
  // CASE expression sorts by status bucket first, then by start
  // date DESC within each bucket.
  const rows = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      slug: campaigns.slug,
      status: campaigns.status,
      startDate: campaigns.startDate,
      endDate: campaigns.endDate,
      holidayType: campaigns.holidayType,
      outreachBrand: outreachBrands.displayName,
      crawlBrand: crawlBrands.displayName,
    })
    .from(campaigns)
    .innerJoin(outreachBrands, eq(outreachBrands.id, campaigns.outreachBrandId))
    .innerJoin(crawlBrands, eq(crawlBrands.id, campaigns.crawlBrandId))
    .where(isNull(campaigns.archivedAt))
    .orderBy(asc(campaigns.status), desc(campaigns.startDate));

  // Split into "active" (urgent) and "everything else" so the UI
  // can emphasize what the operator most likely wants.
  const active = rows.filter((r) => r.status === "active");
  const planning = rows.filter((r) => r.status === "planning");
  const other = rows.filter((r) => r.status !== "active" && r.status !== "planning");

  if (rows.length === 0) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 px-6 py-16 text-center">
        <Megaphone className="h-10 w-10 text-zinc-400" />
        <h1 className="font-semibold text-2xl tracking-tight">No campaigns yet</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Once an admin creates a campaign, you'll be able to pick it from here.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl animate-[fade-in_250ms_ease-out] flex-col gap-8 px-6 py-12">
      <header>
        <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.18em]">
          Pick a campaign
        </p>
        <h1 className="mt-2 font-semibold text-3xl tracking-tight">
          What are you working on today?
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Tap one to load its dashboard. You can switch any time from the dropdown at the top.
        </p>
      </header>

      {active.length > 0 && (
        <Section
          title="Active"
          description="Currently running. This is probably what you want."
          tone="emerald"
        >
          {active.map((r) => (
            <CampaignButton key={r.id} row={r} primary />
          ))}
        </Section>
      )}

      {planning.length > 0 && (
        <Section
          title="Planning"
          description="Upcoming campaigns being prepped. Pick if you're working ahead."
        >
          {planning.map((r) => (
            <CampaignButton key={r.id} row={r} />
          ))}
        </Section>
      )}

      {other.length > 0 && (
        <Section title="Other" description="Past campaigns kept around for reference.">
          {other.map((r) => (
            <CampaignButton key={r.id} row={r} />
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  description,
  tone = "zinc",
  children,
}: {
  title: string;
  description: string;
  tone?: "emerald" | "zinc";
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2
          className={
            tone === "emerald"
              ? "font-semibold text-base text-emerald-700 tracking-tight dark:text-emerald-300"
              : "font-semibold text-base text-zinc-700 tracking-tight dark:text-zinc-300"
          }
        >
          {title}
        </h2>
        <span className="font-mono text-[10px] text-zinc-500 tracking-[0.1em]">{description}</span>
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

function CampaignButton({
  row,
  primary = false,
}: {
  row: {
    id: string;
    name: string;
    slug: string;
    status: string;
    startDate: string | null;
    endDate: string | null;
    holidayType: string | null;
    outreachBrand: string;
    crawlBrand: string;
  };
  primary?: boolean;
}) {
  return (
    <form action={goToCampaignDashboard}>
      <input type="hidden" name="campaignId" value={row.id} />
      <Button
        type="submit"
        variant={primary ? "default" : "outline"}
        className="group h-auto w-full justify-between px-5 py-4 text-left"
      >
        <div className="flex min-w-0 flex-col items-start gap-1">
          <span className="flex items-center gap-2">
            <span className="font-semibold text-base tracking-tight">{row.name}</span>
            {row.holidayType && (
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[9px] text-zinc-700 uppercase tracking-[0.1em] dark:bg-zinc-800 dark:text-zinc-300">
                {row.holidayType}
              </span>
            )}
          </span>
          <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
            {row.outreachBrand} → {row.crawlBrand}
            {row.startDate && (
              <>
                <span className="opacity-50"> · </span>
                {row.startDate}
                {row.endDate && row.endDate !== row.startDate && <> – {row.endDate}</>}
              </>
            )}
          </span>
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
      </Button>
    </form>
  );
}
