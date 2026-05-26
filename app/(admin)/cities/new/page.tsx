import { countries } from "@/db/schema";
import { db } from "@/lib/db";
import { asc } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { createCity } from "../_actions";
import { CityForm } from "../_components/city-form";

export const dynamic = "force-dynamic";

export default async function NewCityPage() {
  const countriesList = await db.select().from(countries).orderBy(asc(countries.name));

  return (
    <div className="flex flex-col gap-8">
      <header>
        <Link
          href="/cities"
          className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"
        >
          <ChevronLeft className="h-3 w-3" /> All cities
        </Link>
        <h1 className="mt-3 font-semibold text-4xl tracking-tight ">New city</h1>
      </header>

      <CityForm mode="create" countries={countriesList} action={createCity} />
    </div>
  );
}
