import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { emailTemplates, outreachBrands } from "@/db/schema";
import { db } from "@/lib/db";
import { STAGE_LABELS } from "@/lib/validation/email-templates";
import { asc, eq, isNull } from "drizzle-orm";
import { Mail, Plus, Star } from "lucide-react";
import Link from "next/link";

export const metadata = { title: "Email templates · Crawl Engine" };
export const dynamic = "force-dynamic";

export default async function TemplatesListPage() {
  const rows = await db
    .select({
      template: emailTemplates,
      brand: outreachBrands,
    })
    .from(emailTemplates)
    .innerJoin(outreachBrands, eq(outreachBrands.id, emailTemplates.outreachBrandId))
    .where(isNull(emailTemplates.archivedAt))
    .orderBy(asc(outreachBrands.displayName), asc(emailTemplates.stage), asc(emailTemplates.name));

  // Group by brand → stage → templates
  type StageGroup = { stage: string; templates: typeof rows };
  type BrandGroup = { brandName: string; stages: Map<string, StageGroup> };
  const byBrand = new Map<string, BrandGroup>();
  for (const row of rows) {
    const brandKey = row.brand.displayName;
    let bg = byBrand.get(brandKey);
    if (!bg) {
      bg = { brandName: brandKey, stages: new Map() };
      byBrand.set(brandKey, bg);
    }
    let sg = bg.stages.get(row.template.stage);
    if (!sg) {
      sg = { stage: row.template.stage, templates: [] };
      bg.stages.set(row.template.stage, sg);
    }
    sg.templates.push(row);
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-semibold text-4xl tracking-tight ">
            <Mail className="-mt-1 mr-2 inline-block h-7 w-7 text-stone-400" />
            Email templates
          </h1>
          <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
            Templates are scoped per outreach brand and stage. The default template for each stage
            gets used by automation; named variants stay available for manual sends.
          </p>
        </div>
        <Button asChild>
          <Link href="/templates/new">
            <Plus className="h-4 w-4" />
            New template
          </Link>
        </Button>
      </header>

      {byBrand.size === 0 ? (
        <Card className="border-dashed bg-transparent p-10 text-center">
          <p className="font-semibold text-2xl tracking-tight ">No templates yet.</p>
          <p className="mt-2 text-sm text-stone-500">
            Create your first template to start authoring outreach copy.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-10">
          {Array.from(byBrand.values()).map((bg) => (
            <section key={bg.brandName} className="flex flex-col gap-4">
              <h2 className="font-mono text-stone-500 text-xs uppercase tracking-widest">
                {bg.brandName}
              </h2>
              <div className="flex flex-col gap-6">
                {Array.from(bg.stages.values()).map((sg) => (
                  <div key={sg.stage} className="flex flex-col gap-2">
                    <h3 className="font-medium text-sm text-stone-700 dark:text-stone-300">
                      {STAGE_LABELS[sg.stage as keyof typeof STAGE_LABELS] ?? sg.stage}
                    </h3>
                    <ol className="flex flex-col gap-1.5">
                      {sg.templates.map((row) => (
                        <li key={row.template.id}>
                          <Link href={`/templates/${row.template.id}`} className="group block">
                            <Card className="flex items-center justify-between gap-4 p-3 transition-colors group-hover:bg-stone-50 dark:group-hover:bg-stone-900">
                              <div className="flex items-center gap-2.5">
                                {row.template.isDefaultForStage && (
                                  <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />
                                )}
                                <span className="font-medium">{row.template.name}</span>
                                <span className="font-mono text-stone-500 text-xs">
                                  {row.template.subjectTemplate.slice(0, 60)}
                                  {row.template.subjectTemplate.length > 60 ? "…" : ""}
                                </span>
                              </div>
                              {row.template.isDefaultForStage && (
                                <Badge tone="success">default</Badge>
                              )}
                            </Card>
                          </Link>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
