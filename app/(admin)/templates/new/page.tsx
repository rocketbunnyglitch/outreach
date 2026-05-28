import { listOutreachBrands } from "@/lib/brand-context";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { createEmailTemplate } from "../_actions";
import { TemplateForm } from "../_components/template-form";

export const metadata = { title: "New template" };
export const dynamic = "force-dynamic";

export default async function NewTemplatePage() {
  const brands = await listOutreachBrands();

  return (
    <div className="flex flex-col gap-8">
      <header>
        <Link
          href="/templates"
          className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          <ChevronLeft className="h-3 w-3" /> All templates
        </Link>
        <h1 className="mt-3 font-semibold text-4xl tracking-tight ">New email template</h1>
      </header>
      <TemplateForm
        mode="create"
        brands={brands.map((b) => ({
          id: b.id,
          displayName: b.displayName,
        }))}
        action={createEmailTemplate}
      />
    </div>
  );
}
