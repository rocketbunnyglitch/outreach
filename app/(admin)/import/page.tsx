import { Card } from "@/components/ui/card";
import { Upload } from "lucide-react";
import Link from "next/link";
import { importVenuesCsv } from "./_actions";
import { VenueImportForm } from "./_components/import-form";

export const metadata = { title: "Import · Crawl Engine" };
export const dynamic = "force-dynamic";

export default function ImportPage() {
  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="font-semibold text-4xl tracking-tight ">Import</h1>
        <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
          Bulk-load existing data from CSV exports. Each entity type has its own importer.
        </p>
      </header>

      <Card className="flex flex-col gap-6 p-6">
        <header className="flex items-baseline gap-3">
          <Upload className="h-4 w-4 text-stone-400" />
          <h2 className="font-semibold text-2xl tracking-tight ">Venues</h2>
        </header>
        <p className="text-sm text-stone-600 dark:text-stone-400">
          Migrate venue rosters from Google Sheets. The CSV must have a header row; cities are
          matched by name (and country if provided). Cities must already exist —{" "}
          <Link href="/cities/new" className="underline">
            add them under /cities
          </Link>{" "}
          before importing venues that reference them.
        </p>
        <VenueImportForm action={importVenuesCsv} />
      </Card>

      <Card className="bg-transparent p-6">
        <p className="text-sm text-stone-500">
          More importers (outreach history, venue events) arrive in Phase 4c.
        </p>
      </Card>
    </div>
  );
}
