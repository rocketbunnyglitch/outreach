import { redirect } from "next/navigation";
import { createOutreachBrand } from "../../_actions";
import { OutreachBrandForm } from "../../_components/outreach-brand-form";

export const metadata = {
  title: "New outreach brand · Crawl Engine",
};

export default function NewOutreachBrandPage() {
  /**
   * Server-action wrapper that redirects to the edit page on success.
   * Returning the result directly to the form keeps validation errors
   * inline; on success, we jump to the new record so the user can keep
   * configuring it.
   */
  async function actionAndMaybeRedirect(
    _prev: unknown,
    formData: FormData,
  ): Promise<
    | { ok: true; data: { id: string; slug: string } }
    | { ok: false; error: string; fieldErrors?: Record<string, string[]> }
  > {
    "use server";
    const result = await createOutreachBrand(_prev, formData);
    if (result.ok) {
      redirect(`/brands/outreach/${result.data.id}`);
    }
    return result;
  }

  return (
    <div className="flex flex-col gap-8">
      <header>
        <p className="font-mono text-xs text-zinc-500 uppercase tracking-widest">
          New outreach brand
        </p>
        <h1 className="mt-2 font-semibold text-4xl tracking-tight ">
          The company venues think is contacting them.
        </h1>
      </header>

      <OutreachBrandForm action={actionAndMaybeRedirect} />
    </div>
  );
}
