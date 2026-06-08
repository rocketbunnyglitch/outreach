import { Button } from "@/components/ui/button";
import { events, cities, cityCampaigns, emailTemplates, venues } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { listOutreachBrands } from "@/lib/brand-context";
import { db } from "@/lib/db";
import { buildFlatMergeContext } from "@/lib/template-merge-context";
import { type RenderContext, renderTemplate } from "@/lib/template-render";
import { and, asc, eq, isNull } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { archiveEmailTemplate, updateEmailTemplate } from "../_actions";
import { PreviewPane } from "../_components/preview-pane";
import { TemplateForm } from "../_components/template-form";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    previewCityCampaignId?: string;
    previewVenueId?: string;
    previewEventId?: string;
  }>;
}

export default async function EditTemplatePage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { previewCityCampaignId, previewVenueId, previewEventId } = await searchParams;

  const { staff } = await requireStaff();

  const [template, brands] = await Promise.all([
    db
      .select()
      .from(emailTemplates)
      .where(eq(emailTemplates.id, id))
      .limit(1)
      .then((r) => r[0]),
    listOutreachBrands(),
  ]);
  if (!template) notFound();

  // The template is campaign-scoped (Halloween 2026 etc.). The preview context
  // follows the real data path: campaign -> city (city_campaigns) -> venue
  // (venues.city_id). Event is optional -- the builder falls back to the city's
  // primary crawl when none is picked.
  const ctx = await buildPreviewContext({
    campaignId: template.campaignId,
    previewCityCampaignId,
    previewVenueId,
    previewEventId,
    staffId: staff.id,
  });

  const subjectRender = renderTemplate(template.subjectTemplate, ctx.context as RenderContext);
  const bodyRender = renderTemplate(template.bodyTemplateText, ctx.context as RenderContext);

  async function boundUpdate(prev: unknown, fd: FormData) {
    "use server";
    return updateEmailTemplate(id, prev, fd);
  }
  async function boundArchive() {
    "use server";
    await archiveEmailTemplate(id);
  }

  return (
    <div className="flex flex-col gap-12">
      <header>
        <Link
          href="/templates"
          className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          <ChevronLeft className="h-3 w-3" /> All templates
        </Link>
        <h1 className="mt-3 font-semibold text-4xl tracking-tight ">{template.name}</h1>
      </header>

      <PreviewPane
        templateId={id}
        isCampaignScoped={template.campaignId != null}
        currentCityCampaignId={ctx.selectedCityCampaignId}
        currentVenueId={ctx.selectedVenueId}
        currentEventId={previewEventId}
        cities={ctx.cityOptions}
        venues={ctx.venueOptions}
        events={ctx.eventOptions}
        subjectRendered={subjectRender.output}
        bodyRendered={bodyRender.output}
        unresolved={Array.from(
          new Set([...subjectRender.unresolvedFields, ...bodyRender.unresolvedFields]),
        )}
      />

      <TemplateForm
        mode="edit"
        initial={{
          outreachBrandId: template.outreachBrandId,
          stage: template.stage,
          name: template.name,
          subjectTemplate: template.subjectTemplate,
          subjectVariants: template.subjectVariants,
          bodyTemplateText: template.bodyTemplateText,
          bodyTemplateHtml: template.bodyTemplateHtml,
          isDefaultForStage: template.isDefaultForStage,
        }}
        brands={brands.map((b) => ({
          id: b.id,
          displayName: b.displayName,
        }))}
        action={boundUpdate}
      />

      <form
        action={boundArchive}
        className="flex items-center justify-between rounded-md border border-rose-200 bg-rose-50 p-4 dark:border-rose-900 dark:bg-rose-950"
      >
        <div>
          <p className="font-medium text-rose-900 text-sm dark:text-rose-200">
            Archive this template
          </p>
          <p className="mt-1 text-rose-800 text-xs dark:text-rose-300">
            Hides it from lists and from automation. Past sends keep their reference.
          </p>
        </div>
        <Button type="submit" variant="destructive">
          Archive
        </Button>
      </form>
    </div>
  );
}

async function buildPreviewContext({
  campaignId,
  previewCityCampaignId,
  previewVenueId,
  previewEventId,
  staffId,
}: {
  campaignId: string | null;
  previewCityCampaignId: string | undefined;
  previewVenueId: string | undefined;
  previewEventId: string | undefined;
  staffId: string;
}) {
  // Cities the campaign runs in (city_campaigns). The campaign already has its
  // full city list loaded, so this is the right place to start.
  const cityRows = campaignId
    ? await db
        .select({ ccId: cityCampaigns.id, cityId: cityCampaigns.cityId, cityName: cities.name })
        .from(cityCampaigns)
        .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
        .where(eq(cityCampaigns.campaignId, campaignId))
        .orderBy(asc(cities.name))
    : [];

  const selectedCity =
    cityRows.find((c) => c.ccId === previewCityCampaignId) ?? cityRows[0] ?? null;

  // Venues in the selected city.
  const venueOptions = selectedCity
    ? await db
        .select({ id: venues.id, name: venues.name })
        .from(venues)
        .where(and(eq(venues.cityId, selectedCity.cityId), isNull(venues.archivedAt)))
        .orderBy(asc(venues.name))
        .limit(300)
    : [];
  const selectedVenueId =
    (previewVenueId && venueOptions.some((v) => v.id === previewVenueId)
      ? previewVenueId
      : venueOptions[0]?.id) ?? undefined;

  // Crawls (events) for the city -- optional preview-against picker.
  const eventRows = selectedCity
    ? await db
        .select({ id: events.id, eventDate: events.eventDate, dayPart: events.dayPart })
        .from(events)
        .where(and(eq(events.cityCampaignId, selectedCity.ccId), isNull(events.archivedAt)))
        .orderBy(asc(events.eventDate))
    : [];
  const eventOptions = eventRows.map((e) => ({
    id: e.id,
    label: `${e.eventDate}${e.dayPart ? ` (${e.dayPart.replace(/_/g, " ")})` : ""}`,
  }));

  const context = await buildFlatMergeContext({
    venueId: selectedVenueId,
    campaignId,
    cityCampaignId: selectedCity?.ccId,
    eventId: previewEventId,
    staffId,
  });

  return {
    context,
    cityOptions: cityRows.map((c) => ({ id: c.ccId, cityName: c.cityName })),
    venueOptions,
    eventOptions,
    selectedCityCampaignId: selectedCity?.ccId,
    selectedVenueId,
  };
}
