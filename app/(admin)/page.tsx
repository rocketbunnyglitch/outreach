import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { listCrawlBrands, listOutreachBrands } from "@/lib/brand-context";
import { ArrowRight, Building2 } from "lucide-react";
import Link from "next/link";

// Always render at request time — the dashboard shows live counts from
// the DB. Prerendering would freeze the count at build time.
export const dynamic = "force-dynamic";

/**
 * Admin home. Shows the current brand inventory and points at the Brands
 * page. As phases land, this becomes the daily operations dashboard
 * (Phase 4 spec §6.2).
 */
export default async function Home() {
  const [outreach, crawl] = await Promise.all([listOutreachBrands(), listCrawlBrands()]);

  return (
    <div className="flex animate-[fade-in_300ms_ease-out] flex-col gap-12">
      <section>
        <p className="font-mono text-stone-500 text-xs uppercase tracking-widest">
          Phase 2 · Multi-brand foundation
        </p>
        <h1 className="mt-2 font-serif text-5xl tracking-tight">
          Two kinds of brand. <span className="text-stone-500 italic">One model.</span>
        </h1>
        <p className="mt-4 max-w-xl text-stone-600 dark:text-stone-400">
          Every campaign carries an <strong>outreach</strong> identity (who venues think is
          contacting them) and a <strong>crawl</strong> identity (what ticket buyers see). The
          engine resolves both on every send and asset path.
        </p>
      </section>

      <section className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <Link href="/brands#outreach" className="group">
          <Card className="h-full transition-shadow hover:shadow-md">
            <CardContent className="flex flex-col gap-3 p-6">
              <div className="flex items-center gap-2 text-stone-500">
                <Building2 className="h-4 w-4" />
                <span className="font-mono text-[10px] uppercase tracking-widest">
                  Outreach brands
                </span>
              </div>
              <CardTitle className="text-4xl">{outreach.length}</CardTitle>
              <CardDescription>
                Venue-facing identities. Postmark accounts, staff Gmail inboxes, email signatures.
                No public domain.
              </CardDescription>
              <div className="mt-2 inline-flex items-center gap-1 text-sm text-stone-700 group-hover:text-stone-900 dark:text-stone-300 dark:group-hover:text-stone-100">
                Manage
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/brands#crawl" className="group">
          <Card className="h-full transition-shadow hover:shadow-md">
            <CardContent className="flex flex-col gap-3 p-6">
              <div className="flex items-center gap-2 text-stone-500">
                <Building2 className="h-4 w-4" />
                <span className="font-mono text-[10px] uppercase tracking-widest">
                  Crawl brands
                </span>
              </div>
              <CardTitle className="text-4xl">{crawl.length}</CardTitle>
              <CardDescription>
                Customer-facing identities. Eventbrite orgs, posters, public maps, ticket-buyer
                brand.
              </CardDescription>
              <div className="mt-2 inline-flex items-center gap-1 text-sm text-stone-700 group-hover:text-stone-900 dark:text-stone-300 dark:group-hover:text-stone-100">
                Manage
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </div>
            </CardContent>
          </Card>
        </Link>
      </section>

      <section className="text-stone-500 text-xs">
        <Link href="/api/health" className="font-mono underline-offset-4 hover:underline">
          /api/health
        </Link>
      </section>
    </div>
  );
}
