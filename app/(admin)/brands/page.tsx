import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { listCrawlBrands, listOutreachBrands } from "@/lib/brand-context";
import { cn } from "@/lib/cn";
import { Plus } from "lucide-react";
import Link from "next/link";

// Brand list reflects current DB state — never prerender.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Brands · Crawl Engine",
};

export default async function BrandsPage() {
  const [outreachAll, crawlAll] = await Promise.all([
    listOutreachBrands({ includeArchived: true }),
    listCrawlBrands({ includeArchived: true }),
  ]);

  const outreachActive = outreachAll.filter((b) => b.status === "active" && !b.archivedAt);
  const outreachRetired = outreachAll.filter((b) => b.status === "retired" || b.archivedAt);

  const crawlActive = crawlAll.filter((b) => b.status === "active" && !b.archivedAt);
  const crawlRetired = crawlAll.filter((b) => b.status === "retired" || b.archivedAt);

  return (
    <div className="flex flex-col gap-12">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-stone-500 text-xs uppercase tracking-widest">
          Two-brand model
        </p>
        <h1 className="font-serif text-4xl tracking-tight">Brands</h1>
        <p className="max-w-xl text-stone-600 dark:text-stone-400">
          Outreach identities (who venues think is contacting them) and crawl identities (what
          ticket buyers see). Every campaign uses both.
        </p>
      </header>

      <section id="outreach" className="flex flex-col gap-4">
        <SectionHeader
          title="Outreach brands"
          subtitle="Venue-facing. Email + Postmark + Gmail + signatures. No public web presence."
          newHref="/brands/outreach/new"
        />
        {outreachActive.length === 0 ? (
          <EmptyState
            label="No outreach brands yet."
            cta="Create the first one"
            href="/brands/outreach/new"
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {outreachActive.map((b) => (
              <OutreachBrandCard key={b.id} brand={b} />
            ))}
          </div>
        )}
        {outreachRetired.length > 0 && (
          <RetiredList title="Retired outreach brands" brands={outreachRetired} />
        )}
      </section>

      <section id="crawl" className="flex flex-col gap-4">
        <SectionHeader
          title="Crawl brands"
          subtitle="Customer-facing. Eventbrite, posters, public maps, ticket-buyer identity."
          newHref="/brands/crawl/new"
        />
        {crawlActive.length === 0 ? (
          <EmptyState
            label="No crawl brands yet."
            cta="Create the first one"
            href="/brands/crawl/new"
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {crawlActive.map((b) => (
              <CrawlBrandCard key={b.id} brand={b} />
            ))}
          </div>
        )}
        {crawlRetired.length > 0 && (
          <RetiredList title="Retired crawl brands" brands={crawlRetired} />
        )}
      </section>
    </div>
  );
}

function SectionHeader({
  title,
  subtitle,
  newHref,
}: {
  title: string;
  subtitle: string;
  newHref: string;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-stone-200 border-b pb-3 dark:border-stone-800">
      <div>
        <h2 className="font-serif text-2xl tracking-tight">{title}</h2>
        <p className="text-sm text-stone-500">{subtitle}</p>
      </div>
      <Button asChild size="sm" variant="outline">
        <Link href={newHref}>
          <Plus className="h-3.5 w-3.5" />
          New
        </Link>
      </Button>
    </div>
  );
}

function EmptyState({
  label,
  cta,
  href,
}: {
  label: string;
  cta: string;
  href: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-stone-300 border-dashed py-12 dark:border-stone-700">
      <p className="text-sm text-stone-500">{label}</p>
      <Button asChild size="sm">
        <Link href={href}>{cta}</Link>
      </Button>
    </div>
  );
}

function OutreachBrandCard({
  brand,
}: {
  brand: Awaited<ReturnType<typeof listOutreachBrands>>[number];
}) {
  const hasPostmark = Boolean(brand.postmarkServerToken);
  const hasSignature = Boolean(brand.emailSignatureText || brand.emailSignatureHtml);

  return (
    <Link href={`/brands/outreach/${brand.id}`} className="group">
      <Card className="h-full p-5 transition-shadow hover:shadow-md">
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="font-serif text-xl tracking-tight">{brand.displayName}</h3>
              <p className="font-mono text-stone-500 text-xs">@{brand.emailDomain}</p>
            </div>
            <Badge tone={brand.status === "active" ? "success" : "muted"}>{brand.status}</Badge>
          </div>
          <div className="flex flex-wrap gap-1.5 pt-1">
            <ConfigBadge label="Postmark" ok={hasPostmark} />
            <ConfigBadge label="Signature" ok={hasSignature} />
            <ConfigBadge label="Quo" ok={Boolean(brand.quoLineE164)} />
          </div>
        </div>
      </Card>
    </Link>
  );
}

function CrawlBrandCard({
  brand,
}: {
  brand: Awaited<ReturnType<typeof listCrawlBrands>>[number];
}) {
  const hasEventbrite = Boolean(brand.eventbriteApiToken);
  const swatch = brand.primaryColorHex ?? "#a8a29e";

  return (
    <Link href={`/brands/crawl/${brand.id}`} className="group">
      <Card className="h-full overflow-hidden transition-shadow hover:shadow-md">
        <div className="h-1.5 w-full" style={{ backgroundColor: swatch }} aria-hidden />
        <div className="flex flex-col gap-3 p-5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="font-serif text-xl tracking-tight">{brand.displayName}</h3>
              <p className="font-mono text-stone-500 text-xs">{brand.slug}</p>
            </div>
            <Badge tone={brand.status === "active" ? "success" : "muted"}>{brand.status}</Badge>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Badge tone="accent">{brand.holidayType}</Badge>
            <Badge tone={brand.geography === "toronto" ? "default" : "default"}>
              {brand.geography}
            </Badge>
          </div>

          {brand.tagline && (
            <p className="text-sm text-stone-600 italic dark:text-stone-400">"{brand.tagline}"</p>
          )}

          <div className="flex flex-wrap gap-1.5 pt-1">
            <ConfigBadge label="Domain" ok={Boolean(brand.publicDomain)} />
            <ConfigBadge label="Eventbrite" ok={hasEventbrite} />
            <ConfigBadge label="Colors" ok={Boolean(brand.primaryColorHex)} />
          </div>
        </div>
      </Card>
    </Link>
  );
}

function ConfigBadge({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-medium text-[10px] uppercase tracking-wider",
        ok
          ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
          : "border-stone-200 bg-stone-50 text-stone-400 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-500",
      )}
    >
      <span
        className={cn(
          "h-1 w-1 rounded-full",
          ok ? "bg-emerald-500" : "bg-stone-300 dark:bg-stone-700",
        )}
      />
      {label}
    </span>
  );
}

function RetiredList({
  title,
  brands,
}: {
  title: string;
  brands: { id: string; displayName: string; slug: string }[];
}) {
  return (
    <details className="mt-4">
      <summary className="cursor-pointer text-stone-500 text-xs uppercase tracking-wider hover:text-stone-700 dark:hover:text-stone-300">
        {title} ({brands.length})
      </summary>
      <ul className="mt-3 flex flex-col gap-1.5 text-sm">
        {brands.map((b) => (
          <li key={b.id} className="text-stone-500">
            {b.displayName}
            <span className="ml-2 font-mono text-[10px] text-stone-400">{b.slug}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
