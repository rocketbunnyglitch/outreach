import { Button } from "@/components/ui/button";
import {
  events,
  campaigns,
  cities,
  cityCampaigns,
  crawlBrands,
  emailTemplates,
  outreachBrands,
  staffMembers,
  venueEvents,
  venues,
} from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { listOutreachBrands } from "@/lib/brand-context";
import { db } from "@/lib/db";
import { renderTemplate } from "@/lib/template-render";
import { asc, eq, isNull } from "drizzle-orm";
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
    previewVenueId?: string;
    previewEventId?: string;
  }>;
}

export default async function EditTemplatePage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { previewVenueId, previewEventId } = await searchParams;

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

  // Build the preview context. If previewVenueId is set, fetch the venue +
  // optionally a linked event. Default to whatever we can find.
  const ctx = await buildPreviewContext({
    outreachBrandId: template.outreachBrandId,
    previewVenueId,
    previewEventId,
    staffId: staff.id,
  });

  const subjectRender = renderTemplate(template.subjectTemplate, ctx.context);
  const bodyRender = renderTemplate(template.bodyTemplateText, ctx.context);

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
        outreachBrandId={template.outreachBrandId}
        currentPreviewVenueId={previewVenueId}
        currentPreviewEventId={previewEventId}
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
  outreachBrandId,
  previewVenueId,
  previewEventId,
  staffId,
}: {
  outreachBrandId: string;
  previewVenueId: string | undefined;
  previewEventId: string | undefined;
  staffId: string;
}) {
  // Venue picker options — all non-archived venues
  const venueOptions = await db
    .select({
      id: venues.id,
      name: venues.name,
      cityName: cities.name,
    })
    .from(venues)
    .innerJoin(cities, eq(cities.id, venues.cityId))
    .where(isNull(venues.archivedAt))
    .orderBy(asc(cities.name), asc(venues.name))
    .limit(200);

  // Default venue: previewVenueId if provided, else first option
  const targetVenueId = previewVenueId ?? venueOptions[0]?.id;

  // No venues? Empty context.
  if (!targetVenueId) {
    return {
      context: {},
      venueOptions,
      eventOptions: [] as { id: string; eventDate: string }[],
    };
  }

  // Fetch venue + city + country + outreach brand + staff
  const [venueRow] = await db
    .select({
      venue: venues,
      city: cities,
    })
    .from(venues)
    .innerJoin(cities, eq(cities.id, venues.cityId))
    .where(eq(venues.id, targetVenueId))
    .limit(1);

  const [outreachBrand] = await db
    .select()
    .from(outreachBrands)
    .where(eq(outreachBrands.id, outreachBrandId))
    .limit(1);

  // Events the operator can pick to preview against. Filter to events
  // already linked to this venue (via venue_events) — most realistic preview.
  const linkedEventRows = await db
    .select({
      event: events,
      campaign: campaigns,
      crawlBrand: crawlBrands,
    })
    .from(venueEvents)
    .innerJoin(events, eq(events.id, venueEvents.eventId))
    .innerJoin(cityCampaigns, eq(cityCampaigns.id, events.cityCampaignId))
    .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
    .innerJoin(crawlBrands, eq(crawlBrands.id, campaigns.crawlBrandId))
    .where(eq(venueEvents.venueId, targetVenueId))
    .orderBy(asc(events.eventDate))
    .limit(20);

  const eventOptions = linkedEventRows.map((r) => ({
    id: r.event.id,
    eventDate: r.event.eventDate,
  }));

  // Pick the event context: previewEventId if set, else first linked event
  const eventCtx = previewEventId
    ? (linkedEventRows.find((r) => r.event.id === previewEventId) ?? linkedEventRows[0])
    : linkedEventRows[0];

  // Fetch sender (operator) info for the staff merge fields
  const [senderStaff] = await db
    .select({
      displayName: staffMembers.displayName,
      primaryEmail: staffMembers.primaryEmail,
    })
    .from(staffMembers)
    .where(eq(staffMembers.id, staffId))
    .limit(1);

  const context = {
    venue: venueRow
      ? {
          name: venueRow.venue.name,
          address: venueRow.venue.address,
          city: venueRow.city.name,
          phone: venueRow.venue.phoneE164,
          email: venueRow.venue.email,
          website: venueRow.venue.websiteUrl,
        }
      : undefined,
    event: eventCtx
      ? {
          date: eventCtx.event.eventDate,
          dateFormatted: formatDate(eventCtx.event.eventDate),
          slotNumber: eventCtx.event.slotNumber,
          status: eventCtx.event.status,
        }
      : undefined,
    campaign: eventCtx
      ? {
          name: eventCtx.campaign.name,
          slug: eventCtx.campaign.slug,
          year: extractYear(eventCtx.event.eventDate),
        }
      : undefined,
    city: venueRow
      ? {
          name: venueRow.city.name,
          region: venueRow.city.region,
        }
      : undefined,
    crawlBrand: eventCtx?.crawlBrand
      ? {
          displayName: eventCtx.crawlBrand.displayName,
          tagline: eventCtx.crawlBrand.tagline,
          holidayType: eventCtx.crawlBrand.holidayType,
          primaryColorHex: eventCtx.crawlBrand.primaryColorHex,
          accentColorHex: eventCtx.crawlBrand.accentColorHex,
        }
      : undefined,
    outreachBrand: outreachBrand ? { displayName: outreachBrand.displayName } : undefined,
    staff: senderStaff
      ? {
          displayName: senderStaff.displayName,
          primaryEmail: senderStaff.primaryEmail,
        }
      : undefined,
  };

  return { context, venueOptions, eventOptions };
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function extractYear(iso: string): number {
  return Number.parseInt(iso.slice(0, 4), 10);
}
