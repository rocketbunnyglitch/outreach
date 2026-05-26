import { Button } from "@/components/ui/button";
import { emailTemplates, outreachCadenceSteps } from "@/db/schema";
import { getOutreachBrand } from "@/lib/brand-context";
import { db } from "@/lib/db";
import type { OutreachPhase } from "@/lib/outreach-phase";
import { and, asc, eq, isNull } from "drizzle-orm";
import { Archive } from "lucide-react";
import { notFound } from "next/navigation";
import { archiveOutreachBrand, updateOutreachBrand } from "../../_actions";
import { CadenceEditor } from "../../_components/cadence-editor";
import { OutreachBrandForm } from "../../_components/outreach-brand-form";
import { PhaseSwitcher } from "../../_components/phase-switcher";

export const metadata = {
  title: "Edit outreach brand · Crawl Engine",
};

export default async function EditOutreachBrandPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const brand = await getOutreachBrand(id);
  if (!brand) notFound();
  const brandId = brand.id;

  // Cadence + active templates for the editor
  const [cadenceRows, templateRows] = await Promise.all([
    db
      .select({
        id: outreachCadenceSteps.id,
        stepNumber: outreachCadenceSteps.stepNumber,
        emailTemplateId: outreachCadenceSteps.emailTemplateId,
        delayDays: outreachCadenceSteps.delayDays,
        sendHour: outreachCadenceSteps.sendHour,
        templateName: emailTemplates.name,
      })
      .from(outreachCadenceSteps)
      .innerJoin(emailTemplates, eq(emailTemplates.id, outreachCadenceSteps.emailTemplateId))
      .where(eq(outreachCadenceSteps.outreachBrandId, brandId))
      .orderBy(asc(outreachCadenceSteps.stepNumber)),
    db
      .select({
        id: emailTemplates.id,
        name: emailTemplates.name,
        stage: emailTemplates.stage,
      })
      .from(emailTemplates)
      .where(and(eq(emailTemplates.outreachBrandId, brandId), isNull(emailTemplates.archivedAt)))
      .orderBy(asc(emailTemplates.name)),
  ]);

  // Bind id to the action.
  const boundUpdate = updateOutreachBrand.bind(null, brandId);

  async function archive() {
    "use server";
    await archiveOutreachBrand(brandId);
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-zinc-500 uppercase tracking-widest">
            Outreach brand · {brand.slug}
          </p>
          <h1 className="mt-2 font-semibold text-4xl tracking-tight ">{brand.displayName}</h1>
        </div>
        <form action={archive}>
          <Button type="submit" variant="destructive" size="sm" disabled={!!brand.archivedAt}>
            <Archive className="h-3.5 w-3.5" />
            {brand.archivedAt ? "Archived" : "Archive"}
          </Button>
        </form>
      </header>

      <PhaseSwitcher
        brandId={brandId}
        currentPhase={(brand.outreachPhase as OutreachPhase) ?? 1}
        setAt={brand.outreachPhaseSetAt}
      />

      <CadenceEditor brandId={brandId} steps={cadenceRows} templates={templateRows} />

      <OutreachBrandForm initial={brand} action={boundUpdate} />
    </div>
  );
}
