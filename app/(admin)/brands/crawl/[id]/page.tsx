import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getCrawlBrand, listOutreachBrands } from "@/lib/brand-context";
import { Archive } from "lucide-react";
import { notFound } from "next/navigation";
import { archiveCrawlBrand, updateCrawlBrand } from "../../_actions";
import { CrawlBrandForm } from "../../_components/crawl-brand-form";

export const metadata = {
  title: "Edit crawl brand",
};

export default async function EditCrawlBrandPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [brand, outreachBrands] = await Promise.all([getCrawlBrand(id), listOutreachBrands()]);
  if (!brand) notFound();
  const brandId = brand.id;

  const boundUpdate = updateCrawlBrand.bind(null, brandId);

  async function archive() {
    "use server";
    await archiveCrawlBrand(brandId);
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-zinc-500 uppercase tracking-widest">
            Crawl brand · {brand.slug}
          </p>
          <div className="mt-2 flex flex-wrap items-baseline gap-3">
            <h1 className="font-semibold text-4xl tracking-tight ">{brand.displayName}</h1>
            <Badge tone="accent">{brand.holidayType}</Badge>
            <Badge>{brand.geography}</Badge>
          </div>
        </div>
        <form action={archive}>
          <Button type="submit" variant="destructive" size="sm" disabled={!!brand.archivedAt}>
            <Archive className="h-3.5 w-3.5" />
            {brand.archivedAt ? "Archived" : "Archive"}
          </Button>
        </form>
      </header>

      <CrawlBrandForm initial={brand} outreachBrands={outreachBrands} action={boundUpdate} />
    </div>
  );
}
