import { Button } from "@/components/ui/button";
import { getOutreachBrand } from "@/lib/brand-context";
import { Archive } from "lucide-react";
import { notFound } from "next/navigation";
import { archiveOutreachBrand, updateOutreachBrand } from "../../_actions";
import { OutreachBrandForm } from "../../_components/outreach-brand-form";

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

      <OutreachBrandForm initial={brand} action={boundUpdate} />
    </div>
  );
}
