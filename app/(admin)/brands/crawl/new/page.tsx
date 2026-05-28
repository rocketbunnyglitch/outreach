import { listOutreachBrands } from "@/lib/brand-context";
import { redirect } from "next/navigation";
import { createCrawlBrand } from "../../_actions";
import { CrawlBrandForm } from "../../_components/crawl-brand-form";

// Lists current outreach brands for the dropdown — needs live DB.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "New crawl brand",
};

export default async function NewCrawlBrandPage() {
  const outreachBrands = await listOutreachBrands();

  async function actionAndMaybeRedirect(
    _prev: unknown,
    formData: FormData,
  ): Promise<
    | { ok: true; data: { id: string; slug: string } }
    | { ok: false; error: string; fieldErrors?: Record<string, string[]> }
  > {
    "use server";
    const result = await createCrawlBrand(_prev, formData);
    if (result.ok) {
      redirect(`/brands/crawl/${result.data.id}`);
    }
    return result;
  }

  return (
    <div className="flex flex-col gap-8">
      <header>
        <p className="font-mono text-xs text-zinc-500 uppercase tracking-widest">New crawl brand</p>
        <h1 className="mt-2 font-semibold text-4xl tracking-tight ">What ticket buyers see.</h1>
      </header>

      <CrawlBrandForm action={actionAndMaybeRedirect} outreachBrands={outreachBrands} />
    </div>
  );
}
